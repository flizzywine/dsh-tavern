import { createHash } from 'node:crypto'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function turnOf(message, fallback = 1) {
  return Math.max(1, Number(message && message.turn) || (message && message.greeting === true ? 1 : fallback))
}

function contentOf(part) {
  return str(part && (part.content !== undefined ? part.content : part.html))
}

function isRenderablePart(part) {
  return part && (part.kind === 'markdown' || part.kind === 'html') && str(part.kind === 'html' ? contentOf(part) : part.text).trim() !== ''
}

function isExecutableView(part) {
  return part && part.kind === 'html' && /<(?:script|iframe|object|embed)\b/i.test(contentOf(part))
}

function renderedPartAt(projection, partIndex) {
  const parts = Array.isArray(projection && projection.parts) ? projection.parts : []
  let renderedIndex = 0
  for (let sourceIndex = 0; sourceIndex < parts.length; sourceIndex += 1) {
    if (!isRenderablePart(parts[sourceIndex])) continue
    if (renderedIndex === partIndex) return { part: parts[sourceIndex], sourceIndex }
    renderedIndex += 1
  }
  return null
}

function templateRevisionOf(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Promote the latest iframe that actually consumed the MVU API into one
 * conversation-level status view. Classification is based on captured runtime
 * behaviour, never a card name, output tag, CSS selector, or template shape.
 */
export function projectPersistentStatusView(messages, projections) {
  const sourceMessages = Array.isArray(messages) ? messages : []
  const sourceProjections = Array.isArray(projections) ? projections : []
  if (sourceProjections.length === 0) return { projections: sourceProjections, statusView: null }

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
    const frames = Array.isArray(message.displayRuntime && message.displayRuntime.frames) ? message.displayRuntime.frames : []
    for (const frame of frames) {
      if (!frame || frame.mvuViewUsed !== true) continue
      const partIndex = Math.max(0, Number(frame.partIndex) || 0)
      const rendered = renderedPartAt(projection, partIndex)
      if (!rendered || !isExecutableView(rendered.part)) continue
      const content = contentOf(rendered.part)
      if (observed === null || turn >= observed.sourceTurn) {
        observed = { sourceTurn: turn, sourcePartIndex: partIndex, content }
      }
    }
  }

  if (observed === null) return { projections: sourceProjections, statusView: null }
  const projected = sourceProjections.map(function (projection) {
    const parts = Array.isArray(projection && projection.parts) ? projection.parts : []
    const filtered = parts.filter(function (part) {
      return !(part && part.kind === 'html' && contentOf(part) === observed.content)
    })
    return filtered.length === parts.length ? projection : Object.assign({}, projection, { parts: filtered })
  })

  return {
    projections: projected,
    statusView: {
      version: 1,
      viewId: 'primary',
      sourceTurn: observed.sourceTurn,
      sourcePartIndex: observed.sourcePartIndex,
      targetTurn: latestTurn || observed.sourceTurn,
      templateRevision: templateRevisionOf(observed.content),
      content: observed.content
    }
  }
}
