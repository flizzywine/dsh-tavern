import { storyEventTurn } from './session-upgrade-references.js'
import { sessionEvents } from './session-events.js'
import { turnStartIndex } from './session-turn-input.js'
import { storySubmissionForTurn } from './story-tool-submission.js'
function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function blockText(message, type) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter(function (block) { return block && block.type === type })
    .map(function (block) { return str(block.text) })
    .filter(Boolean)
    .join('\n')
    .trim()
}

/** Preserve the distinction between model reasoning and user-visible reply text. */
export function assistantResultForTurn(session, turn) {
  const submitted = storySubmissionForTurn(session, turn)
  if (submitted !== null) return { ...submitted, reasoningText: blockText(submitted.event.data.message, 'reasoning'), reasoningOnly: false }
  const events = sessionEvents(session)
  const start = turnStartIndex(events, turn)
  for (let index = events.length - 1; index > start; index -= 1) {
    const event = events[index]
    if (!event || event.type !== 'assistant/message' || storyEventTurn(event) !== Number(turn)) continue
    const message = event.data && event.data.message
    const source = message && message.source
    if (!source || source.kind !== 'model') continue
    const text = blockText(message, 'text')
    const reasoningText = blockText(message, 'reasoning')
    return { index, event, text, reasoningText, reasoningOnly: text === '' && reasoningText !== '' }
  }
  return null
}
