function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function turnOf(message, fallback = 1) {
  return Math.max(1, Number(message && message.turn) || (message && message.greeting === true ? 1 : fallback))
}

function hasMvuState(messages) {
  return messages.some(function (message) {
    return message && Array.isArray(message.variables) && message.variables.length > 0
  })
}

function isExecutableView(part) {
  return part && part.kind === 'html' && /<(?:script|iframe|object|embed)\b/i.test(str(part.content !== undefined ? part.content : part.html))
}

/**
 * Keep a previously observed MVU-consuming iframe available on the latest
 * assistant floor. Observation comes from runtime behaviour, never card names
 * or model-specific output tags.
 */
export function retainLatestMvuView(messages, projections) {
  const sourceMessages = Array.isArray(messages) ? messages : []
  const sourceProjections = Array.isArray(projections) ? projections : []
  if (!hasMvuState(sourceMessages) || sourceProjections.length === 0) return sourceProjections

  const projectionByTurn = new Map()
  for (const projection of sourceProjections) {
    const turn = Math.max(1, Number(projection && projection.turn) || 1)
    projectionByTurn.set(turn, projection)
  }

  let latestTurn = 0
  let observed = null
  let inferredTurn = 1
  for (const message of sourceMessages) {
    if (!message) continue
    if (message.role === 'user') {
      inferredTurn += 1
      continue
    }
    if (message.role !== 'assistant') continue
    const turn = turnOf(message, inferredTurn)
    latestTurn = Math.max(latestTurn, turn)
    const projection = projectionByTurn.get(turn)
    const parts = Array.isArray(projection && projection.parts) ? projection.parts : []
    const frames = Array.isArray(message.displayRuntime && message.displayRuntime.frames) ? message.displayRuntime.frames : []
    for (const frame of frames) {
      if (!frame || frame.mvuViewUsed !== true) continue
      const partIndex = Math.max(0, Number(frame.partIndex) || 0)
      const part = parts[partIndex]
      if (!isExecutableView(part)) continue
      if (observed === null || turn >= observed.turn) observed = { turn, content: str(part.content !== undefined ? part.content : part.html) }
    }
  }

  if (observed === null || latestTurn <= 0) return sourceProjections
  const latestIndex = sourceProjections.findLastIndex(function (projection) {
    return Math.max(1, Number(projection && projection.turn) || 1) === latestTurn
  })
  if (latestIndex < 0) return sourceProjections
  const latest = sourceProjections[latestIndex]
  const parts = Array.isArray(latest.parts) ? latest.parts : []
  if (parts.some(function (part) { return part && part.kind === 'html' && str(part.content !== undefined ? part.content : part.html) === observed.content })) return sourceProjections

  const result = sourceProjections.slice()
  result[latestIndex] = Object.assign({}, latest, {
    parts: parts.concat([{ kind: 'html', content: observed.content, retainedMvuView: true }])
  })
  return result
}
