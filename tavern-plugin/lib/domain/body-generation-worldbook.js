import { sessionEvents } from './session-events.js'
import { turnStartIndex } from './session-turn-input.js'
import { toolResultsOf } from './tool-result-message.js'

const WORLD_BOOK_TOOLS = new Set(['worldbook_list', 'worldbook_grep', 'worldbook_search'])

/** Copy only completed worldbook lookups from this turn's active surface.
 * Native read is shared with other features: its successful call must point at
 * a host-owned worldbook file. Never re-read files or execute templates here. */
export function bodyGenerationWorldbookResults(session, turn, isWorldbookPath = () => false) {
  const events = sessionEvents(session), start = turnStartIndex(events, turn)
  if (start < 0) return []
  const visible = Array.isArray(session?.surface?.nodes) ? new Set(session.surface.nodes.map(Number)) : null
  const models = new Map(), calls = new Map(), seen = new Set(), results = []
  for (let index = start + 1; index < events.length; index++) {
    const event = events[index], data = event?.data
    if (event?.type === 'turn/start' || event?.type === 'turn/end') break
    if (Number(data?.turn) !== Number(turn)) continue
    const onSurface = !visible || visible.has(Number(event.seq ?? index))
    if (event.type === 'assistant/message' && data.message?.source?.kind === 'model' && onSurface) {
      for (const block of data.message.content || []) {
        if (block?.type === 'tool-call' && (WORLD_BOOK_TOOLS.has(block.name) || block.name === 'read')) models.set(block.id, block)
      }
    }
    if (event.type === 'tool/call') {
      const model = models.get(data.callId)
      if (!model || model.name !== data.name || model.arguments !== data.arguments) continue
      if (model.name === 'read') {
        let args
        try { args = JSON.parse(data.arguments) } catch { continue }
        if (typeof args?.file_path !== 'string' || !args.file_path || !isWorldbookPath(args.file_path)) continue
      }
      calls.set(data.callId, model.name)
    }
    if (event.type !== 'tool/result' || data.error || !onSurface) continue
    for (const block of toolResultsOf(data.message)) {
      const tool = calls.get(block.toolCallId)
      if (!tool || block.isError) continue
      const text = block.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n')
      if (!text.trim()) continue
      const key = JSON.stringify([tool, text])
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ tool, text })
    }
  }
  return results
}
