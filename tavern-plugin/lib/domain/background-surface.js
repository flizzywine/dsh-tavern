import { upgradeReferences, storyEventTurn } from './session-upgrade-references.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { restoredSurfaceSeqs } from './surface-restoration.js'
import { sessionEvents, surfaceReplacementRange, withSurfaceEditTurn } from './session-events.js'
import { randomUUID } from 'node:crypto'

export function rewindBackgroundSurface(session, boundary, agent, formatVersion = 4) {
  if (!Number.isSafeInteger(boundary)) return 0
  const events = sessionEvents(session)
  boundary = upgradeReferences(events).sequence(boundary, formatVersion)
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  const bySeq = new Map(events.map(event => [event.seq, event]))
  // A replaced system message gets a new seq but stays at surface position zero.
  // Fixed seeds are not task history, regardless of their current event number.
  const groups = []
  let group = null
  for (const seq of nodes) {
    const event = bySeq.get(seq)
    const id = event?.data?.message?.id || event?.data?.id || ''
    const fixed = event?.type === 'system/message' || String(id).startsWith('tavern-session-prefix:')
    if (fixed || !Number.isSafeInteger(seq) || seq <= boundary) { group = null; continue }
    if (group === null) { group = []; groups.push(group) }
    group.push(seq)
  }
  if (groups.length === 0) return 0
  let source = null
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = bySeq.get(nodes[index])
    const candidate = event && event.data && event.data.message && event.data.message.source
    if (event && event.type === 'assistant/message' && candidate && candidate.kind === 'model') {
      source = candidate
      break
    }
  }
  if (source === null) {
    // The first model request can fail before any assistant message exists.
    // This empty replacement is a Tavern surface edit, not provider output;
    // use the same owned source as reply projections (including token metering).
    source = { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }
  }
  // A replacement is appended at the tail of an append-only log, so released V4
  // reads it against the turn and step that are open *there*, not against the
  // shadowed range. A rewind that runs after the previous task closed its turn
  // therefore opens one for the edit and closes it again.
  withSurfaceEditTurn(session, agent, (turn, step) => {
    for (const shadowed of groups) replaceSessionSurface(session, 'assistant/message', {
      turn,
      step,
      message: { id: randomUUID(), role: 'assistant', content: [], source }
    }, { start: shadowed[0], end: shadowed[shadowed.length - 1], sourceEventSeqs: shadowed })
  })
  return groups.reduce((count, group) => count + group.length, 0)
}

// Rebuild display suppression from durable empty surface replacements, including
// rollbacks performed before the UI projection existed. Keep raw events intact.
export function backgroundSuppressedTurns(events) {
  const ranges = []
  const restored = restoredSurfaceSeqs(events)
  for (const event of events) {
    if (restored.has(event.seq)) continue
    const op = event.surfaceOp
    if (event.type !== 'assistant/message' || op?.op !== 'replace' || event.data?.message?.content?.length !== 0) continue
    const range = surfaceReplacementRange(op)
    if (Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start <= range.end) ranges.push(range)
  }
  ranges.sort((a,b) => a.start-b.start)
  const merged = []
  for (const range of ranges) {
    const last = merged[merged.length-1]
    if (last && range.start <= last.end) last.end = Math.max(last.end,range.end)
    else merged.push({...range})
  }
  const turns = new Set()
  if (!merged.length) return []
  for (const event of events) {
    const seq = event.seq, turn = storyEventTurn(event)
    if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(turn) || turn <= 0) continue
    // Binary search also supports imported histories whose seqs are not sorted.
    let low=0, high=merged.length-1
    while (low<=high) {
      const mid=(low+high)>>>1, range=merged[mid]
      if (seq<range.start) high=mid-1
      else if (seq>range.end) low=mid+1
      else { turns.add(turn); break }
    }
  }
  return [...turns].sort((a,b)=>a-b)
}

/** Read-only display projection. Never acquires or disposes an Agent. */
export function createBackgroundSuppressionReader(readEvidence, {capacity=64}={}) {
  const cache = new Map()
  return function read(sessionId) {
    if (!String(sessionId).startsWith('background-')) return {turns:[]}
    const evidence = readEvidence(sessionId)
    const previous = cache.get(sessionId)
    if (!evidence.loaded) return {turns:[...(previous?.turns || [])], loaded:false}
    const events = evidence.events
    const last = events[events.length-1]
    // Session events are append-only; a new loaded Session invalidates the entry.
    const stamp = events.length + ':' + String(last?.seq)
    if (previous?.session?.deref() === evidence.session && previous.stamp === stamp) return {turns:[...previous.turns], loaded:true}
    const turns = backgroundSuppressedTurns(events)
    cache.delete(sessionId)
    cache.set(sessionId,{session:evidence.session ? new WeakRef(evidence.session) : undefined,stamp,turns})
    while(cache.size>capacity)cache.delete(cache.keys().next().value)
    return {turns:[...turns], loaded:true}
  }
}
