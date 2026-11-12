import { sessionEvents } from './session-events.js'
import { toolResultsOf } from './tool-result-message.js'

/**
 * A foreground tool's earlier successful results in this game, oldest first, as their text: those on the session's
 * current surface (the visible branch: a regenerated or rolled-back round's results drop out) plus those of the turn
 * running now. A mod tool that keeps its record in its own results (lib/mod-tools.js) reads its history here.
 */
export function surfaceToolResults(session, name, turn) {
  const events = sessionEvents(session)
  const visible = Array.isArray(session?.surface?.nodes) ? new Set(session.surface.nodes.map(Number)) : null
  const calls = new Set(), texts = []
  for (let index = 0; index < events.length; index++) {
    const event = events[index], data = event?.data
    if (event?.type === 'tool/call' && data?.name === name) calls.add(data.callId)
    if (event?.type !== 'tool/result' || data?.error) continue
    if (visible && !visible.has(Number(event.seq ?? index)) && Number(data?.turn) !== Number(turn)) continue
    for (const result of toolResultsOf(data?.message)) {
      if (!calls.has(result.toolCallId) || result.isError) continue
      const text = result.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('')
      if (text) texts.push(text)
    }
  }
  return texts
}
