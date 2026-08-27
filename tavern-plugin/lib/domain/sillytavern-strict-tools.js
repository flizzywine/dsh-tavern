const DEFAULT_PLACEHOLDER = '[Start a new chat]'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function cloneMessage(message) {
  const copy = Object.assign({}, message)
  copy.content = str(message && message.content)
  if (Array.isArray(message && message.tool_calls)) {
    copy.tool_calls = message.tool_calls.map(function (item) { return Object.assign({}, item) })
  }
  return copy
}

function startsWithGroupName(content, groupNames) {
  return groupNames.some(function (name) { return content.startsWith(name + ': ') })
}

function addNamePrefix(message, names) {
  const content = message.content
  if (message.role === 'system' && message.name === 'example_assistant') {
    if (names.charName && !content.startsWith(names.charName + ': ') && !startsWithGroupName(content, names.groupNames)) {
      message.content = names.charName + ': ' + content
    }
  } else if (message.role === 'system' && message.name === 'example_user') {
    if (names.userName && !content.startsWith(names.userName + ': ')) message.content = names.userName + ': ' + content
  } else if (message.name && message.role !== 'system' && !content.startsWith(message.name + ': ')) {
    message.content = message.name + ': ' + content
  }
  delete message.name
  return message
}

function squashConsecutiveRoles(messages) {
  const merged = []
  for (const message of messages) {
    const previous = merged[merged.length - 1]
    if (previous && previous.role === message.role && message.content && message.role !== 'tool') {
      previous.content += '\n\n' + message.content
    } else {
      merged.push(message)
    }
  }
  return merged
}

/**
 * Reproduce SillyTavern 1.18.0 `strict_tools` prompt post-processing for the
 * text-only messages produced by the compatibility compiler.
 */
export function applySillyTavernStrictTools(messages, options = {}) {
  const names = {
    charName: str(options.charName),
    userName: str(options.userName),
    groupNames: Array.isArray(options.groupNames) ? options.groupNames.map(str) : []
  }
  const placeholder = str(options.placeholder) || DEFAULT_PLACEHOLDER
  const prepared = (Array.isArray(messages) ? messages : []).map(function (source) {
    const message = addNamePrefix(cloneMessage(source || {}), names)
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool') {
      message.role = 'system'
    }
    return message
  })
  let merged = squashConsecutiveRoles(prepared)
  if (merged.length === 0) merged = [{ role: 'user', content: placeholder }]

  for (let index = 1; index < merged.length; index += 1) {
    if (merged[index].role === 'system') merged[index].role = 'user'
  }
  if (merged[0].role === 'system' && (merged.length === 1 || merged[1].role !== 'user')) {
    merged.splice(1, 0, { role: 'user', content: placeholder })
  } else if (merged[0].role !== 'system' && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: placeholder })
  }
  return squashConsecutiveRoles(merged)
}
