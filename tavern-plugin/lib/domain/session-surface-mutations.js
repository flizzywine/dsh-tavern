import { isDeepStrictEqual } from 'node:util'
import { appendSessionEvent, openTurnStep, sessionEvents, sessionEventData, surfaceReplacementRange, withSurfaceEditStep } from './session-events.js'
import { agentForSession } from './agent-lookup.js'

/** Commit a replacement against the current surface, never the raw history.
 * Existing callers retain their transaction/flush ownership. Message IDs are
 * retry identities together with source references: the same write is reused,
 * conflicting content for that identity is rejected before touching the surface.
 * Restoring an archived message may legitimately reuse its message ID against
 * a different set of displaced nodes; it is not the same mutation.
 */
export function replaceSessionSurface(session, type, data, { start, end, sourceEventSeqs }) {
  return createSessionSurfaceMutator(session).replace(type, data, { start, end, sourceEventSeqs })
}

/** A synchronous batch owns all its appends. Never retain this index across
 * awaits or external session mutations; each new batch takes a fresh snapshot.
 */
export function createSessionSurfaceMutator(session, events = sessionEvents(session)) {
  const bySeq = new Map()
  const replacements = new Map()
  function remember(event) {
    if (!event) return
    bySeq.set(event.seq, event)
    if (event.surfaceOp?.op !== 'replace') return
    const id = event.data?.message?.id || event.data?.id
    if (!replacements.has(event.type)) replacements.set(event.type, new Map())
    const ids = replacements.get(event.type)
    if (!ids.has(id)) ids.set(id, [])
    ids.get(id).push(event)
  }
  events.forEach(remember)
  function append(type, data, intent) {
    const event = appendSessionEvent(session, type, data, intent)
    remember(typeof event === 'number' ? (session.eventAt?.(event) ?? session.events?.[event]) : event)
    return event
  }
  // Released V4 requires assistant/tool surface events to sit inside the open
  // turn and step and carry that step's numbers; a rewrite of an older round
  // otherwise stops the whole archive from loading ("does not match an open
  // turn and step"). Such a write gets a step of its own, and its retry must
  // still match although the step number may differ between attempts.
  const sameWithoutPlacement = (left, right) => isDeepStrictEqual(
    { ...left, turn: null, step: null }, { ...right, turn: null, step: null })
  function replace(type, data, { start, end, sourceEventSeqs }) {
    const id = type === 'assistant/message' || type === 'tool/result' ? data.message?.id : data.id
    const normalized = sessionEventData(session, type, data)
    const events = sessionEvents(session)
    const open = openTurnStep(events)
    const adoptsStep = (type === 'assistant/message' || type === 'tool/result')
      && events.some(event => event.type === 'turn/start')
      && (open.turn === null || open.step === null)
    if (id) {
      const prior = (replacements.get(type)?.get(id) || []).find(event => isDeepStrictEqual(event.sourceEventSeqs, sourceEventSeqs))
      if (prior) {
        const range = surfaceReplacementRange(prior.surfaceOp)
        const same = adoptsStep ? sameWithoutPlacement(prior.data, normalized) : isDeepStrictEqual(prior.data, normalized)
        if (range.start === start && range.end === end && same) return prior
        throw new Error('消息修改标识已用于不同内容，请重新读取上下文')
      }
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < 0) throw new Error('消息替换范围无效')
    const nodes = session.surface?.nodes
    const startIndex = Array.isArray(nodes) ? (nodes.at(-1) === start ? nodes.length - 1 : nodes.indexOf(start)) : -1
    const endIndex = start === end ? startIndex : Array.isArray(nodes) ? nodes.indexOf(end) : -1
    if (startIndex < 0 || endIndex < startIndex) throw new Error('消息替换目标已变化，请重新读取上下文')
    // Replacements keep their original position but receive new event IDs.
    // Surface order is therefore not numeric event order.
    const targets = nodes.slice(startIndex, endIndex + 1)
    const referenced = new Set(Array.isArray(sourceEventSeqs) ? sourceEventSeqs : [])
    if (!Array.isArray(sourceEventSeqs) || targets.some(seq => !referenced.has(seq)) ||
        sourceEventSeqs.some(seq => !Number.isSafeInteger(seq) || !bySeq.has(seq))) throw new Error('消息替换缺少有效的来源引用')
    // An open step already accepts the caller's placement. Between rounds there is
    // none: released V4 then refuses the event and the whole archive stops
    // loading, so give the write a step of its own.
    if (!adoptsStep) return append(type, data, {
      surfaceOp: { op: 'replace', start, end }, sourceEventSeqs
    })
    return withSurfaceEditStep(session, agentForSession(session), (turn, step) => append(type, { ...data, turn, step }, {
      surfaceOp: { op: 'replace', start, end }, sourceEventSeqs
    }))
  }
  return { append, replace }
}

// Accounting and mutation validation live together; the meter only adapts transport.
export function isTavernSurfaceEdit(session, event, priorNodes, resolvePreset) {
  if (event?.type !== 'assistant/message') return false
  const message = event.data?.message
  const source = message?.source
  if (source?.kind !== 'model') return false
  if (source.provider === 'dsh-tavern' && source.model === 'synthetic-trajectory' &&
      message.id?.startsWith('tavern-seed-trajectory:')) return true
  const owned = source.provider === 'dsh-tavern' && source.model === 'reply-projection'
  const replacement = event.surfaceOp
  const refs = event.sourceEventSeqs
  if (replacement?.op !== 'replace' || !Array.isArray(refs) || refs.length === 0) return false
  if (!owned) {
    // Ordinary model replies never need a history lookup. The meter supplies a
    // replay-local cursor; standalone validation retains the historical fallback.
    const preset = resolvePreset ? resolvePreset() :
      sessionEvents(session).findLast(item => item.type === 'agent-preset/selected' && item.seq < event.seq)?.data?.agentPreset ?? session.header?.agentPreset
    if (!['tavern', 'tavern-background'].includes(preset)) return false
  }
  // Tavern cites replaced surface messages, not provider streaming chunks.
  // Keep genuine malformed provider replies subject to the native validation.
  const range = surfaceReplacementRange(replacement)
  // Use the meter's surface immediately before this event, not today's final
  // surface or numeric seq intervals: edits keep their position with newer seqs.
  if (!Array.isArray(priorNodes)) return false
  const seqOf = node => typeof node === 'number' ? node : node.seq
  const startIndex = priorNodes.findIndex(node => seqOf(node) === range.start)
  const endIndex = priorNodes.findIndex(node => seqOf(node) === range.end)
  if (startIndex < 0 || endIndex < startIndex) return false
  const targets = new Set(priorNodes.slice(startIndex, endIndex + 1).map(seqOf))
  const referenced = new Set(refs)
  if (![...targets].every(seq => referenced.has(seq))) return false
  // Undo restores exact old event data, including provider usage, while citing
  // both the displaced node and the archived original outside that range.
  // Treat only a verified copy as restoration, never arbitrary provider output.
  const {tavernRestoredSurfaceSeqs: _marker, ...restoredData} = event.data
  const restored = refs.some(seq => {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq >= event.seq || targets.has(seq)) return false
    const original = session.eventAt(seq)
    if (original?.type !== 'assistant/message') return false
    const {tavernRestoredSurfaceSeqs: _oldMarker, ...originalData} = original.data
    return isDeepStrictEqual(restoredData, originalData)
  })
  if (restored && refs.every(seq =>
    Number.isSafeInteger(seq) && seq >= 0 && seq < event.seq &&
    ['user/message', 'assistant/message', 'tool/result', 'system/message'].includes(session.eventAt(seq)?.type))) return true
  if (event.data.usage !== undefined) return false
  return refs.every(seq => Number.isSafeInteger(seq) && targets.has(seq) && seq < event.seq &&
    ['user/message', 'assistant/message', 'tool/result'].includes(session.eventAt(seq)?.type))
}
