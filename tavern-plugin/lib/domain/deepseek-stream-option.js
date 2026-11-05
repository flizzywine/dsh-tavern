// DSH 0.2.1's native DeepSeek Messages adapter only understands SSE. Keep its existing
// translator by projecting a settled Messages JSON response into the equivalent event sequence.
export const DEEPSEEK_STREAM_OPTION_MARKER = '/* dsh-tavern:stream-option */'

export function deepSeekEventsFromResponse(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('DeepSeek Messages returned a non-object response')
  const usage = message.usage && typeof message.usage === 'object' && !Array.isArray(message.usage) ? message.usage : {}
  const content = Array.isArray(message.content) ? message.content : []
  const events = [{ type: 'message_start', message: { usage } }]
  for (const [index, block] of content.entries()) {
    events.push({ type: 'content_block_start', index, content_block: block })
    events.push({ type: 'content_block_stop', index })
  }
  const stopReason = message.stop_reason ?? (content.some(block => block?.type === 'tool_use') ? 'tool_use' : 'end_turn')
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason }, usage })
  events.push({ type: 'message_stop' })
  return events
}

function replaceOnce(text, from, to) {
  const first = text.indexOf(from)
  if (first < 0 || text.indexOf(from, first + from.length) >= 0) return null
  return text.slice(0, first) + to + text.slice(first + from.length)
}

/** Patch the writable host artifact; repeated installs are no-ops and drift is left untouched. */
export function patchDeepSeekStreamSource(source) {
  const text = String(source)
  if (text.includes(DEEPSEEK_STREAM_OPTION_MARKER)) return { status: 'patched', text }
  let patched = text
  const replacements = [
    ['\n\t\tstream: true,', '\n\t\tstream: options.stream !== false,'],
    ['"accept": "text/event-stream",', '"accept": options.stream === false ? "application/json" : "text/event-stream",'],
    ['yield* translate(parseSse(response.body, activity), options.model);', 'yield* translate(options.stream === false ? deepSeekEventsFromResponse(await response.json()) : parseSse(response.body, activity), options.model);'],
  ]
  for (const [from, to] of replacements) {
    patched = replaceOnce(patched, from, to)
    if (patched === null) return { status: 'unmatched', text }
  }
  const anchor = 'async function* translate(events, model) {'
  if (!patched.includes(anchor) || patched.indexOf(anchor) !== patched.lastIndexOf(anchor)) return { status: 'unmatched', text }
  patched = patched.replace(anchor, DEEPSEEK_STREAM_OPTION_MARKER + '\n' + deepSeekEventsFromResponse.toString() + '\n' + anchor)
  return { status: 'applied', text: patched }
}
