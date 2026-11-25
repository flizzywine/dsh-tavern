import { isDeepStrictEqual } from 'node:util'

export function omitUnusedToolHistory(request) {
  const history = request?.toolHistory
  if (request?.purpose !== undefined || !history || !Array.isArray(request.tools)) return request

  // The adapter can reconstruct old declarations from toolHistory. Replay it only
  // when its updates survived projection and its schemas match the admitted tools.
  if (Array.isArray(history.tools) && Array.isArray(history.updates) && history.updates.length) {
    const developerIds = new Set(request.messages.filter(message => message.role === 'developer').map(message => message.id))
    if (history.updates.every(update => developerIds.has(update.messageId) && Array.isArray(update.additions))) {
      const declared = [...history.tools, ...history.updates.flatMap(update => update.additions)]
      const allowed = new Map(request.tools.map(tool => [tool.name, tool]))
      if (new Set(declared.map(tool => tool.name)).size === allowed.size &&
        declared.every(tool => isDeepStrictEqual(tool, allowed.get(tool.name)))) return request
    }
  }
  const { toolHistory, ...current } = request
  return current
}
