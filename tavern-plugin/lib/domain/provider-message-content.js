// Internal surface markers and blank text carry no prompt content. Tool results
// keep their own protocol semantics, including results with an empty payload.
export function hasProviderContent(message) {
  if (!['system', 'user', 'assistant'].includes(message?.role) || !Array.isArray(message.content)) return true
  return message.content.some(block => block && (block.type !== 'text' || /\S/.test(String(block.text ?? ''))))
}

export function omitEmptyProviderContent(request) {
  const { messages, system } = request
  const blankMessages = Array.isArray(messages) && messages.some(message => !hasProviderContent(message))
  const blankSystem = typeof system === 'string' && !system.trim()
  if (!blankMessages && !blankSystem) return request
  const projected = { ...request }
  if (blankMessages) projected.messages = messages.filter(hasProviderContent)
  if (blankSystem) delete projected.system
  return projected
}
