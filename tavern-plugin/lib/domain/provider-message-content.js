// Internal surface markers and blank text carry no prompt content. Tool results
// keep their own protocol semantics, including results with an empty payload.
export function hasProviderContent(message) {
  if (!['system', 'user', 'assistant'].includes(message?.role) || !Array.isArray(message.content)) return true
  return message.content.some(block => block && (block.type !== 'text' || /\S/.test(String(block.text ?? ''))))
}
