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
  const reasoningEffort = text(input.reasoningEffort)
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }
}

export function configuredChatBackgroundModel(chat, settings) {
  const game = object(chat)
  const config = object(settings)
  // A global change supersedes every older game selection. A later per-game
  // choice remains in effect until the next global model/effort change.
  if (config.backgroundModelRevision && game.backgroundModelRevision !== config.backgroundModelRevision) {
    return normalizeBackgroundModel(config.backgroundModel)
  }
  return normalizeBackgroundModel(game.backgroundModelSelection)
}

export function resolveChatBackgroundModel(chat, fallback, settings) {
  const source = configuredChatBackgroundModel(chat, settings) || fallback
  return normalizeBackgroundModel(source)
}

export async function readBackgroundModelReasoning(llm, selection) {
  const route = normalizeBackgroundModel(selection)
  if (!route) throw new Error('后台模型配置无效')
  // Older hosts can still select models, but cannot advertise reasoning levels.
  if (typeof llm.resolveModelInfo !== 'function') return null
  const info = await llm.resolveModelInfo(route.provider, route.model)
  return info.reasoning || null
}
