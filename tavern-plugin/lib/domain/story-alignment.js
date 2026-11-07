import { storyEventTurn } from './session-upgrade-references.js'
import { sessionEvents } from './session-events.js'
import { uncommittedRounds } from './uncommitted-rounds.js'
import { createRoundAnchorResolver, validAnchor } from './round-anchor.js'
import { isFailedTurnEnd } from './session-turn-input.js'

// The story save and the native session are two records of one game. Every
// regenerate, rollback and edit writes both; an interruption between the two
// writes, or a bug in either, leaves them disagreeing, and every later
// operation then acts on the wrong round (#196). This module compares them and
// says what is wrong and what can be repaired; it never writes.

function text(message) {
  return (Array.isArray(message?.content) ? message.content : []).filter(block => block?.type === 'text').map(block => String(block.text ?? '')).join('').trim()
}

/** Story rounds the model sees, in surface order: one entry per native turn that shows a reply. */
export function nativeStoryTurns(session) {
  const events = sessionEvents(session)
  const bySeq = new Map(events.filter(event => Number.isSafeInteger(event?.seq)).map(event => [event.seq, event]))
  const ended = new Map()
  for (const event of events) if (event?.type === 'turn/end') ended.set(storyEventTurn(event), event.data?.reason?.kind || '')
  const turns = []
  for (const seq of session.surface?.nodes || []) {
    const event = bySeq.get(Number(seq))
    const message = event?.type === 'assistant/message' ? event.data?.message : null
    if (message?.source?.kind !== 'model' || !text(message) || String(message.id || '').startsWith('tavern-game-mode:')) continue
    const turn = storyEventTurn(event)
    // The seed exchange and the opening are not player rounds.
    if (!(turn > 1) || String(message.id || '').startsWith('tavern-seed-trajectory:') || String(message.id || '').startsWith('tavern-opening:')) continue
    // A failed or still running turn is not story yet; its cleanup is separate.
    if (!ended.has(turn) || isFailedTurnEnd(ended.get(turn))) continue
    if (turns.at(-1) !== turn && !turns.includes(turn)) turns.push(turn)
  }
  return turns
}

/**
 * Whether the native turn that just ended carries a model's reply: what a missed record
 * (#196) would be. Tavern's own turns — a rollback, its undo, a body edit, a repair —
 * only replace the surface or append copies naming their round; they write the save
 * around them and are compared once both writes have landed. Reads that turn only.
 */
export function turnRepliedByModel(events, turn) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/start' && Number(event.data?.turn) === Number(turn)) return false
    if (event?.type !== 'assistant/message' || event.surfaceOp !== 'append' || Number(event.data?.turn) !== Number(turn)) continue
    const source = event.data?.message?.source
    if (source?.kind === 'model' && source.provider !== 'dsh-tavern' && !Number.isSafeInteger(source.tavernStoryTurn) && text(event.data.message)) return true
  }
  return false
}

/**
 * Compare the latest story rounds of the save with the native surface.
 * `storyTurns` are the save's player rounds (non-greeting replies) in order;
 * it may be only the latest part of a long save. The native side may be
 * shorter than the save after compaction, so only its window is compared.
 */
export function inspectStoryAlignment({ session, header = {}, storyTurns = [], storyAnchors = [] }) {
  if (header.regenInProgress) return { aligned: false, state: 'regenerating', adopt: [], rolledBackVisible: [], mismatch: null, anchors: { checked: 0, lost: [] } }
  const native = nativeStoryTurns(session)
  const suppressed = new Set((Array.isArray(header.suppressedDshTurns) ? header.suppressedDshTurns : []).map(Number))
  const adopt = uncommittedRounds(session, header)
  const adoptTurns = new Set(adopt.map(round => round.turn))
  // A rolled-back round whose shadow never reached the native session.
  const rolledBackVisible = native.filter(turn => suppressed.has(turn) && !storyTurns.includes(turn))
  const expected = native.filter(turn => !adoptTurns.has(turn) && !rolledBackVisible.includes(turn))
  const tail = storyTurns.slice(Math.max(0, storyTurns.length - expected.length))
  const matches = expected.length === tail.length && expected.every((turn, index) => turn === tail[index])
  const mismatch = matches ? null : { native: expected.slice(-12), story: storyTurns.slice(-12) }
  // Anchored rounds must still be somewhere on the surface (shadowed or compacted is fine).
  const resolve = createRoundAnchorResolver({ events: sessionEvents(session), nodes: session.surface?.nodes || [] })
  const anchored = storyAnchors.filter(validAnchor)
  const lostAnchors = anchored.filter(anchor => resolve(anchor)?.reply === null).map(anchor => anchor.turn)
  return { aligned: matches && !adopt.length && !rolledBackVisible.length && !lostAnchors.length, state: matches ? 'ok' : 'mismatch', adopt, rolledBackVisible, mismatch,
    anchors: { checked: anchored.length, lost: lostAnchors } }
}
