import { upgradeReferences, SESSION_UPGRADE_EVENT } from './session-upgrade-references.js'
import { createSessionSurfaceMutator } from './session-surface-mutations.js'
import { randomUUID } from 'node:crypto'
import { sessionEvents } from './session-events.js'

export function restoredSurfaceSeqs(events) {
  return new Set(events.flatMap(event => Array.isArray(event.data?.tavernRestoredSurfaceSeqs) ? event.data.tavernRestoredSurfaceSeqs : []))
}

/** Restore a saved surface through new events; never mutate the append-only log. */
export function restoreSurface(session, targetNodes, formatVersion = 4) {
  const events = sessionEvents(session)
  const references = upgradeReferences(events)
  targetNodes = targetNodes.map(seq => references.sequence(seq, formatVersion))
  const nodes = [...session.surface.nodes]
  let prefix = 0
  while (prefix < nodes.length && prefix < targetNodes.length && nodes[prefix] === targetNodes[prefix]) prefix++
  // Tool-result replacements must target a tool result. Start at an earlier
  // user/assistant node when a checkpoint splits a tool interaction.
  while (prefix > 0 && events[targetNodes[prefix]]?.type === 'tool/result') prefix--
  const sources = targetNodes.slice(prefix).map(seq => events[seq])
  if (!sources.length) {
    if (prefix === nodes.length) return
    throw new Error('保存的上下文为空，无法撤销回退')
  }
  if (sources.some(event => !event || !['user/message', 'assistant/message', 'system/message', 'tool/result'].includes(event.type))) throw new Error('保存的原生上下文已不可用')
  const markerIndex = sources.findLastIndex(event => event.type !== 'tool/result')
  const shadowed = nodes.slice(prefix)
  const mutations = createSessionSurfaceMutator(session, events)
  // One edit step for the whole restore: a tool-result placeholder and its
  // replacement must land in the same turn/step, or the host rejects the
  // replacement ("tool/result surface replacement may change only content").
  mutations.editStep(() => {
  for (let i = 0; i < sources.length; i++) {
    const original = sources[i]
    const data = structuredClone(original.data)
    let replaced = i === 0 ? shadowed : []
    if (!replaced.length) {
      // Empty append-origin placeholders keep restored copies out of the human
      // transcript; replacements restore the exact model-visible messages.
      const placeholder = original.type === 'tool/result' ? structuredClone(original.data) : {
        turn: Number(original.data.turn) || 0, step: Number(original.data.step) || 1,
        id: randomUUID(), role: 'user', content: [], source: { kind: 'plugin:dsh-tavern-surface-restore' }
      }
      if (original.type === 'tool/result') placeholder.message.content[0].content = []
      const placeholderEvent = mutations.append(original.type === 'tool/result' ? original.type : 'user/message', placeholder, { surfaceOp: 'append' })
      replaced = [typeof placeholderEvent === 'number' ? placeholderEvent : placeholderEvent.seq]
    }
    if (i === markerIndex) data.tavernRestoredSurfaceSeqs = shadowed
    mutations.replace(original.type, data, { start: replaced[0], end: replaced.at(-1), sourceEventSeqs: [...new Set([...replaced, original.seq])] })
  }
  })
}

export function preflightSurfaceRestore(session, nodes, formatVersion = 4) {
  if (typeof session.constructor?.fromRestore !== 'function') return
  const preview = session.constructor.fromRestore(session.id, structuredClone(sessionEvents(session)), structuredClone(session.header), session.inheritedEventCount, 'detached')
  restoreSurface(preview, nodes, formatVersion)
}

/** Resuming a persisted session appends a seed marker, not a context edit. */
export function unchangedSinceRollback(session, afterCount, formatVersion = 4) {
  const events = sessionEvents(session)
  afterCount = upgradeReferences(events).count(afterCount, formatVersion)
  return Number.isSafeInteger(afterCount) && afterCount >= 0 && afterCount <= events.length
    && events.slice(afterCount).every(event => (event.type === 'session/end-seed' || event.type === SESSION_UPGRADE_EVENT) && event.surfaceOp === undefined)
}

export function canUndoRollback(chat, session) {
  const saved = chat?.rollbackUndo
  return Boolean(saved?.version === 1 && saved.ready === true && session
    && saved.branchId === chat.timeline?.branchId && saved.revision === chat.timeline?.revision
    && saved.lifecycleRevision === Number(chat.tavernHelperLifecycleRevision || 0)
    && saved.storageRevision === Number(chat._storageRevision ?? chat.windowRevision ?? 0)
    && unchangedSinceRollback(session, saved.foreground.afterCount, saved.foreground.formatVersion || 3))
}
