import { channelSettings, channelReady, channelNeedsKey, imageCredentialRef, SCENE_IMAGE_CHANNELS } from './scene-image-channels.js'
import { imageStyleSettings, SCENE_STYLE_PRESETS } from './scene-image-style.js'

const path = 'scene-images/settings.json'
function document(value = {}) {
  if (value.version === 2) return { version: 2, enabled: value.enabled === true, provider: value.provider || 'openai', style: imageStyleSettings(value.style), providers: { ...value.providers } }
  // Keep legacy endpoint/model values, including an explicitly empty model.
  return { version: 2, enabled: value.enabled === true, provider: 'openai', style: imageStyleSettings(value.style), providers: { openai: channelSettings(value, 'openai') } }
}
function selection(doc, provider = doc.provider) {
  return { ...channelSettings(doc.providers[provider] || {}, provider), enabled: doc.enabled && provider === doc.provider, style: doc.style }
}

/** Provider preview is read-only; saving a different provider requires opting in again. */
export function createSceneImageSettings({ store, credentials }) {
  let pending = Promise.resolve()
  async function config() { return selection(document(await store.readJson(path) || {})) }
  async function capture() {
    let snapshot
    // Share the settings write lock: never pair an old endpoint with a key
    // saved by a concurrent channel edit. No settings write is performed here.
    await store.updateJson(path, async value => {
      const active = selection(document(value || {}))
      const key = channelNeedsKey(active) ? await credentials()?.resolve(imageCredentialRef(active.provider, active.authType)) : undefined
      snapshot = { active, apiKey: key?.value || '' }
      return undefined
    })
    return snapshot
  }
  async function settings(provider) {
    const doc = document(await store.readJson(path) || {})
    const current = selection(doc, provider)
    const key = await credentials()?.resolve(imageCredentialRef(current.provider, current.authType))
    return { ...current, activeProvider: doc.provider, channels: SCENE_IMAGE_CHANNELS, stylePresets: SCENE_STYLE_PRESETS, hasKey: Boolean(key?.value), ready: channelReady(current, key?.value) }
  }
  function configure(input = {}) {
    const result = pending.then(() => save(input))
    pending = result.catch(() => {})
    return result
  }
  async function save(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('生图配置必须是对象')
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('启用状态必须为布尔值')
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('API Key 必须是文本')
    if (input.style !== undefined) imageStyleSettings(input.style)
    await store.updateJson(path, async value => {
      const doc = document(value || {})
      const provider = input.provider ?? doc.provider
      const current = selection(doc, provider)
      const next = channelSettings({ ...current, ...input }, provider)
      const ref = imageCredentialRef(provider, next.authType)
      const suppliedKey = next.authType === 'basic' ? input.apiKey : input.apiKey?.trim()
      const credentialStore = credentials()
      const key = await credentialStore?.resolve(ref)
      const switched = provider !== doc.provider || next.authType !== current.authType
      // An enable call cannot simultaneously introduce a new channel/config.
      const changed = JSON.stringify(channelSettings(current)) !== JSON.stringify(next) || Boolean(suppliedKey)
      if (input.enabled === true && (switched || changed || !channelReady(current, key?.value))) throw new Error('请先保存完整生图配置，再手动启用')
      const style = imageStyleSettings({ ...doc.style, ...input.style })
      if (suppliedKey) {
        if (typeof credentialStore?.set !== 'function') throw new Error('当前 DSH 不支持保存凭据，请配置 ' + ref)
        await credentialStore.set(ref, suppliedKey)
      }
      const ready = channelReady(next, suppliedKey || key?.value)
      return { ...doc, provider, style, enabled: ready && !switched && (input.enabled ?? doc.enabled), providers: { ...doc.providers, [provider]: next } }
    })
    return settings()
  }
  return { config, settings, configure, capture }
}
