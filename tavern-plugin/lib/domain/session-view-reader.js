import { helperMessagesComplete } from './tavern-helper-context.js'
import { projectSceneImageState, projectChatBackgroundConfig } from './chat-session-state.js'
function identity(chat) {
  const mode = chat.mode || 'story'
  return { revision: Number(chat._storageRevision) || 0, cardPath: String(chat.cardPath ?? ''),
    cardContextRevision: Number(chat.cardContextRevision) || 0, mode, isCard: mode === 'card' }
}
function matches(cached, next) {
  return cached && ['cardPath', 'cardContextRevision', 'mode', 'isCard', 'resourceVersion'].every(key => cached[key] === next[key])
}
function canProjectDirty(previous, chat, indices) {
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
export function createSessionViewReader({ readState, readChat, readChanges, readViewDelta, project, activity,
  trace, foregroundRunning, synchronize, resourceVersion = async () => '' }) {
  const cache = new Map()
  async function changes(chat, revision) {
    const target = Number(chat._storageRevision) || 0
    if (revision === target) return new Set()
    const changed = await readChanges(chat.id, revision)
    return changed?.revision === target ? new Set(changed.indices) : null
  }
  async function load(sessionId, options = {}) {
    const selected = await trace.stage('readChat', async () => {
      const state = await readState(sessionId)
      if (state === undefined) return { chat: undefined }
      const resources = await resourceVersion(state)
      const cached = cache.get(state.id), next = {...identity(state), resourceVersion: resources}
      if (matches(cached, next) && cached.revision === next.revision) return { chat: state, cached, resourceVersion: resources }
      let verifiedDelta
      if (matches(cached, next) && cached.revision < next.revision && readViewDelta) {
        const delta = await trace.stage('readViewDelta', () => readViewDelta(state.id, cached.revision))
        const dirty = delta && new Set(delta.indices)
        if (delta?.baseRevision === cached.revision && delta.chat?.id === state.id
          && delta.revision === next.revision && identity(delta.chat).revision === next.revision
          && matches(cached, {...identity(delta.chat), resourceVersion: resources})) {
          verifiedDelta=delta
          if (canProjectDirty(cached.view, delta.chat, dirty)) return { chat: delta.chat, cached, dirty, layoutChanged:delta.layoutChanged, changedHeaderFields:delta.changedHeaderFields,runtimeInputChanges:delta.runtimeInputChanges, resourceVersion: resources }
        }
      }
      const chat = await trace.stage('readFullChat', () => readChat(sessionId))
      const evidence=chat && verifiedDelta && chat.id===verifiedDelta.chat.id && identity(chat).revision===verifiedDelta.revision
        ? {dirty:new Set(verifiedDelta.indices),layoutChanged:verifiedDelta.layoutChanged,changedHeaderFields:verifiedDelta.changedHeaderFields,runtimeInputChanges:verifiedDelta.runtimeInputChanges} : {}
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
      if (matches(cached, next) && canProjectDirty(cached?.view, chat, dirty)) {
        view = await trace.stage('projectViewDirty', () => project.dirty(chat, cached.view, dirty, currentActivity, {layoutChanged:selected.layoutChanged,changedHeaderFields:selected.changedHeaderFields,runtimeInputChanges:selected.runtimeInputChanges}))
        rebuild = 'dirty'
      } else {
        view = await project.full(chat, {...options,inputChanges:matches(cached,next) && dirty ? {baseRevision:cached.revision,indices:dirty,changedHeaderFields:selected.changedHeaderFields,runtimeInputChanges:selected.runtimeInputChanges} : undefined})
        rebuild = 'full'
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
    const previous = args.viewSync === 1 ? synchronize.peek?.(args.viewCursor) : null
    const result = await load(sessionId, {
      windowHelperMessages: args.viewSync === 1 && (args.viewCursor === undefined || args.viewCursor === null || args.viewCursor === '')
    })
    if (args.viewSync !== 1) return { view: result.view }
    const dirtyMessageIndices = result.chat && previous?.sessionId === String(sessionId)
      && Number.isSafeInteger(previous.revision) ? await changes(result.chat, previous.revision) : null
    return synchronize(String(sessionId), result.view, args.viewCursor, { revision: result.revision, dirtyMessageIndices, receiptSync:args.receiptSync })
  }
  return Object.freeze({ read, response })
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
  async function readSceneImageState(sessionId) {
    const state = await registry.resolveSceneImageState(sessionId)
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
