import { sessionEvents, surfaceReplacementRange } from './session-events.js'
import { inputKind, turnStartIndex } from './session-turn-input.js'

// Where one player input lives in the current model context. The host stores
// user/message events with turn: null (the turn is the surrounding turn/start),
// and an edit writes a replacement event instead of the original. Walk the
// turn's events and take the last input that is still on the surface.
export function locateUserInputFloor(session, turn) {
  const expected = Number(turn)
  if (!Number.isSafeInteger(expected) || expected < 1) return null
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : null
  if (nodes === null) return null
  const events = sessionEvents(session)
  const start = turnStartIndex(events, expected)
  if (start < 0) return null
  const onSurface = new Set(nodes.map(Number))
  let located = null
  for (let index = start + 1; index < events.length; index += 1) {
    const event = events[index]
    if (!event || event.type === 'turn/start') break
    if (event.type === 'user/message' && inputKind(event.data) === 'player' && onSurface.has(Number(event.seq))) located = event
  }
  return located === null ? null : { seq: Number(located.seq), event: located, turn: expected }
}

// Follow an edit chain from a Chat marker's target seq to the node that is on
// the surface now. Each edit replaces the previous copy, so the marker never
// needs to be rewritten after a second edit.
export function locateUserEditFloor(session, targetSeq) {
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : null
  if (nodes === null) return null
  const bySeq = new Map(sessionEvents(session).map(event => [event.seq, event]))
  let target = Number(targetSeq)
  let current = null
  for (let guard = 0; guard < 32; guard += 1) {
    let next = null
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const event = bySeq.get(Number(nodes[index]))
      if (!event || event.type !== 'user/message' || !event.surfaceOp || event.surfaceOp.op !== 'replace') continue
      if (surfaceReplacementRange(event.surfaceOp).start !== target) continue
      next = event
      break
    }
    if (!next) break
    current = next
    target = Number(next.seq)
  }
  return current === null ? null : { seq: Number(current.seq), event: current, turn: 0 }
}

// The newest player input on the surface. Edits are appended inside their own
// edit turn, so a turn-bounded scan cannot see a replaced input; the latest
// message is what the quick edit action targets.
export function latestUserInputFloor(session) {
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : null
  if (nodes === null) return null
  const bySeq = new Map(sessionEvents(session).map(event => [event.seq, event]))
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const seq = Number(nodes[index])
    const event = bySeq.get(seq)
    if (event && event.type === 'user/message' && inputKind(event.data) === 'player') return { seq, event, turn: 0 }
  }
  return null
}

export function userInputText(event) {
  const content = event && event.data && Array.isArray(event.data.content) ? event.data.content : []
  return content.filter(part => part && part.type === 'text').map(part => String(part.text ?? '')).join('')
}

// Edited player text keyed by native turn. The host page keeps rendering the
// original append node, so the user bubble reads this map before its own text.
// Inputs that never reached Chat (a failed or pending turn) have no message to
// carry the edit; they are stored in the Chat header instead.
export function userInputEditsOf(chat) {
  const result = {}
  const saved = chat && chat.userInputEdits && typeof chat.userInputEdits === 'object' ? chat.userInputEdits : {}
  for (const [turn, record] of Object.entries(saved)) {
    if (Number.isSafeInteger(Number(turn)) && Number(turn) > 0 && record && typeof record === 'object' && typeof record.text === 'string') result[String(Number(turn))] = record.text
  }
  for (const message of chat && Array.isArray(chat.messages) ? chat.messages : []) {
    if (!message || message.role !== 'user' || !message.bodyEdit) continue
    const turn = Number(message.bodyEdit.turn)
    if (Number.isSafeInteger(turn) && turn > 0) result[String(turn)] = String(message.text ?? '')
  }
  return result
}
