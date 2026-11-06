import { sessionEvents } from './session-events.js'
import { isPluginSource, sourceProducerName } from './message-source.js'

// The one place that decides which message is a turn's input. Readers that
// guessed this separately drifted apart, and one of them took a template edit
// of an earlier input for a new turn's input (#196).

function str(value) { return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value)) }

/** A turn that ended without a committed reply: an error, a stop, or a crash the
 * host closed on recovery ('interrupted'). Its input and partial reply are residue. */
export function isFailedTurnEnd(kind) { return kind === 'error' || kind === 'aborted' || kind === 'interrupted' }

/** Who sent an input: the player, a regenerate attempt, a legacy failed-turn replay, or nobody. */
export function inputKind(message) {
  const source = message && message.source
  if (!source) return null
  if (source.kind === 'user') return 'player'
  if (!isPluginSource(source)) return null
  const producer = sourceProducerName(source)
  return producer === 'dsh-tavern-regen' ? 'regenerate' : producer === 'dsh-tavern-replay' ? 'replay' : null
}

export function isTurnInput(message) { return inputKind(message) !== null }

/** A message the player (or a regenerate/replay) sent. Replacements rewrite an
 * earlier message in place — a template edit keeps the original source and
 * request id — and are never the input of the turn they happen to land in. */
export function isNewTurnInput(event) {
  return Boolean(event && event.type === 'user/message' && isTurnInput(event.data) && !(event.surfaceOp && typeof event.surfaceOp === 'object'))
}

/** A new message typed by the player, which ends any earlier regenerate attempt. */
export function isNewPlayerInput(event) {
  return isNewTurnInput(event) && inputKind(event.data) === 'player'
}

/** The DSH request id of a player's message; synthetic inputs have none. */
export function requestIdOf(message) {
  return inputKind(message) === 'player' ? str(message.source.rpcId).trim() : ''
}

/** Provider request messages are already in surface order: the input is the last one. */
export function requestIdForMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index--) {
    if (isTurnInput(list[index])) return requestIdOf(list[index])
  }
  return ''
}

/** Index of the latest turn/start event of this turn, or -1. */
export function turnStartIndex(events, turn) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event && event.type === 'turn/start' && Number(event.data && event.data.turn) === Number(turn)) return index
  }
  return -1
}

/** The input event that started this turn, from the session log in event order. */
export function inputEventForTurn(session, turn) {
  const events = sessionEvents(session)
  const start = turnStartIndex(events, turn)
  if (start < 0) return null
  for (let index = start + 1; index < events.length; index++) {
    const event = events[index]
    if (isNewTurnInput(event)) return event
  }
  return null
}

export function userMessageForTurn(session, turn) {
  return inputEventForTurn(session, turn)?.data || ''
}

export function requestIdForTurn(session, turn) {
  return requestIdOf(userMessageForTurn(session, turn))
}

/** Player inputs that are still story: those of a failed or rejected turn are
 * residue the failed-turn cleanup removes, and never block recovery. */
export function storyPlayerInputs(events, from = 0) {
  const failed = new Set(events.filter(event => event?.type === 'turn/end' && isFailedTurnEnd(event.data?.reason?.kind)).map(event => Number(event.data.turn)))
  const found = []
  let turn = 0
  for (const event of events) {
    if (event?.type === 'turn/start') turn = Number(event.data?.turn) || 0
    // An input after a turn ended belongs to the next turn, not the failed one.
    else if (event?.type === 'turn/end') turn = 0
    else if (event && event.seq >= from && isNewPlayerInput(event) && !failed.has(turn)) found.push(event)
  }
  return found
}
