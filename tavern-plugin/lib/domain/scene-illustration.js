import { createHash, randomUUID } from 'node:crypto'
import { projectAgentContent } from './runtime-content-projection.js'
import { generateSceneImage } from './scene-image-provider.js'
import { createSceneImageSettings } from './scene-image-settings.js'
import { channelSettings, channelReady, imageExpressionProfile, imageExpressionGuidance } from './scene-image-channels.js'
import { createScenePlans, SCENE_PLAN_INSTRUCTION, SCENE_PLAN_TOOL } from './scene-plan.js'
import { imageAdjustmentInput, applyImageAdjustment, legacyImagePlan, SCENE_ADJUSTMENT_INSTRUCTION, SCENE_ADJUSTMENT_TOOL } from './scene-image-adjustment.js'
import { createSceneImageStyles, applyImageStyle, composeSceneImagePrompt } from './scene-image-style.js'

export const IMAGE_CREDENTIAL = 'DSH_TAVERN_IMAGE_API_KEY'
const hash = value => createHash('sha256').update(value).digest('hex')
const redactImageError = (value, key) => key ? String(value).replaceAll(key, '[已隐藏]') : String(value)
const imageHosts = new Map()
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
  const { config, settings, configure, capture } = createSceneImageSettings(deps)
  const plans = createScenePlans({ store: deps.store })
  const styles = createSceneImageStyles({ store: deps.store })
  const pathFor = (chatId, key) => 'scene-images/' + hash(String(chatId)) + '/' + key + '.json'
  async function resolve(sessionId, turn) {
    const chat = await deps.chatForSession(sessionId)
    const target = sceneTarget(chat, turn)
    return { chat, target, path: pathFor(chat.id, target.key) }
  }
  async function readRecord(path) {
    const record = await deps.store.readJson(path)
    if (record?.status === 'running' && !jobs.has(path) && !starts.has(path) && !ownerIsLive(record, path)) {
      return deps.store.updateJson(path, current => current?.status === 'running' && !ownerIsLive(current, path)
        ? { ...current, status: 'failed', error: '生图因服务重启中断。供应商可能已计费，请确认后重试。' } : current)
    }
    return record
  }
  function present(target, record) {
    const { attachment, diagnostics, plan, requests, versions, deletedVersions, ownerId, ownerPid, ...publicRecord } = record || {}
    const configuration = value => value?.workflow ? { ...value, workflow: { name: value.workflow.name, digest: value.workflow.digest } } : value
    return { key: target.key, turn: target.turn, status: 'idle', ...publicRecord, ...(publicRecord.configuration ? { configuration: configuration(publicRecord.configuration) } : {}), versions: versionsOf(record).map(({ attachment, plan, ...item }) => ({ ...item, configuration: configuration(item.configuration), description: plan?.description || '', profile: plan?.profile || '' })) }
  }
  async function status(sessionId, turn) {
    const { target, path } = await resolve(sessionId, turn)
    const current = await config()
    return { ...present(target, await readRecord(path)), enabled: current.enabled, profile: imageExpressionProfile(current) }
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
      const { active, apiKey } = await capture()
      if (!active.enabled) throw new Error('请先在设置 → DSH Tavern → 场景生图中手动启用')
      if (await deps.isRunning?.(sessionId)) throw new Error('请等待当前正文生成完成后再生图')
      const existing = await readRecord(path)
      if (Object.hasOwn(existing?.requests || {}, requestId) || (kind === 'generate' && existing?.status === 'succeeded') || existing?.status === 'running' && (jobs.has(path) || ownerIsLive(existing, path))) return present(target, existing)
      // A failure may reach disk just before the job's finally removes its handle.
      // An explicit retry waits for that cleanup, rather than returning the old failure.
      if (jobs.has(path)) await jobs.get(path).promise
      if (!channelReady(active, apiKey)) throw new Error('请先在设置中完成生图渠道配置（地址、模型或 API Key）')
      if (typeof deps.attachments()?.saveImage !== 'function' || typeof deps.attachments()?.readImage !== 'function') throw new Error('当前 DSH 未提供图片附件服务，无法保存插画')
      const profile = imageExpressionProfile(active)
      const style = await styles.resolve(active.style, profile)
      const providerTask = existing?.status === 'failed' && existing.providerTask && !['rejected', 'failed'].includes(existing.providerTask.state) ? existing.providerTask : undefined
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
        if (Object.hasOwn(current?.requests || {}, requestId) || kind === 'generate' && current?.status === 'succeeded' || current?.status === 'running' && ownerIsLive(current, path)) return current
        claimed = true
        return { key: target.key, turn: target.turn, status: 'running', stage: prepared.saved ? 'generating' : 'planning', kind, instruction, baseVersionId: options.versionId || '', createdAt: Date.now(), requestId, ownerId, ownerPid: process.pid, error: '', ...(providerTask ? { providerTask } : {}), versions: versionsOf(current), deletedVersions: current?.deletedVersions || [], requests: { ...current?.requests, [requestId]: { status: 'running' } } }
      })
      if (!claimed) return present(target, record)
      const job = { controller, promise: null }
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
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs || 300000)
    let attempted = false, attachment, plan = input.prepared.saved, providerError = '', validationError = '', result
    try {
      if (!plan) {
        let submissions = 0, submitting = false
        try { result = await deps.runAgent({
          sessionId: input.sessionId, turn: target.turn, task: 'image', persistent: false,
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
              await deps.store.writeJson(path, record)
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
      record.stage = 'generating'
      record.diagnostics = { input: input.prepared.input, omitted: input.material.omitted, planId: plan.id }
      await deps.store.writeJson(path, record)
      attempted = true
      let generated
      try { generated = await (deps.generate || generateSceneImage)({ ...active, apiKey: input.apiKey, prompt, plan, providerTask: record.providerTask, async onProviderTask(task) { record.providerTask = task; await deps.store.writeJson(path, record) }, signal: controller.signal, maxBytes: deps.attachments()?.imageLimits?.maxImageBytes }) }
      catch (error) { providerError = redactImageError(error.message || '生图失败', input.apiKey); throw error }
      controller.signal.throwIfAborted()
      record.stage = 'saving'
      await deps.store.writeJson(path, record)
      attachment = await deps.attachments().saveImage({ data: generated.data, mediaType: generated.mediaType, name: 'scene-illustration' })
      // The record remains under the frozen target key, even if another swipe is
      // selected while the request runs. Reading still requires the exact target.
      const version = { id: record.requestId, requestId: record.requestId, attachment, plan, configuration: record.configuration, prompt, model: generated.metadata?.model || active.model, ...(generated.metadata ? { generation: generated.metadata } : {}), createdAt: Date.now() }
      await deps.store.writeJson(path, { ...record, status: 'succeeded', stage: 'completed', attachment, prompt, model: version.model, versions: [...record.versions, version], requests: { ...record.requests, [record.requestId]: { status: 'succeeded', versionId: version.id } }, completedAt: Date.now() })
    } catch (error) {
      const detail = providerError || validationError || String(error.message || '生图 Agent 未完成任务，请检查当前对话模型或导出日志')
      await deps.store.writeJson(path, { ...record, status: 'failed', requests: { ...record.requests, [record.requestId]: { status: 'failed' } }, planId: plan?.id || '', traceSessionId: record.traceSessionId || error.traceSessionId || '', error: controller.signal.aborted ? (attempted ? '生图已超时或取消，供应商可能已计费，请确认后重试。' : '整理画面已超时或取消，尚未请求图片。') : redactImageError(detail, input.apiKey).slice(0, 500) })
    } finally { clearTimeout(timer) }
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
  return { settings, configure, status, start, readImage, removeImage,
    async dispose() { for (const job of jobs.values()) job.controller.abort(); await Promise.allSettled([...jobs.values()].map(job => job.promise)); imageHosts.delete(ownerId) }
  }
}
