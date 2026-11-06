import { surfaceReplacementRange } from './session-events.js'

// Ownership is a property of append origins, not the timestamp of a rewrite.
// Keep the graph shallow: each query propagates a few bits once per event,
// rather than copying all ancestors into every replacement (quadratic space).
export const OWNED = 1
const FOREIGN = 2
const UNKNOWN = 4
// The host's surface-eligible types. A developer note the host writes inside a turn
// belongs to that turn; left unclassified it split a regeneration and blanked the round (#304).
const messageTypes = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

export class SurfaceRecoveryError extends Error {
  constructor(message, seq) {
    super(message + (seq === undefined ? '' : ': ' + seq))
    this.name = 'SurfaceRecoveryError'
    this.code = 'UNSAFE_SURFACE_RECOVERY'
    this.seq = seq
  }
}

export function createSurfaceOwnership(events) {
  const ordered = events.filter(event => Number.isSafeInteger(event?.seq))
  const bySeq = new Map(ordered.map(event => [event.seq, event]))
  const parents = new Map()
  for (const event of ordered) {
    if (event.surfaceOp?.op !== 'replace') continue
    const range = surfaceReplacementRange(event.surfaceOp)
    const refs = event.sourceEventSeqs
    // Do not infer an interval from numeric event IDs: replacements keep their
    // surface position. Missing, forward or cyclic references are unprovable.
    const valid = Array.isArray(refs) && refs.length > 0 && refs.includes(range.start) && refs.includes(range.end) &&
      refs.every(seq => Number.isSafeInteger(seq) && seq < event.seq && bySeq.has(seq))
    parents.set(event.seq, { refs: Array.isArray(refs) ? refs : [], valid })
  }
  const firstOrigins = new Map()
  for (const event of ordered) {
    const parent = parents.get(event.seq)
    firstOrigins.set(event.seq, parent
      ? parent.refs.reduce((first, seq) => Math.min(first, firstOrigins.get(seq) ?? Infinity), Infinity)
      : event.seq)
  }
  function classify(selectOrigin) {
    const states = new Map()
    for (const event of ordered) {
      const parent = parents.get(event.seq)
      if (parent) {
        states.set(event.seq, parent.refs.reduce((state, seq) => state | (states.get(seq) ?? UNKNOWN), parent.valid ? 0 : UNKNOWN))
      } else if (messageTypes.has(event.type)) {
        // Legacy projections may omit surfaceOp on original message records.
        states.set(event.seq, selectOrigin(event) ? OWNED : FOREIGN)
      }
    }
    return seq => states.get(Number(seq)) ?? UNKNOWN
  }
  return { eventAt: seq => bySeq.get(Number(seq)), firstOrigin: seq => firstOrigins.get(Number(seq)), classify }
}

/** Select a proven contiguous range on the current surface, before any write. */
export function planSurfaceRecovery({ nodes, ownership, selectOrigin, inScope = selectOrigin, ignore = () => false, message }) {
  const state = ownership.classify(selectOrigin)
  const selected = []
  for (const value of nodes) {
    const seq = Number(value)
    const event = ownership.eventAt(seq)
    if (ignore(event)) continue
    const belongs = state(seq)
    if (belongs === OWNED) selected.push(seq)
    else if ((belongs & OWNED) || ((belongs & UNKNOWN) && event && inScope(event))) {
      throw new SurfaceRecoveryError(message + '（消息归属混合或来源不完整）', seq)
    }
  }
  if (!selected.length) return null
  return planSurfaceRange({ nodes, start: selected[0], end: selected.at(-1),
    accepts: seq => state(seq) === OWNED, message })
}

/** All recovery paths validate surface order through this same boundary. */
export function planSurfaceRange({ nodes, start, end, accepts, message }) {
  const first = nodes.indexOf(start)
  const last = nodes.indexOf(end)
  if (first < 0 || last < first) throw new SurfaceRecoveryError(message)
  const shadowedSeqs = nodes.slice(first, last + 1).map(Number)
  const outside = shadowedSeqs.find(seq => !accepts(seq))
  if (outside !== undefined) throw new SurfaceRecoveryError(message, outside)
  return Object.freeze({ start: shadowedSeqs[0], end: shadowedSeqs.at(-1), shadowedSeqs: Object.freeze(shadowedSeqs) })
}
