import { storyEventTurn } from './session-upgrade-references.js'
import { sessionEvents } from './session-events.js'
import { turnStartIndex } from './session-turn-input.js'
import { STORY_SUBMIT_ACK_TEXT, detectStoryRefusal, storySubmissionForTurn } from './story-tool-submission.js'

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
  if (submitted !== null) {
    const nativeReasoning = blockText(submitted.event?.data?.message, 'reasoning')
    const toolThink = str(submitted.toolThinkText).trim()
    const reasoningText = [nativeReasoning, toolThink].filter(Boolean).join('\n').trim()
    return { ...submitted, reasoningText, reasoningOnly: false }
  }
  const events = sessionEvents(session)
  const start = turnStartIndex(events, turn)
  for (let index = events.length - 1; index > start; index -= 1) {
    const event = events[index]
    if (!event || event.type !== 'assistant/message') continue
    if (Number(event.data?.turn) !== Number(turn) && storyEventTurn(event) !== Number(turn)) continue
    const message = event.data && event.data.message
    const source = message && message.source
    if (!source || source.kind !== 'model') continue
    const text = blockText(message, 'text')
    const reasoningText = blockText(message, 'reasoning')
    const plainTextRefusal = text !== '' && (text === STORY_SUBMIT_ACK_TEXT || detectStoryRefusal(text))
    return {
      index,
      event,
      text,
      reasoningText,
      reasoningOnly: text === '' && reasoningText !== '',
      ...(plainTextRefusal ? { plainTextRefusal: true } : {})
    }
  }
  return null
}
