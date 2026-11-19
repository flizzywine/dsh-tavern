import { endpointHistory } from './endpoint-history.js'
import { fail } from './core.js'

// 设置 › 模型 (the host's provider cards, patched by bin/settings-models-endpoints-patch.mjs): the same 最近用过的网址 as
// the voice services, per model provider. A provider's connection is its API 地址 (settings `baseURL` at the card's
// path in its LLM namespace) and its API Key (the credential the card stores it under, `keyRef`). The list lives in
// the credential store like the voice services' own; switching writes both, as the card's own save would.
const NAMESPACES = new Set(['llm-pi-ai', 'llm-deepseek'])
const REF = /^[A-Z_][A-Z0-9_]{0,127}$/
const recentRef = provider => 'DSH_TAVERN_MODEL_' + provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_RECENT'

export function createModelEndpoints({ credentials, settings }) {
  let chain = Promise.resolve()
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p }
  // Validated once, as the request comes in: an LLM namespace, a short settings path, a credential name.
  function target({ provider, ns, path, keyRef }) {
    if (typeof provider !== 'string' || !/^[\w.-]{1,80}$/.test(provider) || !NAMESPACES.has(ns) || !Array.isArray(path) || path.length > 4
      || path.some(part => typeof part !== 'string' || !part || part.length > 80) || typeof keyRef !== 'string' || !REF.test(keyRef)) fail('INVALID_INPUT')
    return { provider, ns, path, keyRef, history: endpointHistory(credentials, recentRef(provider)) }
  }
  const keyOf = async t => (await credentials()?.resolve(t.keyRef))?.value || ''
  return {
    // The provider's saved pair is recorded as the card opens (`url`: its saved API 地址, or the provider's default).
    list(args) { return serial(async () => {
      const t = target(args), url = typeof args.url === 'string' && /^https?:\/\/\S+$/.test(args.url) ? args.url.replace(/\/+$/, '') : undefined
      const key = await keyOf(t)
      if (url) await t.history.remember({ url, key })
      return { recent: await t.history.list(url ? { url, key } : undefined) }
    }) },
    // 使用: the recorded pair becomes the provider's API 地址 and API Key; the key goes back when the settings write fails.
    use(args) { return serial(async () => {
      const t = target(args), pair = await t.history.take(args.entry), c = credentials(), previous = await keyOf(t)
      if (!c) fail('CREDENTIALS_REQUIRED')
      const store = value => value ? c.set(t.keyRef, value) : c.unset(t.keyRef)
      await store(pair.key)
      try { await settings().mutate(t.ns, [{ op: 'set', path: [...t.path, 'baseURL'], value: pair.url }]) }
      catch (error) { await store(previous); throw error }
      await t.history.remember(pair)
      return { recent: await t.history.list(pair) }
    }) },
    rename(args) { return serial(async () => { const t = target(args); await t.history.rename(args.entry, args.label); return { recent: await t.history.list() } }) },
    forget(args) { return serial(async () => { const t = target(args); await t.history.forget(args.entry); return { recent: await t.history.list() } }) },
    clear(args) { return serial(async () => { const t = target(args); await t.history.clear(); return { recent: [] } }) },
  }
}
