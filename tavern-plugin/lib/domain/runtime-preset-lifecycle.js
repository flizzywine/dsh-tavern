import { randomUUID } from 'node:crypto'
import { isProducerSource, isSystemPromptSource } from './message-source.js'
import { isTurnInput } from './session-turn-input.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function textOnly(message) {
  return Array.isArray(message && message.content) && message.content.length > 0 && message.content.every(function (block) {
    return block && block.type === 'text' && typeof block.text === 'string'
  })
}

function hasToolSemantics(message) {
  return message && (message.role === 'tool' || message.tool_call_id !== undefined ||
    (Array.isArray(message.tool_calls) && message.tool_calls.length > 0))
}

function messageText(message) {
  return message.content.map(function (block) { return block.text }).join('')
}

function mergedSource(left, right) {
  const leftSource = left && left.source && typeof left.source === 'object' ? left.source : null
  const rightSource = right && right.source && typeof right.source === 'object' ? right.source : null
  if (!leftSource && !rightSource) return undefined
  const source = Object.assign({}, leftSource || rightSource)
  const sections = []
  for (const item of [leftSource, rightSource]) {
    if (Array.isArray(item && item.sections)) sections.push(...item.sections)
  }
  if (sections.length > 0) source.sections = sections
  return source
}

function squashTextRoles(messages) {
  const merged = []
  for (const source of messages) {
    const message = Object.assign({}, source)
    message.content = Array.isArray(source && source.content) ? source.content.map(function (block) {
      return block && typeof block === 'object' ? Object.assign({}, block) : block
    }) : source && source.content
    const previous = merged[merged.length - 1]
    if (previous && previous.role === message.role && textOnly(previous) && textOnly(message) &&
      !hasToolSemantics(previous) && !hasToolSemantics(message)) {
      previous.content = [{ type: 'text', text: messageText(previous) + '\n\n' + messageText(message) }]
      const sourceInfo = mergedSource(previous, message)
      if (sourceInfo) previous.source = sourceInfo
      continue
    }
    merged.push(message)
  }
  return merged
}

function normalizeRuntimeRequestRoles(messages) {
  const merged = squashTextRoles(messages)
  for (let index = 1; index < merged.length; index += 1) {
    if (merged[index].role === 'system') merged[index].role = 'user'
  }
  return squashTextRoles(merged)
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
      id: 'dsh-tavern-runtime-preset-' + scope + '-' + phase + '-' + turn + '-' + step + '-' + randomUUID(),
      role: entry.role === 'user' || entry.role === 'assistant' ? entry.role : 'system',
      content: [{ type: 'text', text }],
      source: {
        kind: 'plugin:dsh-tavern', form: 'snapshot',
        sections: [{ name: 'tavern:runtime-preset-' + phase, text }]
      }
    }
  })
}

export function isRuntimePresetBoundaryMessage(message) {
  const source = message && message.source
  if (!isProducerSource(source, 'dsh-tavern')) return false
  return (Array.isArray(source.sections) ? source.sections : []).some(function (section) {
    return section && (section.name === 'tavern:runtime-preset-front' || section.name === 'tavern:runtime-preset-back')
  })
}

export function projectRuntimePresetRequest(request, snapshot, options = {}) {
  if (request === null || typeof request !== 'object') throw new TypeError('模型请求必须是对象')
  const source = Array.isArray(request.messages) ? request.messages : []
  const ordinary = source.filter(function (message) { return !isRuntimePresetBoundaryMessage(message) })
  const front = runtimePresetPhaseMessages(snapshot, 'front', options).map(function (message) {
    return Object.assign({}, message, { role: 'system' })
  })
  const back = runtimePresetPhaseMessages(snapshot, 'back', options).map(function (message) {
    return Object.assign({}, message, { role: 'user' })
  })
  let systemText = str(request.system)
  const moveSystem = front.length > 0 && systemText !== ''
  if (!moveSystem && front.length === 0 && back.length === 0 && ordinary.length === source.length) return request
  // V3 carries the assembled system prompt as a native message, sometimes
  // after the opening seed. Keep it at the system boundary when composing
  // presets; ordinary in-story system notes retain their existing treatment.
  const isNativeSystem = message => message.role === 'system' && isSystemPromptSource(message.source)
  let nativeSystems = ordinary.filter(isNativeSystem)
  const history = ordinary.filter(message => !isNativeSystem(message))
  // The assembly hook already puts this instruction first. External presets
  // are projected later, so lift only that known prefix across their boundary.
  const instruction = str(options.systemAppend).trim()
  let lifted = false
  function withoutInstruction(text) {
    if (!instruction || (text !== instruction && !text.startsWith(instruction + '\n\n'))) return text
    lifted = true
    return text.slice(instruction.length).replace(/^\n\n/, '')
  }
  if (front.length > 0 && instruction) {
    systemText = withoutInstruction(systemText)
    nativeSystems = nativeSystems.flatMap(message => {
      if (!textOnly(message) || hasToolSemantics(message)) return [message]
      const text = messageText(message)
      const remaining = withoutInstruction(text)
      if (remaining === text) return [message]
      if (!remaining) return []
      return [{ ...message, content: [{ type: 'text', text: remaining }], source: {
        ...message.source,
        ...(Array.isArray(message.source.sections) ? { sections: message.source.sections.filter(section => section.name !== 'tavern:system-append') } : {})
      } }]
    })
  }
  const instructions = lifted ? [{
    role: 'system', content: [{ type: 'text', text: instruction }],
    source: { kind: 'plugin:dsh-tavern', form: 'snapshot', sections: [{ name: 'tavern:system-append', text: instruction }] }
  }] : []
  const systemMessages = moveSystem && systemText ? [{
    id: 'dsh-tavern-runtime-system-' + randomUUID(),
    role: 'system',
    content: [{ type: 'text', text: systemText }],
    source: {
      kind: 'plugin:dsh-tavern', form: 'snapshot',
      sections: [{ name: 'tavern:dsh-system', text: systemText }]
    }
  }] : []
  return Object.assign({}, request, {
    ...(moveSystem ? { system: '' } : {}),
    messages: normalizeRuntimeRequestRoles(instructions.concat(front, systemMessages, nativeSystems, withBack(history, back)))
  })
}

// The back phase follows this turn's input, before the turn's first reply. On
// step 1 that is the end of the request; on later steps of a tool loop it stays
// there instead of moving after the tool results. Moving it would change the
// text before the step-1 reply, which breaks Anthropic thinking signatures and
// the provider prefix cache for every later step of the turn.
function withBack(history, back) {
  if (back.length === 0) return history
  let input = -1
  for (let index = history.length - 1; index >= 0; index--) {
    if (isTurnInput(history[index])) { input = index; break }
  }
  const reply = input < 0 ? -1 : history.findIndex((message, index) => index > input && message.role === 'assistant')
  if (reply < 0) return history.concat(back)
  return history.slice(0, reply).concat(back, history.slice(reply))
}
