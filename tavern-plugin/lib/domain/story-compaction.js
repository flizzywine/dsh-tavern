export function usesStoryCompaction(chat) {
  return chat !== null && typeof chat === 'object' && (chat.mode === 'story' || chat.mode === 'script')
}

export function createStoryCompactionRequest(options, instruction) {
  if (options === null || typeof options !== 'object' || options.purpose !== 'compaction') return options
  if (!Array.isArray(options.messages) || options.messages.length === 0) return options
  if (typeof instruction !== 'string' || instruction.trim() === '') throw new TypeError('剧情压缩提示词不能为空')

  const lastIndex = options.messages.length - 1
  const message = options.messages[lastIndex]
  const source = message && message.source
  if (message === null || typeof message !== 'object' || message.role !== 'user' ||
    source === null || typeof source !== 'object' || source.plugin !== 'dsh-compaction-basic') return options

  const messages = options.messages.slice()
  messages[lastIndex] = Object.freeze(Object.assign({}, message, {
    content: Object.freeze([Object.freeze({ type: 'text', text: instruction })])
  }))
  return Object.freeze(Object.assign({}, options, { messages: Object.freeze(messages) }))
}
