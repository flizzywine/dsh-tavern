import { createHash, randomUUID } from 'node:crypto'
import { projectAgentContent } from './runtime-content-projection.js'
import { generateSceneImage, imageSettings } from './scene-image-provider.js'
import { createScenePlans, SCENE_PLAN_INSTRUCTION, SCENE_PLAN_TOOL } from './scene-plan.js'

export const IMAGE_CREDENTIAL = 'DSH_TAVERN_IMAGE_API_KEY'
const hash = value => createHash('sha256').update(value).digest('hex')

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
  const jobs = new Map()
  const starts = new Map()
  let configurationWrite = Promise.resolve()
  const plans = createScenePlans({ store: deps.store })
  const settingsPath = 'scene-images/settings.json'
  const pathFor = (chatId, key) => 'scene-images/' + hash(String(chatId)) + '/' + key + '.json'
  async function config() { return imageSettings(await deps.store.readJson(settingsPath) || {}) }
  async function settings() {
    const credential = await deps.credentials()?.resolve(IMAGE_CREDENTIAL)
    const current = await config()
    return { ...current, hasKey: Boolean(credential?.value), ready: Boolean(current.model && credential?.value) }
  }
  function configure(input = {}) {
    // Serialize partial saves/toggles so concurrent tabs cannot lose settings.
    const write = configurationWrite.then(() => saveConfiguration(input))
    configurationWrite = write.catch(() => {})
    return write
  }
  async function saveConfiguration(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('生图配置必须是对象')
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('启用状态必须为布尔值')
    const current = await settings()
    const next = imageSettings({ ...current, ...input })
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('API Key 必须是文本')
    // Configuration and explicit opt-in are separate operations. Old credentials
    // alone are not permission to start a paid request after upgrading.
    if (input.enabled === true && (!current.ready || !next.model)) throw new Error('请先保存完整生图配置，再手动启用')
    if (input.apiKey?.trim()) {
      const credentials = deps.credentials()
      if (typeof credentials?.set !== 'function') throw new Error('当前 DSH 不支持保存凭据，请配置 DSH_TAVERN_IMAGE_API_KEY')
      await credentials.set(IMAGE_CREDENTIAL, input.apiKey.trim())
    }
    if (!next.model) next.enabled = false
    await deps.store.writeJson(settingsPath, next)
    return settings()
  }
  async function resolve(sessionId, turn) {
    const chat = await deps.chatForSession(sessionId)
    const target = sceneTarget(chat, turn)
    return { chat, target, path: pathFor(chat.id, target.key) }
  }
  async function readRecord(path) {
    const record = await deps.store.readJson(path)
    if (record?.status === 'running' && !jobs.has(path) && !starts.has(path)) {
      return deps.store.updateJson(path, current => current?.status === 'running'
        ? { ...current, status: 'failed', error: '生图因服务重启中断。供应商可能已计费，请确认后重试。' } : current)
    }
    return record
  }
  function present(target, record) {
    const { attachment, diagnostics, ...publicRecord } = record || {}
    return { key: target.key, turn: target.turn, status: 'idle', ...publicRecord }
  }
  async function status(sessionId, turn) {
    const { target, path } = await resolve(sessionId, turn)
    return present(target, await readRecord(path))
  }
  async function start(sessionId, turn, expectedKey) {
    const { chat, target, path } = await resolve(sessionId, turn)
    if (expectedKey !== target.key) throw new Error('正文版本已变化，请刷新后生图')
    if (starts.has(path)) return starts.get(path)
    const starting = (async () => {
      const active = await config()
      if (!active.enabled) throw new Error('请先在设置 → DSH Tavern → 场景生图中手动启用')
      if (await deps.isRunning?.(sessionId)) throw new Error('请等待当前正文生成完成后再生图')
      const existing = await readRecord(path)
      if (existing?.status === 'succeeded' || existing?.status === 'running' && jobs.has(path)) return present(target, existing)
      // A failure may reach disk just before the job's finally removes its handle.
      // An explicit retry waits for that cleanup, rather than returning the old failure.
      if (jobs.has(path)) await jobs.get(path).promise
      if (!active.model) throw new Error('请先在设置 → DSH Tavern → 场景生图中填写模型与 API Key')
      const credential = await deps.credentials()?.resolve(IMAGE_CREDENTIAL)
      if (!credential?.value) throw new Error('请先在设置中配置生图 API Key')
      if (typeof deps.attachments()?.saveImage !== 'function' || typeof deps.attachments()?.readImage !== 'function') throw new Error('当前 DSH 未提供图片附件服务，无法保存插画')
      const selection = deps.selection(sessionId)
      if (!selection) throw new Error('请先为当前对话选择模型，供生图 Agent 理解场景')
      const historical = await deps.stateAtTarget?.(chat, target)
      const snapshot = sceneInput(chat, target, historical)
      const basic = sceneSources(chat, target, snapshot)
      const prepared = await plans.prepare({ chatId: chat.id, target, ...basic, profile: 'scene-tags-v1:' + active.model })
      const material = sceneSources(chat, target, snapshot, prepared.previousTurn ?? target.turn)
      prepared.sources = material.sources
      prepared.gapComplete = material.omitted.length === 0
      prepared.input = { ...prepared.input, sources: material.sources, gapComplete: prepared.gapComplete, budget: { kind: 'characters-not-tokens', maxSourceCharacters: 12000, omitted: material.omitted } }
      const controller = new AbortController()
      const record = { key: target.key, turn: target.turn, status: 'running', stage: 'planning', createdAt: Date.now(), requestId: randomUUID(), error: '' }
      await deps.store.writeJson(path, record)
      const job = { controller, promise: null }
      jobs.set(path, job)
      job.promise = execute({ sessionId, chatId: chat.id, target, path, record, prepared, material, active, apiKey: credential.value, selection, controller })
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
          selection: input.selection, system: SCENE_PLAN_INSTRUCTION, maxTokens: 4096, signal: controller.signal,
          messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(input.prepared.input) }] }],
          turnContext: '', tools: [SCENE_PLAN_TOOL],
          maxToolCalls: 2, stopToolsWhen: () => Boolean(plan) || submissions >= 2,
          async onToolCall(call) {
            if (plan || submitting || submissions >= 2) return '方案已提交或校验中，不得重复调用。'
            submissions++
            submitting = true
            try {
              controller.signal.throwIfAborted()
              const current = await deps.chatForSession(input.sessionId)
              if (!current || sceneTarget(current, target.turn).key !== target.key) throw new Error('目标正文已变化，不能提交旧方案')
              plan = await plans.commit(input.prepared, call.arguments?.plan)
              return '方案已校验保存。程序将请求一张图片；不要再调用工具。'
            } catch (error) {
              validationError = String(error.message || '方案校验失败').replaceAll(input.apiKey, '[已隐藏]').slice(0, 500)
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
      record.planId = plan.id
      record.traceSessionId = result?.traceSessionId || record.traceSessionId || ''
      record.stage = 'generating'
      record.diagnostics = { input: input.prepared.input, omitted: input.material.omitted, planId: plan.id }
      await deps.store.writeJson(path, record)
      attempted = true
      let generated
      try { generated = await (deps.generate || generateSceneImage)({ ...active, apiKey: input.apiKey, prompt: plan.prompt, signal: controller.signal, maxBytes: deps.attachments()?.imageLimits?.maxImageBytes }) }
      catch (error) { providerError = String(error.message || '生图失败').replaceAll(input.apiKey, '[已隐藏]'); throw error }
      controller.signal.throwIfAborted()
      record.stage = 'saving'
      await deps.store.writeJson(path, record)
      attachment = await deps.attachments().saveImage({ ...generated, name: 'scene-illustration' })
      const current = await deps.chatForSession(input.sessionId)
      if (!current || current.id !== input.chatId || sceneTarget(current, target.turn).key !== target.key) throw new Error('正文已切换或被删除，图片未挂载到其他版本')
      await deps.store.writeJson(path, { ...record, status: 'succeeded', stage: 'completed', attachment, prompt: plan.prompt, model: active.model, completedAt: Date.now() })
    } catch (error) {
      const detail = providerError || validationError || String(error.message || '生图 Agent 未完成任务，请检查当前对话模型或导出日志')
      await deps.store.writeJson(path, { ...record, status: 'failed', planId: plan?.id || '', traceSessionId: record.traceSessionId || error.traceSessionId || '', error: controller.signal.aborted ? (attempted ? '生图已超时或取消，供应商可能已计费，请确认后重试。' : '整理画面已超时或取消，尚未请求图片。') : detail.replaceAll(input.apiKey, '[已隐藏]').slice(0, 500) })
    } finally { clearTimeout(timer) }
  }
  async function readImage(sessionId, turn, key) {
    const { target, path } = await resolve(sessionId, turn)
    if (target.key !== key) throw new Error('图片不属于当前正文版本')
    const record = await readRecord(path)
    if (record?.status !== 'succeeded' || !record.attachment) throw new Error('图片尚未就绪')
    return deps.attachments().readImage(record.attachment)
  }
  return { settings, configure, status, start, readImage,
    async dispose() { for (const job of jobs.values()) job.controller.abort(); await Promise.allSettled([...jobs.values()].map(job => job.promise)) }
  }
}
