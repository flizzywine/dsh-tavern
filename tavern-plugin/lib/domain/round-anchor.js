import { upgradeReferences, upgradedAnchor } from './session-upgrade-references.js'
import { sessionEvents } from './session-events.js'

// A story round records where it first entered the native session: the seq of
// the player's input and of the reply, as appended. Those events never change;
// every later rewrite (regenerate, body edit, template edit, rollback, undo) is
// a replacement that cites what it replaces. So the round's current place is
// whichever surface node descends from its anchors — no anchor ever needs
// updating, and nothing has to be guessed from text or event order.

export function roundAnchor(turn, inputEvent, replyEvent) {
  const anchor = { formatVersion: 4, turn: Number(turn), input: Number(inputEvent?.seq), reply: Number(replyEvent?.seq) }
  return Number.isSafeInteger(anchor.turn) && Number.isSafeInteger(anchor.input) && Number.isSafeInteger(anchor.reply) ? anchor : null
}

export function validAnchor(anchor) {
  return Boolean(anchor && ['turn', 'input', 'reply'].every(key => Number.isSafeInteger(anchor[key])))
}

/** The original appended events each event's content descends from. */
function lineage(events) {
  const bySeq = new Map(events.filter(event => Number.isSafeInteger(event?.seq)).map(event => [event.seq, event]))
  const roots = new Map()
  function of(seq) {
    if (roots.has(seq)) return roots.get(seq)
    const event = bySeq.get(seq)
    const sources = event?.surfaceOp && typeof event.surfaceOp === 'object' && Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs : null
    // Guard cycles from damaged logs: a seq is its own root while being resolved.
    roots.set(seq, new Set([seq]))
    // A replacement descends from what it cites and is its own root too, so an
    // anchor written onto a replacement (native surface repair) resolves as well.
    const result = sources ? new Set([seq, ...sources.flatMap(source => [...of(source)])]) : new Set([seq])
    roots.set(seq, result)
    return result
  }
  return of
}

/** Resolve many anchors against one surface; the lineage is computed once. */
export function createRoundAnchorResolver({ events, nodes }) {
  const of = lineage(events)
  const references = upgradeReferences(events)
  const surface = nodes.map(Number)
  return function resolve(anchor) {
    if (!validAnchor(anchor)) return null
    anchor = upgradedAnchor(anchor, references)
    let input = null, reply = null
    for (const seq of surface) {
      const roots = of(seq)
      if (input === null && roots.has(anchor.input)) input = seq
      if (roots.has(anchor.reply)) reply = seq
    }
    return { input, reply }
  }
}

/** Current surface nodes of an anchored round: where its input and its reply are now. */
export function resolveRoundAnchor(evidence, anchor) {
  return validAnchor(anchor) ? createRoundAnchorResolver(evidence)(anchor) : null
}

export function resolveSessionRoundAnchor(session, anchor) {
  return resolveRoundAnchor({ events: sessionEvents(session), nodes: session.surface?.nodes || [] }, anchor)
}
