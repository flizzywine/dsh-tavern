// pi-ai's Chat Completions adapter guesses each endpoint's capabilities from its
// provider id and URL, and its guess for every endpoint it does not recognise is
// "this is OpenAI": it sends OpenAI's own `store: false`. OpenAI-compatible
// endpoints that validate their payload reject the unknown field — Gemini's
// `/v1beta/openai/` answers `400 Unknown name "store"` on every request.
//
// `store` is an OpenAI platform option (and Chat Completions already defaults it
// to false), so the detected default becomes "not supported": only a route that
// declares `compat.supportsStore: true` sends it. Every catalog vendor that
// states the capability already states `false`, and the adapter still offers the
// switch on hand-declared routes, so the declaration stays the single source.

export const PI_AI_OPENAI_STORE_MARKER = '/* dsh-tavern:pi-ai-openai-store */'

const DETECTED_STORE = '        supportsStore: !isNonStandard,\n'

/** Make `store` opt-in in pi-ai's openai-completions compat detection. */
export function patchPiAiOpenAIStoreSource(source) {
  const text = String(source)
  if (text.includes(PI_AI_OPENAI_STORE_MARKER)) return { status: 'patched', text }
  const at = text.indexOf(DETECTED_STORE)
  if (at < 0 || at !== text.lastIndexOf(DETECTED_STORE)) return { status: 'unmatched', text }
  const patched = text.slice(0, at) + `        ${PI_AI_OPENAI_STORE_MARKER}\n        supportsStore: false,\n` + text.slice(at + DETECTED_STORE.length)
  return { status: 'applied', text: patched }
}
