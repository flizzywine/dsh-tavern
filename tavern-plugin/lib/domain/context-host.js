import { HISTORY_RECALL_TOOL, renderHistoryRecall } from './history-recall.js'

// Keep the existing recall algorithm; only its visible input is projected.
export function projectContextHistory(chat, { anchor, scope }, display) {
  if (chat.id !== scope.chatId || chat.timeline?.branchId !== anchor.branchId || String(chat.timeline?.revision) !== anchor.textVersion) {
    throw Object.assign(new Error('History anchor is stale'), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
  }
  const end = chat.messages.findLastIndex(row => row.role === 'assistant' && Number(row.turn) === anchor.turn)
  if (end < 0) throw new Error('History anchor has no committed round')
  const messages = chat.messages.slice(0, end + 1).map(row => ({ ...row }))
  if (anchor.para !== undefined) {
    const body = display?.projections.find(row => row.turn === anchor.turn)?.body
    if (!body?.displayUnits) throw new Error('Bound paragraph projection is unavailable')
    messages[end].text = body.displayUnits.slice(0, anchor.para).map(unit => unit.text).join('\n\n')
  }
  return { ...chat, messages }
}
// Fork-only host binding. Declaration ownership remains in plugin-api; these are
// ephemeral consumer handles, not another source registry.
export function createContextHost({ pluginApi, chatForSession, recallHistoryForSession, callModel, runner }) {
  const bindings = new Map(), shared = new Map()
  let serial = 0, provider = null
  const prepared = new Map()
  function releasePrepared(sessionId) {
    prepared.get(sessionId)?.release()
    prepared.delete(sessionId)
  }
  function registerSharedProvider({ prepare }) {
    if (typeof prepare !== 'function') throw new TypeError('Shared provider requires prepare')
    if (provider) throw new Error('A shared provider is already registered')
    const entry = { prepare, controller: new AbortController() }
    provider = entry
    return () => {
      if (provider !== entry) return
      provider = null
      entry.controller.abort()
      for (const sessionId of prepared.keys()) releasePrepared(sessionId)
    }
  }
  async function prepareSharedContext(input) {
    if (input.persistent !== true || input.member || input.ownPrefix === true) return
    releasePrepared(input.sessionId)
    const entry = provider
    if (!entry || !input.requestAnchor) return
    const signal = input.signal ? AbortSignal.any([input.signal, entry.controller.signal]) : entry.controller.signal
    let removeAbort, bound
    try {
      signal.throwIfAborted()
      const requestAnchor = structuredClone(input.requestAnchor)
      const aborted = new Promise((_, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        removeAbort = () => signal.removeEventListener('abort', abort)
      })
      const spec = await Promise.race([Promise.resolve().then(() => entry.prepare({ sessionId: input.sessionId, requestAnchor: structuredClone(requestAnchor), signal })), aborted])
      signal.throwIfAborted()
      if (spec == null) return
      // Creation authority is fixed by the producer, never by the provider or current chat.
      const installing = bind({ owner: spec.owner, name: spec.name, consumer: spec.consumer,
        scope: { ...spec.scope, chatId: requestAnchor.chatId }, sessionId: input.sessionId, shared: true, signal,
        anchor: { branchId: requestAnchor.branchId, turn: requestAnchor.turn, textVersion: String(requestAnchor.revision) } }).then(value => {
        if (signal.aborted) { value.release(); signal.throwIfAborted() }
        return value
      })
      bound = await Promise.race([installing, aborted])
      signal.throwIfAborted()
      prepared.set(input.sessionId, bound)
    } catch (error) {
      bound?.release()
      if (!signal.aborted) console.warn('dsh-tavern: 共享后台准备失败', String(error?.message || error))
      input.signal?.throwIfAborted()
    } finally { removeAbort?.() }
  }
  const unavailable = () => Object.assign(new Error('Context binding is unavailable or stale'), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
  async function current(binding) {
    if (!bindings.has(binding.token)) throw unavailable()
    const chat = await chatForSession(binding.sessionId)
    if (!chat || chat.id !== binding.scope.chatId || chat.timeline?.branchId !== binding.anchor.branchId ||
      String(chat.timeline?.revision) !== binding.anchor.textVersion) throw unavailable()
    return chat
  }
  async function view(binding) {
    await current(binding)
    const result = await pluginApi.resolveReadCapability({ ...binding, readHistory: async ({ args, signal }) => {
      if (!args || Object.keys(args).some(key => !Object.hasOwn(HISTORY_RECALL_TOOL.parameters.properties, key)) ||
        (args.turn !== undefined && (!Number.isSafeInteger(args.turn) || args.turn < 1 || args.turn > binding.anchor.turn))) {
        throw new Error('Query exceeds the bound history scope')
      }
      signal?.throwIfAborted()
      const value = await recallHistoryForSession(binding.sessionId, args, binding.scope, 'background', binding)
      signal?.throwIfAborted()
      return renderHistoryRecall(value)
    } })
    await current(binding)
    if (!result || (binding.generation !== undefined && binding.generation !== result.generation)) throw unavailable()
    binding.generation = result.generation
    const guard = reader => async context => {
      await view(binding)
      const result = await reader(context)
      await view(binding)
      return result
    }
    return { ...result, generation: binding.serial + ':' + result.generation,
      readHistory: guard(result.readHistory), readSource: guard(result.readSource) }
  }
  const get = token => { const binding = bindings.get(token); if (!binding) throw unavailable(); return binding }
  async function runSharedTask({ binding: token, instruction, signal }) {
    const binding = get(token)
    if (shared.get(binding.sessionId) !== binding) throw unavailable()
    await view(binding)
    const result = await runner().runSharedTask({ sessionId: binding.sessionId, anchor: binding.anchor, instruction, signal })
    await view(binding)
    return result
  }
  async function readHistory({ binding: token, args, signal }) {
    return (await view(get(token))).readHistory({ args, signal })
  }
  async function callWithTools({ binding: token, ...options }) {
    const binding = get(token), capability = await view(binding)
    const sourceTool = { name: 'tavern_read_source', description: 'Read an authorized source at or before the bound anchor.',
      parameters: { type: 'object', additionalProperties: false, required: ['sourceId', 'turn'], properties: {
        sourceId: { type: 'string', enum: capability.sources }, turn: { type: 'integer', minimum: 1 }, para: { type: 'integer', minimum: 0 }
      } } }
    const result = await callModel({ ...options, sessionId: binding.sessionId,
      tools: [HISTORY_RECALL_TOOL, ...(capability.sources.length ? [sourceTool] : [])],
      async onToolCall(call, { signal }) {
        const args = JSON.parse(call.arguments)
        const reader = call.name === HISTORY_RECALL_TOOL.name ? capability.readHistory
          : call.name === sourceTool.name ? capability.readSource : null
        if (!reader) throw new Error('Undeclared read tool')
        const value = await reader({ args, signal })
        return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }
      } })
    await view(binding)
    return result
  }
  async function bind({ owner, name, sessionId, consumer, anchor, scope = {}, shared: useShared = false, signal }) {
    signal?.throwIfAborted()
    if (!owner || !name || !sessionId || !consumer || !anchor?.branchId || typeof anchor.textVersion !== 'string' ||
      !Number.isSafeInteger(anchor.turn) || anchor.turn < 1 ||
      (anchor.para !== undefined && (!Number.isSafeInteger(anchor.para) || anchor.para < 0))) throw new TypeError('Explicit consumer and anchor required')
    if (useShared && (shared.has(sessionId) || anchor.para !== undefined)) throw new Error('A shared binding must be unique and cover a full round')
    const chat = await chatForSession(sessionId)
    if (!chat || (scope.chatId !== undefined && scope.chatId !== chat.id) ||
      (scope.branchId !== undefined && scope.branchId !== anchor.branchId) ||
      anchor.turn > Number(chat.messages?.findLast(row => row.role === 'assistant')?.turn || 0)) throw unavailable()
    signal?.throwIfAborted()
    const token = Object.freeze({})
    const binding = { token, serial: ++serial, owner, name, sessionId, consumer: structuredClone(consumer), anchor: structuredClone(anchor),
      scope: { ...structuredClone(scope), chatId: chat.id, branchId: anchor.branchId, turn: anchor.turn, ...(anchor.para === undefined ? {} : { para: anchor.para }) } }
    bindings.set(token, binding)
    const release = () => { bindings.delete(token); if (shared.get(sessionId) === binding) shared.delete(sessionId) }
    signal?.addEventListener('abort', release, { once: true })
    try { await view(binding); signal?.throwIfAborted() } catch (error) { release(); throw error }
    finally { signal?.removeEventListener('abort', release) }
    if (useShared) shared.set(sessionId, binding)
    return Object.freeze({ release,
      runSharedTask: input => runSharedTask({ ...input, binding: token }),
      readHistory: input => readHistory({ ...input, binding: token }),
      callWithTools: input => callWithTools({ ...input, binding: token }) })
  }
  return Object.freeze({ bind, runSharedTask, readHistory, callWithTools, registerSharedProvider, prepareSharedContext,
    requestAnchor(snapshot, taskRun) {
      if (!provider && !shared.has(snapshot.sessionId)) return {}
      return { requestAnchor: { chatId: snapshot.id, branchId: taskRun.basedOn.branchId, revision: taskRun.basedOn.revision,
        turn: Number(snapshot.messages?.findLast(row => row.role === 'assistant')?.turn) || 0 } }
    },
    async resolveSharedTaskAnchor(input) {
      const binding = shared.get(input.sessionId)
      if (!binding) {
        await input.onSharedContextUnavailable?.()
        return null
      }
      const automatic = prepared.has(input.sessionId)
      try {
        await view(binding)
        const anchor = input.requestAnchor
        if (!anchor || anchor.chatId !== binding.scope.chatId || anchor.branchId !== binding.anchor.branchId ||
          String(anchor.revision) !== binding.anchor.textVersion || anchor.turn !== binding.anchor.turn) throw unavailable()
        return structuredClone(binding.anchor)
      } catch (error) {
        if (!automatic) throw error
        releasePrepared(input.sessionId)
        await input.onSharedContextUnavailable?.()
        console.warn('dsh-tavern: 共享后台绑定失效', String(error?.message || error))
        return null
      }
    },
    async resolveSharedReadTools({ sessionId }) {
      const binding = shared.get(sessionId)
      if (!binding) return null
      try { return await view(binding) } catch (error) {
        if (prepared.has(sessionId)) {
          releasePrepared(sessionId)
          console.warn('dsh-tavern: 共享后台绑定失效', String(error?.message || error))
          return null
        }
        if (error.code === 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE') return null
        throw error
      }
    },
    dispose() { provider?.controller.abort(); provider = null; prepared.clear(); bindings.clear(); shared.clear() }
  })
}
