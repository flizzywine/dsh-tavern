/**
 * The tool results a session or request message carries, in either shape:
 * DSH 0.2 (session v4) makes each result a first-class `role: 'tool'` message;
 * DSH 0.1.5 wrapped results as `tool-result` blocks in a user message.
 * @returns [{ toolCallId, content, isError }]
 */
export function toolResultsOf(message) {
  if (!message || typeof message !== 'object') return []
  if (message.role === 'tool') return [{ toolCallId: String(message.toolCallId ?? ''), content: Array.isArray(message.content) ? message.content : [], isError: message.isError === true }]
  return (Array.isArray(message.content) ? message.content : []).filter(block => block?.type === 'tool-result')
    .map(block => ({ toolCallId: String(block.toolCallId ?? ''), content: Array.isArray(block.content) ? block.content : [], isError: block.isError === true }))
}
