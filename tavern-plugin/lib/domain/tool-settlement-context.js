import { sessionEvents } from './session-events.js'
import { toolResultsOf } from './tool-result-message.js'

/**
 * What a reply's tools write in its variable settlement. A mod tool declares `settlement(results)` in its tools.js entry
 * (docs/mod-authoring.md): given its successful results the reply's baseline variables do not hold yet, oldest first, as
 * their text, it returns `{ operations, note }` - the variable operations the host writes as they are (absolute values
 * under /stat_data, so a settlement run again writes the same) and one sentence for the background settlement - or nothing.
 * Those results are the ones of turns after `after` (the turn the baseline variables belong to) up to `upTo` (the reply's
 * turn) that are still on the session's surface: a regenerated or rolled-back reply's results drop out (as in
 * surface-tool-results.js), and a branch carries only the events up to its fork.
 * @returns [{ tool, note, operations }]
 */
export function toolSettlementContext(session, tools, { after = 0, upTo }) {
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
    const turn = Number(data?.turn ?? open)
    if (event?.type !== 'tool/result' || data?.error || !(turn > after && turn <= upTo)) continue
    if (visible && !visible.has(Number(event.seq ?? index))) continue
    for (const result of toolResultsOf(data?.message)) {
      const name = calls.get(result.toolCallId)
      if (!name || result.isError) continue
      const text = result.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('')
      if (text) texts.set(name, [...(texts.get(name) || []), text])
    }
  }
  return [...texts].map(([name, results]) => {
    const declaredResult = declared.get(name).settlement(results)
    return { tool: name, note: String(declaredResult?.note || '').trim(), operations: Array.isArray(declaredResult?.operations) ? declaredResult.operations : [] }
  }).filter(row => row.operations.length)
}
