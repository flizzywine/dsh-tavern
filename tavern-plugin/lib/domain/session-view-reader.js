import { helperMessagesComplete, completeTavernHelperContext } from './tavern-helper-context.js'
import { projectSceneImageState, projectChatBackgroundConfig } from './chat-session-state.js'
function identity(chat) {
  const mode = chat.mode || 'story'
  return { revision: Number(chat._storageRevision) || 0, cardPath: String(chat.cardPath ?? ''),
    cardContextRevision: Number(chat.cardContextRevision) || 0, mode, isCard: mode === 'card' }
}
function matches(cached, next) {
  return cached && ['cardPath', 'cardContextRevision', 'mode', 'isCard', 'resourceVersion'].every(key => cached[key] === next[key])
}
function canProjectDirty(previous, chat, indices, changedHeaderFields) {
  // A deferred resource must never retain a capability for an outdated snapshot.
  if (previous?.cardResourceAccess && (!Array.isArray(changedHeaderFields)
    || changedHeaderFields.some(key => ['cardDefinitionSnapshot', 'openingWorldbookSnapshot'].includes(key)))) return false
  const before = previous?.tavernHelper?.messages, after = chat.messages
  if (!indices || !Array.isArray(before) || !Array.isArray(after) || before.length > after.length
    || !helperMessagesComplete(before)) return false
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= after.length) return false
    if (index >= before.length) continue
    const role = before[index]?.role, source = after[index]
    const nextRole = source?.role === 'user' ? 'user' : 'assistant'
    if (role && !['assistant', 'user', 'system'].includes(role)) continue
    if (role && source && role !== nextRole && source.role !== 'tavern-helper') return false
  }
  return true
}

/** Own snapshot selection, projection cache and transport revision pairing.
 * Projections consume detached inputs; callers never receive a partial Chat.
 */
export function createSessionViewReader({ readState, readChat, readChanges, readViewDelta, readOpeningWindow, project, activity,
  trace, foregroundRunning, synchronize, resourceVersion = async () => '' }) {
  const cache = new Map()
  const helperWindows = new Map()
  const pending = new Map()
  async function changes(chat, revision) {
    const target = Number(chat._storageRevision) || 0
    if (revision === target) return new Set()
    const changed = await readChanges(chat.id, revision)
    return changed?.revision === target ? new Set(changed.indices) : null
  }
  async function load(sessionId, options = {}) {
    const state=await readState(sessionId)
    const resources=(state ? await resourceVersion(state) : '') + (options.deferResources ? '\ndeferred-resources' : '')
    const key=JSON.stringify([String(sessionId),state?.id,state && identity(state),resources,options])
    if (pending.has(key)) return pending.get(key)
    const work=loadSnapshot(sessionId,options,state,resources)
    pending.set(key,work)
    try { return await work }
    finally { if(pending.get(key)===work)pending.delete(key) }
  }
  async function loadSnapshot(sessionId, options, state, resources) {
    const selected = await trace.stage('readChat', async () => {
      if (state === undefined) return { chat: undefined }
      const next = {...identity(state), resourceVersion: resources}
      const window = options.windowHelperMessages && helperWindows.get(state.id)
      const stored = cache.get(state.id)
      const cached = matches(window,next) && window.revision===next.revision && !(matches(stored,next) && stored.revision===next.revision) ? window : stored
      if (matches(cached, next) && cached.revision === next.revision) return { chat: state, cached, resourceVersion: resources }
      let verifiedDelta
      if (matches(cached, next) && cached.revision < next.revision && readViewDelta) {
        const delta = await trace.stage('readViewDelta', () => readViewDelta(state.id, cached.revision))
        const dirty = delta && new Set(delta.indices)
        if (delta?.baseRevision === cached.revision && delta.chat?.id === state.id
          && delta.revision === next.revision && identity(delta.chat).revision === next.revision
          && matches(cached, {...identity(delta.chat), resourceVersion: resources})) {
          verifiedDelta=delta
          if (canProjectDirty(cached.view, delta.chat, dirty, delta.changedHeaderFields)) return { chat: delta.chat, cached, dirty, layoutChanged:delta.layoutChanged,layoutFrom:delta.layoutFrom, changedHeaderFields:delta.changedHeaderFields,runtimeInputChanges:delta.runtimeInputChanges, resourceVersion: resources }
        }
      }
      const chat = await trace.stage('readFullChat', () => readChat(sessionId))
      const evidence=chat && verifiedDelta && chat.id===verifiedDelta.chat.id && identity(chat).revision===verifiedDelta.revision
        ? {dirty:new Set(verifiedDelta.indices),layoutChanged:verifiedDelta.layoutChanged,layoutFrom:verifiedDelta.layoutFrom,changedHeaderFields:verifiedDelta.changedHeaderFields,runtimeInputChanges:verifiedDelta.runtimeInputChanges} : {}
      return { chat, cached: chat && cache.get(chat.id), resourceVersion: resources, ...evidence }
    })
    const { chat, cached } = selected
    if (chat === undefined) return { view: null, revision: 0, chat: undefined }
    const next = {...identity(chat),resourceVersion:selected.resourceVersion}, currentActivity = activity(chat)
    let view, rebuild
    // The selected cache entry is request-local, even if another read replaces it.
    if (matches(cached, next) && cached.revision === next.revision) {
      view = await trace.stage('projectViewCached', () => project.cached(chat, cached.view, currentActivity))
      rebuild = 'cache'
    } else {
      const dirty = selected.dirty ?? (matches(cached, next) && cached.revision < next.revision ? await changes(chat, cached.revision) : null)
      if (matches(cached, next) && canProjectDirty(cached?.view, chat, dirty, selected.changedHeaderFields)) {
        view = await trace.stage('projectViewDirty', () => project.dirty(chat, cached.view, dirty, currentActivity, {layoutChanged:selected.layoutChanged,layoutFrom:selected.layoutFrom,changedHeaderFields:selected.changedHeaderFields,runtimeInputChanges:selected.runtimeInputChanges}))
        rebuild = 'dirty'
      } else {
        view = await project.full(chat, {...options,inputChanges:matches(cached,next) && dirty ? {baseRevision:cached.revision,indices:dirty,changedHeaderFields:selected.changedHeaderFields,runtimeInputChanges:selected.runtimeInputChanges} : undefined})
        rebuild = 'full'
      }
      if (view?.tavernHelper?.messagesPending && options.windowHelperMessages) {
        const latest = helperWindows.get(chat.id)
        if (!latest || latest.revision <= next.revision) helperWindows.set(chat.id, {...next, sessionId:String(sessionId), view})
        while (helperWindows.size > 8) helperWindows.delete(helperWindows.keys().next().value)
      }
      if (!view?.tavernHelper?.messagesPending) {
        const latest = cache.get(chat.id)
        // A slower old projection cannot evict an already completed newer one.
        if (!latest || latest === cached || latest.revision <= next.revision) cache.set(chat.id, { ...next, view })
        while (cache.size > 8) cache.delete(cache.keys().next().value)
      }
    }
    trace.state({ foregroundRunning: foregroundRunning(sessionId), backgroundBusy: currentActivity.busy,
      backgroundRole: currentActivity.role, viewRebuild: rebuild,
      helperMessageCount: Array.isArray(view?.tavernHelper?.messages) ? view.tavernHelper.messages.length : 0 })
    return { view, revision: next.revision, chat }
  }
  async function read(sessionId, options) { return (await load(sessionId, options)).view }
  async function response(args = {}) {
    const sessionId = args.sessionId
    // New clients read the worldbook from Helper context; old clients keep the alias.
    const transportView = view => {
      if (args.helperWorldbookSync !== 1 || !view?.tavernHelper || !Object.hasOwn(view.tavernHelper, 'worldbook')) return view
      const { tavernHelperWorldbook: _alias, ...result } = view
      return result
    }
    // Bounded views have their own contract and never enter the complete view
    // cache. Explicit full reads retain the existing compatibility path.
    if (args.openingWindow === 1 && args.viewSync === 1 && args.fullView !== true && readOpeningWindow && project.opening) {
      const window = await trace.stage('readOpeningWindow', () => readOpeningWindow(sessionId, args.historyFrom))
      if (window) {
        const view = await trace.stage('projectOpeningWindow', () => project.opening(window, {deferResources:args.resourceSync === 1}))
        trace.state({viewRebuild:'window',helperMessageCount:window.chat.messages.length})
        return synchronize(String(sessionId),transportView(view),args.viewCursor,{revision:window.revision,receiptSync:args.receiptSync})
      }
    }
    const previous = args.viewSync === 1 ? synchronize.peek?.(args.viewCursor) : null
    const result = await load(sessionId, {
      deferResources: args.resourceSync === 1,
      windowHelperMessages: args.fullView !== true && args.viewSync === 1 && (args.viewCursor === undefined || args.viewCursor === null || args.viewCursor === '')
    })
    if (args.viewSync !== 1) return { view: transportView(result.view) }
    const dirtyMessageIndices = result.chat && previous?.sessionId === String(sessionId)
      && Number.isSafeInteger(previous.revision) ? await changes(result.chat, previous.revision) : null
    return synchronize(String(sessionId), transportView(result.view), args.viewCursor, { revision: result.revision, dirtyMessageIndices, receiptSync:args.receiptSync })
  }
  function acceptHelperMessages(sessionId, chatId, revision, payload) {
    const pending = helperWindows.get(chatId)
    if (!pending || pending.sessionId !== String(sessionId) || pending.revision !== revision) return false
    const helper = completeTavernHelperContext(pending.view?.tavernHelper,payload)
    if (!helper) return false
    const current = cache.get(chatId)
    if (current && current.revision >= revision) return false
    cache.set(chatId,{...pending,view:{...pending.view,tavernHelper:helper}})
    helperWindows.delete(chatId)
    while (cache.size > 8) cache.delete(cache.keys().next().value)
    return true
  }
  return Object.freeze({ read, response, acceptHelperMessages })
}

/** Partial state is never handed to a migration that can persist a Chat. */
export function createSessionChatReader({ registry, needsAdoption, adopt }) {
  async function read(sessionId) {
    const chat = await registry.resolve(sessionId)
    return chat && needsAdoption(chat) ? adopt(chat) : chat
  }
  async function readState(sessionId) {
    const state = await registry.resolveState(sessionId)
    return state && needsAdoption(state) ? read(sessionId) : state
  }
  async function readSceneImageState(sessionId, options) {
    const state = await registry.resolveSceneImageState(sessionId, options)
    if (!state || !needsAdoption(state)) return state
    const adopted = await read(sessionId)
    return adopted ? projectSceneImageState(adopted) : undefined
  }
  async function readBackgroundConfig(sessionId) {
    const config = await registry.resolveBackgroundConfig(sessionId)
    if (!config || !needsAdoption(config)) return config
    const adopted = await read(sessionId)
    return adopted ? projectChatBackgroundConfig(adopted) : undefined
  }
  return Object.freeze({ read, readState, readSceneImageState, readBackgroundConfig })
}

// Narrow caller fields still need the identity/adoption fields used by routing.
// An ineligible projection returns undefined so the caller can use the complete
// reader (which owns alias recovery and legacy configuration adoption).
export function createSessionSliceReader({ links, readSlice }) {
  return async function (sessionId, indices, fields) {
    const chatId = (await links())[sessionId]
    if (!chatId) return undefined
    const selectedFields = Array.isArray(fields)
      ? [...new Set([...fields, 'id', 'sessionId', 'backgroundConfigVersion', 'conversationFeaturesVersion'])] : fields
    const selected = await readSlice(chatId, indices, selectedFields)
    const chat = selected?.chat
    if (!chat || chat.sessionId !== sessionId || chat.backgroundConfigVersion !== 1 || chat.conversationFeaturesVersion !== 1) return undefined
    return selected
  }
}
