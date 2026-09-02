import { channelSettings, imageCredentialRef, channelNeedsKey } from './scene-image-channels.js'
import { imageStyleSettings, SCENE_STYLE_PRESETS } from './scene-image-style.js'

const path = 'scene-images/settings.json'
function document(value = {}) {
  // Opt in explicitly; keep saved choices when reading older configurations.
  if (!Object.keys(value).length) return { version: 4, provider: 'openai', enabled: false, style: imageStyleSettings(), providers: {} }
  if ([2, 3, 4].includes(value.version)) return { ...value, provider: value.provider || 'openai', enabled: value.enabled === true, style: imageStyleSettings(value.style), providers: { ...value.providers } }
  return { version: 2, provider: 'openai', enabled: value.enabled === true, style: imageStyleSettings(value.style), providers: { openai: channelSettings(value, 'openai') } }
}

/** Tavern owns enable/style only. Provider settings belong to the image module. */
export function createModuleSceneImageSettings({ store, credentials, imageModule }) {
  let pending = Promise.resolve()
  function service() { return imageModule }
  const serial = fn => { const result = pending.then(fn); pending = result.catch(() => {}); return result }
  async function read(provider, resolveKey = true) {
    const doc = document(await store.readJson(path) || {})
    const current = await service()[resolveKey ? 'inspect' : 'describe'](provider || doc.provider)
    const legacy = doc.providers[current.provider]
    // Read-only preview: do not copy credentials or write merely by opening Settings.
    const migration = Boolean(legacy && current.provider !== 'dsh-image-gen')
    const value = migration ? { ...current, ...channelSettings(legacy, current.provider), migrationPending: true } : current
    const oldKey = resolveKey && migration && channelNeedsKey(value) ? await credentials()?.resolve(imageCredentialRef(value.provider, value.authType)) : undefined
    return { ...value, enabled: doc.enabled,
      ready: !migration && current.ready, hasKey: migration ? Boolean(oldKey?.value) : current.hasKey,
      style: doc.style, stylePresets: SCENE_STYLE_PRESETS, activeProvider: doc.provider === 'dsh-image-gen' ? current.provider : doc.provider }
  }
  async function migrationInput(input, current) {
    if (!current.migrationPending || input.apiKey || !channelNeedsKey(current)) return input
    const next = channelSettings({ ...current, ...input })
    if (['baseURL', 'authType', 'username'].some(key => next[key] !== current[key])) throw new Error('旧配置地址或鉴权身份已修改，请重新填写 API Key')
    const key = await credentials()?.resolve(imageCredentialRef(current.provider, current.authType))
    return { ...input, apiKey: key?.value || '' }
  }
  return {
    settings: provider => serial(() => read(provider)),
    config: () => serial(() => read(undefined, false)),
    capture: () => serial(async () => {
      const current = await read()
      if (current.migrationPending) throw new Error('请先保存并迁移旧生图配置')
      const snapshot = await service().capture(current.provider)
      return { active: { ...snapshot.active, enabled: current.enabled, style: current.style }, apiKey: snapshot.apiKey }
    }),
    configure: (input = {}) => serial(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('生图配置必须是对象')
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('启用状态必须为布尔值')
      const doc = document(await store.readJson(path) || {})
      const current = await read(input.provider)
      const id = current.provider
      const changesProvider = id !== (doc.provider === 'dsh-image-gen' ? current.activeProvider : doc.provider)
      const edits = Object.keys(input).some(key => !['provider', 'enabled'].includes(key))
      if (input.enabled === true && (changesProvider || edits)) throw new Error('请先保存完整生图配置，再手动启用')
      let next = current
      if (edits) {
        const style = imageStyleSettings({ ...doc.style, ...input.style })
        const adapted = await migrationInput({ ...channelSettings(current), ...input, provider: id }, current)
        next = await service().configure(adapted)
        doc.style = style
      }
      await store.updateJson(path, value => {
        const latest = document(value || {})
        const providers = { ...latest.providers }
        if (!next.migrationPending) { delete providers[id]; if (latest.provider === 'dsh-image-gen') delete providers['dsh-image-gen'] }
        return { ...latest, version: 4, provider: id, providers, style: doc.style,
          enabled: input.enabled ?? doc.enabled }
      })
      return read()
    }),
    testConnection: input => serial(async () => { const current = await read(input?.provider); return service().test(await migrationInput({ ...channelSettings(current), ...input, provider: current.provider }, current)) }),
    listModels: input => serial(async () => { const current = await read(input?.provider); return service().models(await migrationInput({ ...channelSettings(current), ...input, provider: current.provider }, current)) }),
  }
}
