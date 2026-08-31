import { createHash, randomUUID } from 'node:crypto'
import { projectAgentContent } from './runtime-content-projection.js'
import { generateSceneImage } from './scene-image-provider.js'
import { createSceneImageSettings } from './scene-image-settings.js'
import { channelSettings, channelReady, imageExpressionProfile, imageExpressionGuidance } from './scene-image-channels.js'
import { createScenePlans, SCENE_PLAN_INSTRUCTION, SCENE_PLAN_TOOL } from './scene-plan.js'
import { imageAdjustmentInput, applyImageAdjustment, legacyImagePlan, SCENE_ADJUSTMENT_INSTRUCTION, SCENE_ADJUSTMENT_TOOL } from './scene-image-adjustment.js'
import { createSceneImageStyles, applyImageStyle, composeSceneImagePrompt } from './scene-image-style.js'
import { createPendingSceneImages } from './scene-image-pending.js'
import { createSceneImageQueue } from './scene-image-queue.js'

export const IMAGE_CREDENTIAL = 'DSH_TAVERN_IMAGE_API_KEY'
const hash = value => createHash('sha256').update(value).digest('hex')
const redactImageError = (value, key) => key ? String(value).replaceAll(key, '[已隐藏]') : String(value)
const imageHosts = new Map()
const imageAborters = new Map()
function ownerIsLive(record, path) {
  if (!record?.ownerPid) return false
  if (record.ownerPid === process.pid) return imageHosts.get(record.ownerId)?.(path) === true
  try { process.kill(record.ownerPid, 0); return true } catch (error) { return error.code === 'EPERM' }
}
function versionsOf(record) {
  if (Array.isArray(record?.versions)) return record.versions
  return record?.attachment ? [{ id: record.requestId || 'legacy', requestId: record.requestId, attachment: record.attachment, prompt: record.prompt, model: record.model, createdAt: record.completedAt || record.createdAt, plan: record.plan }] : []
}

export function sceneTarget(chat, turn) {
  turn = Number(turn)
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('正文轮次不合法')
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('请先打开游玩对话')
  const index = (chat.messages || []).findIndex(message => message?.role === 'assistant' && Number(message.turn || (message.greeting ? 1 : 0)) === Number(turn))
  if (index < 0) throw new Error('这段正文已不存在')
  const message = chat.messages[index]
  const swipeId = Math.max(0, Number(message.swipeId) || 0)
  const source = String(message.swipes?.[swipeId] ?? message.sourceText ?? message.text ?? '')
  const sourceDigest = hash(source)
  // A prefix digest distinguishes rolled-back/replaced story branches, while
  // appending later rounds or changing variable metadata does not invalidate art.
  const prefix = chat.messages.slice(0, index).map(item => [item.role, item.turn, item.sourceText ?? item.text])
  const key = hash(JSON.stringify([chat.id, prefix, index, turn, swipeId, sourceDigest]))
  return { key, turn: Number(turn), swipeId, sourceDigest, source }
}

function projectedSceneText(source, macroState) {
  return projectAgentContent(source, { macroState }).agentText
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '').trim()
}

export function sceneInput(chat, target, stateAtTarget) {
  const text = projectedSceneText(target.source, stateAtTarget?.macroState || chat.macroState)
  if (!text) throw new Error('这段正文没有可用于生图的文本')
  if (text.length > 60000) throw new Error('这段正文过长，暂不支持一键生图')
  const latest = [...(chat.messages || [])].reverse().find(item => item.role === 'assistant')
  const latestTurn = Number(latest?.turn || (latest?.greeting ? 1 : 0))
  // No historical snapshot means no historical posture; never borrow the latest
  // game's pose to illustrate an earlier turn.
  const snapshot = stateAtTarget || (latestTurn === target.turn && chat.settleStatus === 'done' ? chat : null)
  return { text, posture: typeof snapshot?.posture === 'string' ? snapshot.posture : '' }
}

function sceneSources(chat, target, snapshot, sinceTurn = target.turn) {
  const lineage = (chat.messages || []).filter(item => item.role === 'assistant' && Number(item.turn || (item.greeting ? 1 : 0)) <= target.turn)
    .map(item => sceneTarget(chat, Number(item.turn || 1)))
  const sources = [], omitted = []
  let remaining = 12000
  const add = (id, turn, body) => {
    if (!body) return
    const paragraphs = body.split(/\n\s*\n/)
    const kept = []
    for (const paragraph of paragraphs.reverse()) {
      if (paragraph.length + 2 > remaining) { omitted.push({ id, characters: paragraph.length }); continue }
      remaining -= paragraph.length + 2
      kept.unshift(paragraph)
    }
    if (kept.length) sources.push({ id, turn, text: kept.join('\n\n') })
  }
  add('target', target.turn, snapshot.text)
  if (!sources.length) throw new Error('目标正文单段超过绘图材料预算，请先分段后再生图')
  add('posture', target.turn, snapshot.posture)
  for (const item of [...lineage].reverse()) if (item.key !== target.key && item.turn > sinceTurn) add('history-' + item.key.slice(0, 16), item.turn, projectedSceneText(item.source, chat.macroState))
  return { lineage, sources, omitted }
}

/** Sidecar records only: never writes story messages, MVU state or foreground Session. */
export function createSceneIllustrations(deps) {
  const ownerId = randomUUID()
  const jobs = new Map()
  const starts = new Map()
  imageHosts.set(ownerId, path => jobs.has(path) || starts.has(path))
  imageAborters.set(ownerId, (path, requestId) => { const job = jobs.get(path); if (job?.requestId === requestId) job.controller.abort() })
  const { config, settings, configure, capture } = createSceneImageSettings(deps)
  const plans = createScenePlans({ store: deps.store })
  const styles = createSceneImageStyles({ store: deps.store })
  const pendingImages = createPendingSceneImages(deps.store)
  const imageQueue = createSceneImageQueue(deps)
  const pathFor = (chatId, key) => 'scene-images/' + hash(String(chatId)) + '/' + key + '.json'
  async function resolve(sessionId, turn) {
    const chat = await deps.chatForSession(sessionId)
    const target = sceneTarget(chat, turn)
    return { chat, target, path: pathFor(chat.id, target.key) }
  }
  async function readRecord(path) {
    const record = await deps.store.readJson(path)
    if (record?.status === 'running' && !ownerIsLive(record, path)) {
      const recoverable = await pendingImages.has(path, record.requestId)
      return deps.store.updateJson(path, current => current?.requestId === record.requestId && current.status === 'running' && !ownerIsLive(current, path)
        ? { ...current, status: current.cancelRequestedAt ? 'cancelled' : 'failed', outcome: recoverable ? 'received' : current.outcome || (['planning', 'queued'].includes(current.stage) ? 'not_requested' : 'unconfirmed'), ...(recoverable ? { recovery: 'save' } : {}), error: recoverable ? '图片已生成，保存被中断；请重试保存，不会重新生图。' : current.outcome === 'not_requested' || !current.outcome && ['planning', 'queued'].includes(current.stage) ? '生图任务中断，尚未请求图片。' : '结果未确认，服务可能已计费；不会自动重新生图。' } : current)
    }
    return record
  }
  function present(target, record) {
    const { attachment, savedAttachment, diagnostics, plan, requests, versions, deletedVersions, ownerId, ownerPid, ...publicRecord } = record || {}
    const configuration = value => value?.workflow ? { ...value, workflow: { name: value.workflow.name, digest: value.workflow.digest } } : value
    return { key: target.key, turn: target.turn, status: 'idle', ...publicRecord, ...(publicRecord.configuration ? { configuration: configuration(publicRecord.configuration) } : {}), versions: versionsOf(record).map(({ attachment, plan, ...item }) => ({ ...item, configuration: configuration(item.configuration), description: plan?.description || '', profile: plan?.profile || '' })) }
  }
  async function status(sessionId, turn) {
    const { target, path } = await resolve(sessionId, turn)
    const current = await config()
    return { ...present(target, await readRecord(path)), enabled: current.enabled, profile: imageExpressionProfile(current) }
  }
  function needsPurchaseConfirmation(record) {
    return record?.outcome === 'unconfirmed' && !record.providerTask
  }
  function checkPurchaseConfirmation(record, options) {
    if (needsPurchaseConfirmation(record) && options.confirmNewRequestId !== record.requestId) throw new Error('上次结果未确认，服务可能已计费。请确认重新生图后再请求，不会自动重试。')
  }
  async function writeJob(path, record, next = record) {
    return deps.store.updateJson(path, current => {
      if (current?.requestId !== record.requestId || current.ownerId !== record.ownerId || current.status !== 'running') throw new Error('图片任务已结束或被替换')
      if (current.cancelRequestedAt) throw new Error('图片任务已取消')
      return next
    })
  }
  function watchCancellation(path, record, controller) {
    let checking = false
    const timer = setInterval(async () => {
      if (checking) return
      checking = true
      try {
        const current = await deps.store.readJson(path)
        if (!current || current.requestId !== record.requestId || current.ownerId !== record.ownerId || current.cancelRequestedAt) controller.abort()
      } catch { controller.abort() } finally { checking = false }
    }, 250)
    return () => clearInterval(timer)
  }
  async function failJob(path, record, error) {
    await deps.store.updateJson(path, current => {
      if (current?.requestId !== record.requestId || current.ownerId !== record.ownerId || current.status !== 'running') return current
      const status = current.cancelRequestedAt ? 'cancelled' : 'failed'
      const outcome = record.outcome || 'not_requested'
      const message = record.recovery === 'save' ? '图片已生成，请重试保存，不会重新生图。'
        : status === 'cancelled' ? (outcome === 'not_requested' ? '已取消，尚未请求图片。' : '已取消等待；服务可能已计费，不能保证远端停止生成。')
          : outcome === 'unconfirmed' ? '结果未确认，服务可能已计费；不会自动重新生图。' : error
      return { ...record, ...(current.cancelRequestedAt ? { cancelRequestedAt: current.cancelRequestedAt } : {}), status, outcome, error: message, requests: { ...record.requests, [record.requestId]: { ...record.requests[record.requestId], status, outcome } } }
    })
  }
  async function cancel(sessionId, turn, key, requestId) {
    const { target, path } = await resolve(sessionId, turn)
    if (target.key !== key) throw new Error('正文版本已变化，请返回原版本取消任务')
    await readRecord(path)
    const record = await deps.store.updateJson(path, current => {
      if (!current || current.requestId !== requestId) throw new Error('图片任务已变化，请刷新后取消')
      if (current.status !== 'running' || current.cancelRequestedAt) return current
      return { ...current, cancelRequestedAt: Date.now(), stage: 'cancelling' }
    })
    if (record.cancelRequestedAt) imageAborters.get(record.ownerId)?.(path, record.requestId)
    return present(target, record)
  }
  async function start(sessionId, turn, expectedKey, options = {}) {
    const kind = options.kind || 'generate'
    if (!['generate', 'repaint', 'adjust'].includes(kind)) throw new Error('未知生图操作')
    const instruction = typeof options.instruction === 'string' ? options.instruction.trim() : ''
    if (kind === 'adjust' && (!instruction || instruction.length > 2000)) throw new Error('调整要求须为 1–2000 字符')
    const requestId = options.requestId === undefined ? randomUUID() : options.requestId
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error('生图请求标识不合法')
    const { chat, target, path } = await resolve(sessionId, turn)
    if (expectedKey !== target.key) throw new Error('正文版本已变化，请刷新后生图')
    if (starts.has(path)) return starts.get(path)
    const starting = (async () => {
      const existing = await readRecord(path)
      if (existing?.recovery === 'save') throw new Error('图片已生成，请先重试保存；不会再次请求图片渠道')
      const { active, apiKey } = await capture()
      if (!active.enabled) throw new Error('请先在设置 → DSH Tavern → 场景生图中手动启用')
      if (await deps.isRunning?.(sessionId)) throw new Error('请等待当前正文生成完成后再生图')
      if (Object.hasOwn(existing?.requests || {}, requestId) || (kind === 'generate' && existing?.status === 'succeeded') || existing?.status === 'running' && (jobs.has(path) || ownerIsLive(existing, path))) return present(target, existing)
      checkPurchaseConfirmation(existing, options)
      // A failure may reach disk just before the job's finally removes its handle.
      // An explicit retry waits for that cleanup, rather than returning the old failure.
      if (jobs.has(path)) await jobs.get(path).promise
      if (!channelReady(active, apiKey)) throw new Error('请先在设置中完成生图渠道配置（地址、模型或 API Key）')
      if (typeof deps.attachments()?.saveImage !== 'function' || typeof deps.attachments()?.readImage !== 'function') throw new Error('当前 DSH 未提供图片附件服务，无法保存插画')
      const profile = imageExpressionProfile(active)
      const style = await styles.resolve(active.style, profile)
      const providerTask = ['failed', 'cancelled'].includes(existing?.status) && existing.providerTask && !['rejected', 'failed'].includes(existing.providerTask.state) ? existing.providerTask : undefined
      if (providerTask && (kind !== existing.kind || instruction !== existing.instruction || (options.versionId || '') !== existing.baseVersionId || JSON.stringify({ ...channelSettings(active), style: active.style }) !== JSON.stringify(existing.configuration))) throw new Error('上次 ComfyUI 任务结果待确认，请恢复原渠道与风格配置，并重试原操作以查询；不会重新提交')
      let prepared, material = { omitted: [] }, basePlan, adjustment = false
      if (kind !== 'generate') {
        const version = versionsOf(existing).find(item => item.id === options.versionId)
        if (!version) throw new Error('找不到要重画或调整的图片版本')
        basePlan = applyImageStyle(version.plan || legacyImagePlan(version, 'scene-tags-v1:' + version.model), style)
        adjustment = kind === 'adjust' ? 'adjust' : basePlan.profile !== profile ? 'convert' : false
        prepared = { saved: adjustment ? null : basePlan, input: adjustment ? imageAdjustmentInput(basePlan, instruction, profile, adjustment) : null }
        if (existing?.status === 'failed' && existing.plan && existing.kind === kind && existing.instruction === instruction && existing.baseVersionId === options.versionId && existing.plan.profile === profile && existing.plan.style?.id === style.id) prepared.saved = existing.plan
      } else {
        const historical = await deps.stateAtTarget?.(chat, target)
        const snapshot = sceneInput(chat, target, historical)
        const basic = sceneSources(chat, target, snapshot)
        prepared = await plans.prepare({ chatId: chat.id, target, ...basic, profile })
        material = sceneSources(chat, target, snapshot, prepared.previousTurn ?? target.turn)
        prepared.sources = material.sources
        prepared.gapComplete = material.omitted.length === 0
        prepared.input = { ...prepared.input, sources: material.sources, gapComplete: prepared.gapComplete, budget: { kind: 'characters-not-tokens', maxSourceCharacters: 12000, omitted: material.omitted } }
        if (prepared.saved) prepared.saved = await plans.snapshot(chat.id, prepared.saved)
      }
      const expressionGuidance = imageExpressionGuidance(active)
      if (providerTask) prepared.saved = existing.plan
      if (prepared.input && expressionGuidance) prepared.input = { ...prepared.input, expressionGuidance }
      const selection = deps.selection(sessionId)
      if (!prepared.saved && !selection) throw new Error('请先为当前对话选择模型，供生图 Agent 理解场景')
      const controller = new AbortController()
      let claimed = false
      const record = await deps.store.updateJson(path, current => {
        if (current?.recovery === 'save') throw new Error('图片已生成，请先重试保存；不会再次请求图片渠道')
        if (Object.hasOwn(current?.requests || {}, requestId) || kind === 'generate' && current?.status === 'succeeded' || current?.status === 'running' && ownerIsLive(current, path)) return current
        checkPurchaseConfirmation(current, options)
        claimed = true
        return { key: target.key, turn: target.turn, status: 'running', outcome: providerTask ? 'unconfirmed' : 'not_requested', stage: prepared.saved ? 'generating' : 'planning', kind, instruction, baseVersionId: options.versionId || '', createdAt: Date.now(), requestId, ownerId, ownerPid: process.pid, error: '', ...(providerTask ? { providerTask } : {}), versions: versionsOf(current), deletedVersions: current?.deletedVersions || [], requests: { ...current?.requests, [requestId]: { status: 'running', ...(options.confirmNewRequestId ? { confirmedReplacementOf: options.confirmNewRequestId } : {}) } } }
      })
      if (!claimed) return present(target, record)
      const job = { controller, requestId: record.requestId, promise: null }
      jobs.set(path, job)
      job.promise = execute({ sessionId, chatId: chat.id, target, path, record, prepared, material, adjustment, basePlan, profile, style, active, apiKey, selection, controller })
        .finally(() => jobs.delete(path))
      // Failure to persist a failure is reported locally, never as an unhandled rejection.
      job.promise.catch(() => deps.onStorageError?.())
      return present(target, record)
    })()
    starts.set(path, starting)
    try { return await starting } finally { starts.delete(path) }
  }
  async function execute(input) {
    const { controller, path, target, record, active } = input
    let timer = setTimeout(() => controller.abort(), deps.timeoutMs || 300000)
    const stopWatching = watchCancellation(path, record, controller)
    let attempted = false, plan = input.prepared.saved, providerError = '', validationError = '', result
    try {
      if (!plan) {
        let submissions = 0, submitting = false
        try { result = await deps.runAgent({
          sessionId: input.sessionId, turn: target.turn, task: 'image', persistent: true,
          async resolvePersistentSessionId() {
            const saved = await deps.store.readJson('scene-images/' + hash(String(input.chatId)) + '/agent.json')
            if (!saved) return ''
            if (saved.parentSessionId !== input.sessionId || typeof saved.sessionId !== 'string' || !saved.sessionId) {
              throw new Error('生图子代理会话绑定无效，未创建替代会话')
            }
            return saved.sessionId
          },
          async onPersistentSessionReady(sessionId) {
            await deps.store.writeJson('scene-images/' + hash(String(input.chatId)) + '/agent.json', {
              parentSessionId: input.sessionId, sessionId
            })
            record.traceSessionId = sessionId
            await writeJob(path, record)
          },
          selection: input.selection, system: input.adjustment ? SCENE_ADJUSTMENT_INSTRUCTION : SCENE_PLAN_INSTRUCTION, maxTokens: 4096, signal: controller.signal,
          messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(input.prepared.input) }] }],
          turnContext: '', tools: [input.adjustment ? SCENE_ADJUSTMENT_TOOL : SCENE_PLAN_TOOL],
          maxToolCalls: 2, stopToolsWhen: () => Boolean(plan) || submissions >= 2,
          async onToolCall(call) {
            if (plan || submitting || submissions >= 2) return '方案已提交或校验中，不得重复调用。'
            submissions++
            submitting = true
            try {
              controller.signal.throwIfAborted()
              const current = await deps.chatForSession(input.sessionId)
              if (!current || sceneTarget(current, target.turn).key !== target.key) throw new Error('目标正文已变化，不能提交旧方案')
              plan = input.adjustment
                ? applyImageAdjustment(input.basePlan, call.arguments?.update, input.profile, input.adjustment)
                : await plans.snapshot(input.chatId, await plans.commit(input.prepared, call.arguments?.plan))
              record.plan = plan
              await writeJob(path, record)
              return '方案已校验保存。程序将请求一张图片；不要再调用工具。'
            } catch (error) {
              validationError = redactImageError(error.message || '方案校验失败', input.apiKey).slice(0, 500)
              return '方案校验失败：' + validationError + (submissions < 2 ? '。尚未收费，可修正一次。' : '。修正次数已用完，停止。')
            } finally { submitting = false }
          }
        }) } catch (error) {
          // A valid committed plan survives failure of the final acknowledgement.
          record.traceSessionId = error.traceSessionId || ''
          if (!plan) throw error
        }
      }
      if (!plan) throw new Error(validationError || '生图 Agent 没有提交有效画面方案')
      controller.signal.throwIfAborted()
      plan = applyImageStyle(plan, input.style)
      const prompt = composeSceneImagePrompt(plan)
      record.planId = plan.id
      record.plan = plan
      record.configuration = { ...channelSettings(active), style: active.style }
      record.traceSessionId = result?.traceSessionId || record.traceSessionId || ''
      record.stage = 'queued'
      record.diagnostics = { input: input.prepared.input, omitted: input.material.omitted, planId: plan.id }
      await writeJob(path, record)
      clearTimeout(timer)
      const generated = await imageQueue.run({ requestId: record.requestId, signal: controller.signal }, async () => {
        timer = setTimeout(() => controller.abort(), deps.timeoutMs || 300000)
        record.stage = 'generating'
        record.outcome = 'unconfirmed'
        await writeJob(path, record)
        controller.signal.throwIfAborted()
        attempted = true
        try { return await (deps.generate || generateSceneImage)({ ...active, apiKey: input.apiKey, prompt, plan, providerTask: record.providerTask, async onProviderTask(task) { record.providerTask = task; await writeJob(path, record) }, signal: controller.signal, maxBytes: deps.attachments()?.imageLimits?.maxImageBytes }) }
        catch (error) { record.outcome = record.providerTask ? (['rejected', 'failed'].includes(record.providerTask.state) ? 'rejected' : 'unconfirmed') : error.imageOutcome || 'unconfirmed'; providerError = redactImageError(error.message || '生图失败', input.apiKey); throw error }
      })
      record.stage = 'saving'
      record.recovery = 'save'
      record.outcome = 'received'
      await pendingImages.put(path, record.requestId, generated, deps.attachments()?.imageLimits?.maxImageBytes)
      await writeJob(path, record)
      await savePendingImage(path, record, controller.signal)
    } catch (error) {
      if (!attempted && !record.providerTask) record.outcome = 'not_requested'
      const detail = providerError || validationError || String(error.message || '生图 Agent 未完成任务，请检查当前对话模型或导出日志')
      if (record.recovery === 'save') record.diagnostics = { ...record.diagnostics, storageError: redactImageError(detail, input.apiKey).slice(0, 500) }
      record.planId = plan?.id || ''
      record.traceSessionId ||= error.traceSessionId || ''
      record.diagnostics = { ...record.diagnostics, failure: redactImageError(detail, input.apiKey).slice(0, 500) }
      await failJob(path, record, controller.signal.aborted && !attempted ? '整理画面已超时或取消，尚未请求图片。' : redactImageError(detail, input.apiKey).slice(0, 500))
    } finally { clearTimeout(timer); stopWatching() }
  }
  async function savePendingImage(path, record, signal) {
    const generated = await pendingImages.read(path, record.requestId)
    signal.throwIfAborted()
    // A successfully written attachment reference survives a failed publication.
    // Recovery can publish that same attachment instead of creating a duplicate.
    const attachment = record.savedAttachment || await deps.attachments().saveImage({ data: generated.data, mediaType: generated.mediaType, name: 'scene-illustration' })
    record.savedAttachment = attachment
    await writeJob(path, record)
    signal.throwIfAborted()
    const prompt = composeSceneImagePrompt(record.plan)
    const version = { id: record.requestId, requestId: record.requestId, attachment, plan: record.plan, configuration: record.configuration, prompt, model: generated.metadata?.model || record.configuration.model, ...(generated.metadata ? { generation: generated.metadata } : {}), createdAt: Date.now() }
    const { recovery, savedAttachment, ...completed } = record
    await writeJob(path, record, { ...completed, status: 'succeeded', stage: 'completed', attachment, prompt, model: version.model, versions: [...record.versions, version], requests: { ...record.requests, [record.requestId]: { ...record.requests[record.requestId], status: 'succeeded', outcome: 'received', versionId: version.id } }, completedAt: Date.now() })
    // Cleanup cannot turn a published success into a retryable failure.
    try { await pendingImages.remove(path, record.requestId) } catch { deps.onStorageError?.() }
  }
  async function retrySave(sessionId, turn, key, requestId) {
    const { target, path } = await resolve(sessionId, turn)
    if (target.key !== key) throw new Error('正文版本已变化，请返回原版本重试保存')
    if (starts.has(path)) { await starts.get(path); return retrySave(sessionId, turn, key, requestId) }
    const starting = (async () => {
      const existing = await readRecord(path)
      if (!existing || existing.requestId !== requestId) throw new Error('保存任务已变化，请刷新后重试')
      if (existing.status === 'succeeded' || existing.status === 'running' && ownerIsLive(existing, path)) return present(target, existing)
      if (existing.recovery !== 'save') throw new Error('没有待恢复的图片；此操作不会请求图片渠道')
      if (jobs.has(path)) await jobs.get(path).promise
      let claimed = false
      const record = await deps.store.updateJson(path, current => {
        if (current?.requestId !== requestId || current.recovery !== 'save' || current.status === 'running' && ownerIsLive(current, path)) return current
        claimed = true
        return { ...current, cancelRequestedAt: undefined, status: 'running', stage: 'saving', ownerId, ownerPid: process.pid, error: '', requests: { ...current.requests, [requestId]: { status: 'running' } } }
      })
      if (!claimed) return present(target, record)
      const controller = new AbortController()
      const job = { controller, requestId: record.requestId, promise: null }
      jobs.set(path, job)
      const stopWatching = watchCancellation(path, record, controller)
      job.promise = (async () => {
        try { await savePendingImage(path, record, controller.signal) }
        catch { await failJob(path, record, '图片保存仍未完成，请检查存储后重试保存；不会重新生图。') }
      })().finally(() => { stopWatching(); jobs.delete(path) })
      job.promise.catch(() => deps.onStorageError?.())
      return present(target, record)
    })()
    starts.set(path, starting)
    try { return await starting } finally { starts.delete(path) }
  }
  async function readImage(sessionId, turn, key, versionId) {
    const { target, path } = await resolve(sessionId, turn)
    if (target.key !== key) throw new Error('图片不属于当前正文版本')
    const record = await readRecord(path)
    const versions = versionsOf(record)
    const version = versionId ? versions.find(item => item.id === versionId) : versions.at(-1)
    if (!version?.attachment) throw new Error('图片尚未就绪或已删除')
    return deps.attachments().readImage(version.attachment)
  }
  async function removeImage(sessionId, turn, key, versionId) {
    const { target, path } = await resolve(sessionId, turn)
    if (target.key !== key) throw new Error('正文版本已变化')
    const next = await deps.store.updateJson(path, record => {
      if (record?.status === 'running') throw new Error('请等待当前生图任务结束后删除图片')
      if (record?.recovery === 'save') throw new Error('请先恢复待保存的图片，再删除图片版本')
      const versions = versionsOf(record)
      const removed = versions.find(item => item.id === versionId)
      if (!removed) throw new Error('图片版本不存在')
      const kept = versions.filter(item => item.id !== versionId)
      // Detach only this version. Host attachments may be shared; do not delete
      // their bytes blindly. Keep a tombstone for subsequent reference-aware GC.
      return { ...record, versions: kept, status: kept.length ? 'succeeded' : 'idle', error: '', deletedVersions: [...(record.deletedVersions || []), { ...removed, deletedAt: Date.now() }] }
    })
    return present(target, next)
  }
  return { settings, configure, status, start, cancel, retrySave, readImage, removeImage,
    async dispose() { for (const job of jobs.values()) job.controller.abort(); await Promise.allSettled([...jobs.values()].map(job => job.promise)); imageHosts.delete(ownerId); imageAborters.delete(ownerId) }
  }
}
