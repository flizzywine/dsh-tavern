import { toolResultsOf } from './tool-result-message.js'

const previewLimit = 2400
const preview = text => text.length > previewLimit ? text.slice(0, previewLimit) + '…' : text

/** Attach only calls made in the native turn that produced each visible reply. */
export async function storyToolCalls(sessionId, turns, readEvents) {
  const calls = new Map(turns.filter(turn => turn !== null).map(turn => [turn, new Map()]))
  if (!calls.size) return []

  for (const event of await readEvents(sessionId)) {
    if (event?.type !== 'tool/call' && event?.type !== 'tool/result') continue
    const data = event.data
    const turnCalls = calls.get(data?.turn)
    if (!turnCalls) continue
    if (event.type === 'tool/call') {
      if (typeof data.callId !== 'string' || !data.callId || typeof data.name !== 'string' || !data.name || turnCalls.has(data.callId)) continue
      const call = { id: data.callId, name: data.name, status: 'unresolved' }
      // The dice widget owns when the player can peek at a covered roll.
      if (call.name !== 'tavern_roll' && data.arguments != null) {
        call.arguments = preview(typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments))
      }
      turnCalls.set(data.callId, call)
    } else {
      for (const result of toolResultsOf(data.message)) {
        const call = turnCalls.get(result.toolCallId)
        // Compaction can append a redacted replacement for the same result.
        if (!call || call.status !== 'unresolved') continue
        call.status = result.isError || data.error ? 'error' : 'success'
        if (call.name !== 'tavern_roll') {
          call.result = preview(result.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n'))
        }
      }
    }
  }
  return turns.map(turn => turn === null ? [] : [...calls.get(turn).values()])
}
