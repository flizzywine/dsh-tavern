import { randomUUID } from 'node:crypto'
import { computeRequestCacheDiff } from './request-cache-diff.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// DSH usage buckets are disjoint: inputTokens excludes cache reads and cache writes.
// cacheWrite1hTokens + cacheWrite5mTokens split cacheWriteTokens by Anthropic cache TTL.
function providerUsage(usage) {
  return Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cacheWrite1hTokens', 'cacheWrite5mTokens']
    .filter(key => Number.isSafeInteger(usage[key])).map(key => [key, usage[key]]))
}

function phaseEntries(messages, phase) {
  const name = 'tavern:runtime-preset-' + phase
  return (Array.isArray(messages) ? messages : []).filter(function (message) {
    return Array.isArray(message && message.source && message.source.sections) && message.source.sections.some(function (section) { return section && section.name === name })
  })
}

function redactRequestMetadata(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactRequestMetadata)
  if (typeof value.entries === 'function' && typeof value.get === 'function') value = Object.fromEntries(value.entries())
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(authorization|proxy-authorization|cookie|set-cookie|.*api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password)$/i.test(key) ? '[REDACTED]' : redactRequestMetadata(item)]))
}

function serializableRequest(options) {
  const result = {}
  for (const [key, value] of Object.entries(options || {})) {
    if (key === 'signal') continue
    // Preserve prompt/tool evidence verbatim; redact transport/config metadata only.
    result[key] = ['messages', 'tools', 'system'].includes(key) ? value : redactRequestMetadata({ [key]: value })[key]
  }
  // The complete evidence record is serialized and detached once below. Keeping
  // prompt/tool references here avoids a second JSON round trip of the largest field.
  return result
}

// Keep the public evidence shape stable; phases are a projection of the request.
function evidenceRecord(record, result) {
  const messages = record.request && record.request.messages
  return {
    ...record,
    ...(result || {}),
    version: 1,
    phases: record.phases || {
      front: phaseEntries(messages, 'front'),
      middle: phaseEntries(messages, 'middle'),
      back: phaseEntries(messages, 'back')
    }
  }
}

// Request bodies are debugging evidence (every agent step of a long chat is
// several MB); keep the full text of the most recent turns only, and within
// them at most MODEL_REQUEST_KEEP_BYTES per game (one turn of tool steps or
// rerolls can hold dozens of near-identical bodies). Index rows, timing and
// responses stay for every request; the newest body of each session stays.
export const MODEL_REQUEST_KEEP_TURNS = 3
export const MODEL_REQUEST_KEEP_BYTES = 8 * 1024 * 1024
const PRUNED_NOTE = '该请求原文已清理（只保留最近 ' + MODEL_REQUEST_KEEP_TURNS + ' 轮、每局 8 MB 以内的请求原文）'

export function createModelRequestLog(options = {}) {
  const readJson = options.readJson
  const writeJson = options.writeJson
  const updateJson = options.updateJson
  const remove = typeof options.remove === 'function' ? options.remove : async function () {}
  // Bodies are written compactly when the adapter allows: indentation alone inflates MBs.
  const writeBody = typeof options.writeText === 'function'
    ? function (path, value, serialized) { return options.writeText(path, serialized ?? JSON.stringify(value)) }
    : function (path, value) { return writeJson(path, value) }
  const now = typeof options.now === 'function' ? options.now : Date.now
  const id = typeof options.id === 'function' ? options.id : function () { return randomUUID() }
  if (typeof readJson !== 'function' || typeof writeJson !== 'function' || typeof updateJson !== 'function') throw new TypeError('模型请求日志缺少存储适配器')

  // Cache only durable ownership, never request bodies. Bound idle-session memory.
  const sessionOwners = new Map()
  const ownerWrites = new Map()
  function rememberOwner(sessionId, chatId) {
    sessionOwners.delete(sessionId)
    sessionOwners.set(sessionId, chatId)
    if (sessionOwners.size > 512) sessionOwners.delete(sessionOwners.keys().next().value)
  }
  async function ensureSessionOwner(sessionId, chatId) {
    if (!sessionId) return
    const previous = ownerWrites.get(sessionId)
    if (previous) {
      await previous.catch(() => {})
      return ensureSessionOwner(sessionId, chatId)
    }
    if (sessionOwners.get(sessionId) === chatId) return
    const pending = (async () => {
      const path = 'model-request-sessions/' + encodeURIComponent(sessionId) + '.json'
      const saved = await readJson(path)
      if (saved?.chatId !== chatId) await writeJson(path, { chatId })
      rememberOwner(sessionId, chatId)
    })()
    ownerWrites.set(sessionId, pending)
    try { await pending } finally { if (ownerWrites.get(sessionId) === pending) ownerWrites.delete(sessionId) }
  }

  // Writes run off the request path, in order per chat: completion follows its record.
  const queues = new Map()
  const runningCreatedAt = new Map()
  function enqueue(chatId, task) {
    const next = (queues.get(chatId) || Promise.resolve()).then(task)
    const settled = next.catch(function (error) { console.error('dsh-tavern: 模型请求日志写入失败', str(error && error.message || error)) })
    queues.set(chatId, settled)
    settled.then(function () { if (queues.get(chatId) === settled) queues.delete(chatId) })
    return next
  }
  // Readers see every record already returned to a caller.
  function settled(chatId) { return queues.get(str(chatId)) || Promise.resolve() }
  // Mark rows beyond the retained window; the caller deletes their bodies afterwards.
  function retainRecentBodies(requests, latestTurn, pruned) {
    const cutoff = latestTurn - MODEL_REQUEST_KEEP_TURNS
    const newestOfSession = new Set()
    let kept = 0
    const decisions = new Array(requests.length).fill(false)
    for (let index = requests.length - 1; index >= 0; index--) {
      const entry = requests[index]
      if (!entry || entry.pruned) continue
      const session = str(entry.sessionId) + '|' + str(entry.scope)
      const newest = !newestOfSession.has(session)
      newestOfSession.add(session)
      const turn = Number(entry.turn)
      const old = cutoff >= 1 && turn > 0 && turn <= cutoff
      kept += Math.max(0, Number(entry.bytes) || 0)
      decisions[index] = !newest && (old || kept > MODEL_REQUEST_KEEP_BYTES)
    }
    return requests.map(function (entry, index) {
      if (!decisions[index]) return entry
      pruned.push(entry.id)
      return Object.assign({}, entry, { pruned: true })
    })
  }
  // Apply the retention window to a game already on disk (maintenance).
  function prune(chatId) {
    return enqueue(str(chatId), async function () {
      const base = 'model-requests/' + str(chatId) + '/'
      const index = await readJson(base + 'index.json')
      const requests = Array.isArray(index && index.requests) ? index.requests : []
      if (requests.length === 0) return { pruned: 0 }
      // Older rows have no recorded size; measure their bodies once.
      const sizes = new Map()
      if (typeof options.size === 'function') {
        for (const entry of requests) if (entry && !entry.pruned && !(Number(entry.bytes) > 0)) sizes.set(entry.id, await options.size(base + entry.id + '.json'))
      }
      const latestTurn = requests.reduce((max, entry) => Math.max(max, Number(entry && entry.turn) || 0, Number(entry && entry.agentTurn) || 0), 0)
      const pruned = []
      await updateJson(base + 'index.json', function (value) {
        const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const rows = (Array.isArray(current.requests) ? current.requests : []).map(entry => sizes.has(entry?.id) ? { ...entry, bytes: sizes.get(entry.id) } : entry)
        return { ...current, requests: retainRecentBodies(rows, latestTurn, pruned) }
      })
      for (const prunedId of pruned) await remove(base + prunedId + '.json')
      return { pruned: pruned.length }
    })
  }

  async function record(input) {
    const chat = input.chat
    const context = input.context
    const coordinates = input.coordinates
    const requestOptions = input.options
    const stamp = now()
    const requestId = stamp.toString(36) + '-' + id()
    const scope = context && context.scope === 'background' ? 'background' : 'foreground'
    const turn = scope === 'background' ? Math.max(0, Number(context.turn) || 0) : Math.max(0, Number(coordinates && coordinates.turn) || 0)
    const systemSections = Array.isArray(input.systemSections)
      ? input.systemSections
          .filter(item => item && typeof item === 'object' && typeof item.name === 'string' && Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end > item.start)
          .map(item => ({ name: item.name, start: item.start, end: item.end }))
      : []
    const draft = {
      version: 2,
      id: requestId,
      chatId: chat.id,
      scope,
      task: scope === 'background' ? str(context.task) : str(context && context.task) || 'reply',
      sessionId: str(requestOptions && requestOptions.sessionId),
      turn,
      agentTurn: Math.max(0, Number(coordinates && coordinates.turn) || 0),
      step: Math.max(1, Number(coordinates && coordinates.step) || 1),
      createdAt: stamp,
      status: 'running',
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      compatibility: chat.requestMode === 'sillytavern' && chat.compatibilityTraces && chat.compatibilityTraces[String(turn)]
        ? chat.compatibilityTraces[String(turn)]
        : null,
      frame: coordinates && coordinates.frame ? JSON.parse(JSON.stringify(coordinates.frame)) : null,
      ...(context && context.window ? { window: { first: context.window.first, through: context.window.through } } : {}),
      ...(systemSections.length ? { systemSections } : {}),
      bypassPlan: {
        id: str(chat.bypassPlanId || chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.planId),
        name: str(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.planName),
        digest: str(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.digest)
      },
      request: serializableRequest(requestOptions)
    }
    // One immutable representation drives the detached evidence, byte accounting and
    // text write. The queue changes only scheduling; it no longer stringifies MBs again.
    const serialized = JSON.stringify(draft)
    const record = JSON.parse(serialized)
    const base = 'model-requests/' + chat.id + '/'
    const createdKey = chat.id + ':' + requestId
    if (runningCreatedAt.size >= 128) runningCreatedAt.delete(runningCreatedAt.keys().next().value)
    runningCreatedAt.set(createdKey, stamp)
    // The body was cloned above; the model request itself must not wait for the disk.
    enqueue(chat.id, async function () {
      const bytes = Buffer.byteLength(serialized)
      await writeBody(base + requestId + '.json', record, serialized)
      // Persist timing separately so completion after a restart never loads the body.
      await writeJson(base + requestId + '.result.json', { createdAt: stamp, status: 'running' })
      const pruned = []
      await updateJson(base + 'index.json', function (value) {
        const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const requests = Array.isArray(current.requests) ? current.requests : []
        return {
          version: 1,
          chatId: chat.id,
          requests: retainRecentBodies(requests.concat([{
            id: requestId, scope, task: record.task, sessionId: record.sessionId,
            turn: record.turn, agentTurn: record.agentTurn, step: record.step,
            createdAt: record.createdAt, preset: record.preset, bytes, ...(record.window ? { window: record.window } : {})
          }]), Math.max(turn, record.agentTurn), pruned)
        }
      })
      for (const prunedId of pruned) await remove(base + prunedId + '.json')
      await ensureSessionOwner(record.sessionId, chat.id)
      if (record.sessionId) options.onChange?.(record.sessionId, requestId + ':running')
    })
    return evidenceRecord({ ...draft, request: record.request, compatibility: record.compatibility, frame: record.frame })
  }

  function complete(input = {}) {
    return enqueue(str(input.chatId), function () { return completeNow(input) })
  }
  async function completeNow(input) {
    const chatId = str(input.chatId)
    const id = str(input.id)
    const base = 'model-requests/' + chatId + '/'
    const path = base + id + '.json'
    const resultPath = base + id + '.result.json'
    const createdKey = chatId + ':' + id
    const cachedCreatedAt = runningCreatedAt.get(createdKey)
    runningCreatedAt.delete(createdKey)
    // Old records have no sidecar. Read them once when completing, without rewriting.
    const previous = cachedCreatedAt !== undefined ? { createdAt: cachedCreatedAt } : (await readJson(resultPath) || await readJson(path))
    if (!previous) return null
    const completedAt = now()
    const createdAt = Number.isFinite(previous.createdAt) ? previous.createdAt : completedAt
    const interrupted = input.interrupted === true || (!input.finish && !input.error) || input.finish?.kind === 'aborted'
    const error = str(input.error) || (interrupted ? '模型流已中断，未确认完整结束。' : input.finish?.kind === 'error' ? '模型返回错误结束标记。' : '')
    const result = {
      createdAt,
      status: interrupted ? 'interrupted' : error !== '' ? 'failed' : 'completed',
      ...(input.timing ? {timing:input.timing} : {}),
      ...(input.usage ? { usage: providerUsage(input.usage) } : {}),
      completedAt,
      durationMs: Math.max(0, completedAt - createdAt),
      response: {
        text: str(input.text),
        finish: input.finish === undefined ? null : JSON.parse(JSON.stringify(input.finish)),
        error: error || null
      }
    }
    await writeJson(resultPath, result)
    if (input.sessionId) options.onChange?.(input.sessionId, id + ':' + result.status)
    // Callers needing the full request use evidence(); completion returns only state.
    return result
  }

  async function evidence(chatId, turn) {
    await settled(chatId)
    const base = 'model-requests/' + chatId + '/'
    const index = await readJson(base + 'index.json')
    const entries = Array.isArray(index && index.requests) ? index.requests.filter(function (item) {
      return !Number.isSafeInteger(Number(turn)) || Number(turn) < 1 || Number(item.turn) === Number(turn)
    }) : []
    const requests = []
    for (const entry of entries) {
      if (entry.pruned) {
        requests.push(Object.assign({}, entry, await readJson(base + entry.id + '.result.json'), { pruned: true, note: PRUNED_NOTE, request: null }))
        continue
      }
      const record = await readJson(base + entry.id + '.json')
      if (record) requests.push(evidenceRecord(record, await readJson(base + entry.id + '.result.json')))
    }
    return { loaded: true, chatId, requests }
  }

  async function list(chatId) {
    await settled(chatId)
    const index = await readJson('model-requests/' + chatId + '/index.json')
    return Array.isArray(index?.requests) ? index.requests : []
  }
  async function detail(chatId, id) {
    const entries = await list(chatId)
    const entry = entries.find(item => item.id === id)
    if (!entry) throw new Error('请求记录不存在')
    if (entry.pruned) throw new Error(PRUNED_NOTE)
    const base = 'model-requests/' + chatId + '/'
    const record = await readJson(base + id + '.json')
    if (!record) throw new Error('请求记录已缺失')
    return evidenceRecord(record, await readJson(base + id + '.result.json'))
  }
  function isForegroundTurnEntry(item) {
    return (Number(item?.turn) || 0) > 0 || (Number(item?.agentTurn) || 0) > 0
  }
  function filterEntriesForScope(entries, sessionId, options = {}) {
    const requestedScope = options && (options.scope === 'foreground' || options.scope === 'background') ? options.scope : ''
    let matched = (Array.isArray(entries) ? entries : []).filter(item => {
      // 前台切换查看本局后台上下文时，后台条目的 sessionId 属于后台子代理而非前台会话
      if (sessionId && item.sessionId && item.sessionId !== sessionId && requestedScope !== 'background') return false
      if (requestedScope) return item.scope === requestedScope
      return sessionId ? true : item.scope === 'foreground'
    })
    const primary = matched.filter(item => item.task !== 'compaction')
    if (primary.length > 0) matched = primary
    if (matched.some(item => item.scope === 'foreground' && isForegroundTurnEntry(item))) {
      const foregroundTurns = matched.filter(item => item.scope !== 'foreground' || isForegroundTurnEntry(item))
      if (foregroundTurns.length > 0) matched = foregroundTurns
    }
    return matched
  }
  async function latest(chatId, knownId, sessionId, options = {}) {
    const entries = await list(chatId)
    const matched = filterEntriesForScope(entries, sessionId, options)
    const entry = matched.at(-1)
    if (!entry) return null
    const base = 'model-requests/' + chatId + '/'
    const result = await readJson(base + entry.id + '.result.json')
    const currentStatus = result?.status || 'running'
    const knownStatus = options && typeof options.knownStatus === 'string' ? options.knownStatus : ''
    if (knownId === entry.id && (!knownStatus || knownStatus === currentStatus)) return { unchanged: true, id: entry.id }
    const record = await readJson(base + entry.id + '.json')
    if (!record) return null
    const full = evidenceRecord(record, result)
    let previousEntry = null
    for (let i = matched.length - 2; i >= 0; i--) {
      const candidate = matched[i]
      if (!candidate) continue
      if (candidate.scope !== entry.scope) continue
      if ((candidate.task === 'compaction') !== (entry.task === 'compaction')) continue
      previousEntry = candidate
      break
    }
    const previousRecord = previousEntry && !previousEntry.pruned ? await readJson(base + previousEntry.id + '.json') : null
    return { ...full, cacheDiff: computeRequestCacheDiff(full, previousRecord, previousEntry) }
  }
  async function recentSeries(chatId, options = {}) {
    if (!chatId) return []
    const entries = await list(chatId)
    let matched = filterEntriesForScope(entries, options.sessionId, {
      scope: options.scope === 'background' ? 'background' : 'foreground'
    })
    matched = matched.filter(item => item.task !== 'compaction')
    const rawLimit = Number(options.limit)
    const limit = Math.max(1, Math.min(24, Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 12))
    const slice = matched.slice(-limit)
    const base = 'model-requests/' + chatId + '/'
    const results = await Promise.all(slice.map(entry => readJson(base + entry.id + '.result.json')))
    return slice.map((entry, index) => {
      const result = results[index] || null
      const usage = result && typeof result.usage === 'object' ? result.usage : null
      const inputTokens = Number(usage?.inputTokens) || 0
      const cacheReadTokens = Number(usage?.cacheReadTokens) || 0
      const cacheWriteTokens = Number(usage?.cacheWriteTokens) || 0
      const totalInput = inputTokens + cacheReadTokens + cacheWriteTokens
      return {
        id: entry.id,
        turn: Number(entry.turn) || 0,
        step: Number(entry.step) || 0,
        createdAt: result?.createdAt || entry.createdAt || 0,
        status: result?.status || 'running',
        tokens: totalInput > 0 ? totalInput : null,
        cacheReadTokens: usage ? cacheReadTokens : null
      }
    })
  }
  async function latestForSession(sessionId, knownId, fallbackChatId, options = {}) {
    if (!sessionId) return null;
    const owner = await readJson('model-request-sessions/' + encodeURIComponent(sessionId) + '.json');
    const chatId = owner?.chatId || fallbackChatId;
    return chatId ? latest(chatId, knownId, sessionId, options) : null;
  }
  return Object.freeze({ record, complete, evidence, list, detail, latest, recentSeries, latestForSession, prune })
}
