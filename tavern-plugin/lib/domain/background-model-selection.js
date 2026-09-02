function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeBackgroundModel(value) {
  if (value === null || value === undefined) return null
  const input = object(value)
  const provider = text(input.provider)
  const model = text(input.model)
  if (provider === '' || model === '') return null
  return { provider, model }
}

export function snapshotBackgroundModel(configured, foreground) {
  const fixed = normalizeBackgroundModel(configured)
  if (fixed !== null) return fixed
  const selected = normalizeBackgroundModel(foreground)
  if (selected === null) return null
  if (typeof foreground.reasoningEffort === 'string' && foreground.reasoningEffort.trim() !== '') {
    selected.reasoningEffort = foreground.reasoningEffort.trim()
  }
  return selected
}

export function resolveChatBackgroundModel(chat, fallback) {
  const source = object(chat).backgroundModelSelection || fallback
  const selected = normalizeBackgroundModel(source)
  if (selected !== null && typeof source?.reasoningEffort === 'string' && source.reasoningEffort.trim() !== '') {
    selected.reasoningEffort = source.reasoningEffort.trim()
  }
  return selected
}
