import { sessionEvents } from './session-events.js'
import { toolResultsOf } from './tool-result-message.js'

/**
 * What a reply's tools ask its variable settlement to see. A mod tool declares `settlement(results)` in its tools.js
 * entry (docs/mod-authoring.md): given the reply's own successful results of that tool, oldest first, as their text,
 * it returns the short text the settlement copies from (e.g. the values a check settled), or nothing.
 * Only results of `turn` still on the session's surface count: a regenerated or rolled-back reply's results drop out
 * (as in surface-tool-results.js), and a branch carries only the events up to its fork.
 * @returns [{ tool, text }]
 */
export function toolSettlementContext(session, tools, turn) {
  const declared = new Map(tools.filter(tool => typeof tool.settlement === 'function').map(tool => [tool.name, tool]))
  if (!declared.size) return []
  const visible = Array.isArray(session?.surface?.nodes) ? new Set(session.surface.nodes.map(Number)) : null
  const calls = new Map(), texts = new Map()
  let open = null
  for (const [index, event] of sessionEvents(session).entries()) {
    const data = event?.data
    if (event?.type === 'turn/start') open = data?.turn ?? null
    else if (event?.type === 'turn/end') open = null
    if (event?.type === 'tool/call' && declared.has(data?.name)) calls.set(String(data.callId), data.name)
    if (event?.type !== 'tool/result' || data?.error || Number(data?.turn ?? open) !== Number(turn)) continue
    if (visible && !visible.has(Number(event.seq ?? index))) continue
    for (const result of toolResultsOf(data?.message)) {
      const name = calls.get(result.toolCallId)
      if (!name || result.isError) continue
      const text = result.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('')
      if (text) texts.set(name, [...(texts.get(name) || []), text])
    }
  }
  return [...texts].map(([name, results]) => ({ tool: name, text: String(declared.get(name).settlement(results) || '').trim() })).filter(row => row.text)
}
