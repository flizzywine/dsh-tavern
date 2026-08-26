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

export function projectRuntimePresetRequestMessages(messages, snapshot, options = {}) {
  const source = Array.isArray(messages) ? messages : []
  const ordinary = source.filter(function (message) { return !isRuntimePresetBoundaryMessage(message) })
  const front = runtimePresetPhaseMessages(snapshot, 'front', options)
  const back = runtimePresetPhaseMessages(snapshot, 'back', options)
  if (front.length === 0 && back.length === 0 && ordinary.length === source.length) return source
  return front.concat(ordinary, back)
}

export function projectRuntimePresetRequest(request, snapshot, options = {}) {
  if (request === null || typeof request !== 'object') throw new TypeError('模型请求必须是对象')
  const source = Array.isArray(request.messages) ? request.messages : []
  const ordinary = source.filter(function (message) { return !isRuntimePresetBoundaryMessage(message) })
  const front = runtimePresetPhaseMessages(snapshot, 'front', options)
  const back = runtimePresetPhaseMessages(snapshot, 'back', options)
  const systemText = str(request.system)
  const moveSystem = front.length > 0 && systemText !== ''
  if (!moveSystem && front.length === 0 && back.length === 0 && ordinary.length === source.length) return request
  const systemMessages = moveSystem ? [{
    id: 'dsh-tavern-runtime-system-' + crypto.randomUUID(),
    role: 'system',
    content: [{ type: 'text', text: systemText }],
    source: {
      kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot',
      sections: [{ name: 'tavern:dsh-system', text: systemText }]
    }
  }] : []
  return Object.assign({}, request, {
    ...(moveSystem ? { system: '' } : {}),
    messages: front.concat(systemMessages, ordinary, back)
  })
}
