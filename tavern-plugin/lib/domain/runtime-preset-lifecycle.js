function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function runtimePresetPhaseMessages(snapshot, phase, options = {}) {
  const projected = snapshot && snapshot[phase]
  const scope = str(options.scope) || 'foreground'
  const turn = Math.max(0, Number(options.turn) || 0)
  const step = Math.max(1, Number(options.step) || 1)
  return (projected && Array.isArray(projected.entries) ? projected.entries : []).filter(function (entry) {
    return str(entry && entry.content).trim() !== ''
  }).map(function (entry) {
    const text = str(entry.content)
    return {
      id: 'dsh-tavern-runtime-preset-' + scope + '-' + phase + '-' + turn + '-' + step + '-' + crypto.randomUUID(),
      role: entry.role === 'user' || entry.role === 'assistant' ? entry.role : 'system',
      content: [{ type: 'text', text }],
      source: {
        kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot',
        sections: [{ name: 'tavern:runtime-preset-' + phase, text }]
      }
    }
  })
}

export function isRuntimePresetBoundaryMessage(message) {
  const source = message && message.source
  if (!source || source.kind !== 'plugin' || source.plugin !== 'dsh-tavern') return false
  return (Array.isArray(source.sections) ? source.sections : []).some(function (section) {
    return section && (section.name === 'tavern:runtime-preset-front' || section.name === 'tavern:runtime-preset-back')
  })
}

export function clearRuntimePresetBoundaryMessages(session, options = {}) {
  const events = Array.isArray(session && session.events) ? session.events : []
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  const targets = nodes.filter(function (seq) {
    const event = events[seq]
    return event && event.data && isRuntimePresetBoundaryMessage(event.data.message)
  })
  if (targets.length === 0) return 0
  const source = options.source && options.source.kind === 'model'
    ? options.source
    : { kind: 'model', provider: str(options.provider) || 'unknown', model: str(options.model) || 'unknown' }
  const groups = []
  for (const seq of targets) {
    const current = groups[groups.length - 1]
    if (current && current[current.length - 1] + 1 === seq) current.push(seq)
    else groups.push([seq])
  }
  for (const group of groups) {
    session.append('assistant/message', {
      turn: Math.max(0, Number(options.turn) || 0),
      step: Math.max(1, Number(options.step) || 1),
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [],
        source
      }
    }, {
      surfaceOp: { op: 'replace', start: group[0], end: group[group.length - 1] },
      sourceEventSeqs: group
    })
  }
  return targets.length
}
