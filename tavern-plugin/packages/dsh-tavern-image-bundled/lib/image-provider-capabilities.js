// Custom endpoints use one explicitly selected wire protocol. Keep this list
// closed: channel settings never contain executable request templates.
export const IMAGE_API_PROTOCOLS = Object.freeze([
  'openai', 'gemini', 'gemini-chat', 'atlascloud', 'seedream', 'grok', 'qwen', 'sdwebui', 'novelai',
])

const referenceProtocols = new Set([
  'openai', 'gemini', 'gemini-chat', 'atlascloud', 'seedream', 'grok', 'qwen', 'sdwebui',
])
const resumableProtocols = new Set(['atlascloud', 'qwen'])

export function effectiveImageProvider(channel) {
  const provider = typeof channel === 'string' ? channel : channel?.provider
  if (provider !== 'custom') return provider
  const protocol = typeof channel === 'object' && channel
    ? String(channel.options?.apiProtocol || 'openai').trim()
    : 'openai'
  if (!IMAGE_API_PROTOCOLS.includes(protocol)) throw new Error('自定义渠道的接口协议不受支持')
  return protocol
}

export function supportsImageReferences(channel) {
  const provider = effectiveImageProvider(channel)
  if (provider === 'qwen' && typeof channel === 'object' && channel?.options?.apiMode === 'async') return false
  return referenceProtocols.has(provider)
}

/** How many reference pictures one request of this channel takes (0 = none). */
export function imageReferenceLimit(channel) {
  if (!supportsImageReferences(channel)) return 0
  const provider = effectiveImageProvider(channel)
  return provider === 'grok' || provider === 'sdwebui' ? 1 : 4
}

export function supportsImageTaskResume(channel) {
  return resumableProtocols.has(effectiveImageProvider(channel))
}
