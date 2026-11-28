import { isCompactionCheckpointMessage } from './compaction-checkpoint.js'
import { isProducerSource } from './message-source.js'
import { hasProviderContent } from './provider-message-content.js'
import { isTurnInput } from './session-turn-input.js'
import { STYLE_REFERENCE_SECTION, STYLE_REFERENCE_TOOL_NAME, stripStyleReferenceMarkup } from './style-reference-protocol.cjs'

function isStyleReferenceSection(section) {
  const source = section?.source
  return section?.name === STYLE_REFERENCE_SECTION
    || (source?.stage === 'plugin' && source.plugin === 'dsh-tavern' && source.name === 'style-reference')
    || (source?.stage === 'context-plan' && source.sectionKind === 'style-reference')
}

function isStyleCall(block) {
  return block?.type === 'tool-call' && block.name === STYLE_REFERENCE_TOOL_NAME
}

function projectMessage(message, styleCallIds) {
  const { role, source, content } = message
  if (role === 'tool' && styleCallIds.has(message.toolCallId)) return null
  if (!Array.isArray(content)) return message

  const frame = role === 'user' && isProducerSource(source, 'dsh-tavern') && source.form === 'foreground-frame'
  const sections = (frame || role === 'system') && Array.isArray(source?.sections) ? source.sections : []
  const styleSections = sections.filter(isStyleReferenceSection)
  const hasStyleCall = role === 'assistant' && content.some(isStyleCall)
  const stripText = role === 'system' || role === 'assistant' || frame || isCompactionCheckpointMessage(message)
  const blocks = content.flatMap(block => {
    if (isStyleCall(block)) return []
    if (block?.type === 'tool-result' && styleCallIds.has(block.toolCallId)) return []
    if (role === 'developer' && block?.toolName === STYLE_REFERENCE_TOOL_NAME) return []
    if (role === 'assistant' && block?.type === 'reasoning') {
      const text = typeof block.text === 'string' ? block.text : ''
      if (hasStyleCall || text.includes(STYLE_REFERENCE_TOOL_NAME) || stripStyleReferenceMarkup(text) !== text) return []
    }
    if (!stripText || block?.type !== 'text' || typeof block.text !== 'string') return [block]
    let text = block.text
    for (const section of styleSections) {
      if (section.text) text = text.replace(section.text, '')
    }
    text = stripStyleReferenceMarkup(text)
    if (text === block.text) return [block]
    return text.trim() ? [{ ...block, text }] : []
  })
  if (!styleSections.length && blocks.length === content.length && blocks.every((block, index) => block === content[index])) return message

  // Native replay metadata indexes the original response blocks.
  const { replayState, ...projectedSource } = source || {}
  if (styleSections.length) projectedSource.sections = sections.filter(section => !isStyleReferenceSection(section))
  const projected = { ...message, content: blocks, ...(source ? { source: projectedSource } : {}) }
  return blocks.length && hasProviderContent(projected) ? projected : null
}

function isStyleDeclaration(tool) {
  return tool?.name === STYLE_REFERENCE_TOOL_NAME
}

/** Remove inactive style instructions and tool exchanges from a request copy. */
export function projectWithoutStyleReference(request) {
  const source = request.messages ?? []
  const styleCallIds = new Set()
  for (const message of source) {
    if (message.role !== 'assistant') continue
    for (const block of message.content ?? []) {
      if (isStyleCall(block)) styleCallIds.add(block.id)
    }
  }
  const messages = source.map(message => projectMessage(message, styleCallIds))
  const messagesChanged = messages.some((message, index) => message !== source[index])
  const system = typeof request.system === 'string' ? stripStyleReferenceMarkup(request.system) : request.system
  const tools = request.tools?.some(isStyleDeclaration)
    ? request.tools.filter(tool => !isStyleDeclaration(tool)) : request.tools
  const history = request.toolHistory
  const staleHistory = history?.tools?.some(isStyleDeclaration) ||
    history?.updates?.some(update => update.additions?.some(isStyleDeclaration))
  if (!messagesChanged && system === request.system && tools === request.tools && !staleHistory) return request

  const projected = { ...request }
  if (messagesChanged) projected.messages = messages.filter(Boolean)
  if (tools !== request.tools) projected.tools = tools
  if (system !== request.system) projected.system = system
  if (staleHistory) delete projected.toolHistory
  return projected
}

/** Writing references belong to the request that selected them. Keep the saved frame for inspection. */
export function projectPriorWritingReferences(messages) {
  const input = messages.findLastIndex(isTurnInput)
  if (input <= 0) return messages
  let changed = false
  const projected = messages.flatMap((message, index) => {
    const source = message?.source
    if (index >= input || message?.role !== 'user' || !isProducerSource(source, 'dsh-tavern') || source.form !== 'foreground-frame') return [message]
    const sections = Array.isArray(source.sections) ? source.sections : []
    const references = sections.filter(section => section?.source?.writingReference === true)
    if (!references.length) return [message]
    changed = true
    const content = (message.content || []).flatMap(block => {
      if (block?.type !== 'text' || typeof block.text !== 'string') return [block]
      const text = references.reduce((value, section) => value.replace(section.text, ''), block.text).trim()
      return text ? [{ ...block, text }] : []
    })
    if (!content.length) return []
    return [{ ...message, content, source: { ...source, sections: sections.filter(section => !references.includes(section)) } }]
  })
  return changed ? projected : messages
}
