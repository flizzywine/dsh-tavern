function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function turnStartIndex(events, turn) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && event.type === 'turn/start' && Number(event.data && event.data.turn) === Number(turn)) return index
  }
  return -1
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
  const events = Array.isArray(session && session.events) ? session.events : []
  const start = turnStartIndex(events, turn)
  for (let index = events.length - 1; index > start; index -= 1) {
    const event = events[index]
    if (!event || event.type !== 'assistant/message' || Number(event.data && event.data.turn) !== Number(turn)) continue
    const message = event.data && event.data.message
    const source = message && message.source
    if (!source || source.kind !== 'model') continue
    const text = blockText(message, 'text')
    const reasoningText = blockText(message, 'reasoning')
    return { index, event, text, reasoningText, reasoningOnly: text === '' && reasoningText !== '' }
  }
  return null
}
