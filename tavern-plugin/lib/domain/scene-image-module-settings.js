import { channelSettings, imageCredentialRef, channelNeedsKey } from './scene-image-channels.js'
import { imageStyleSettings, SCENE_STYLE_PRESETS } from './scene-image-style.js'

import { createHash } from 'node:crypto'

const path = 'scene-images/settings.json'
// NovelAI artist-library previews: small images Tavern keeps beside its own
// settings, keyed by entry id. The image module only stores their revision.
const PREVIEW_DIR = 'scene-images/artist-previews/'
const PREVIEW_MAX_BYTES = 512 * 1024
const PREVIEW_ID = /^[a-z0-9]{1,12}$/
function previewMediaType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return ''
}
function previewBytes(value) {
  const text = typeof value === 'string' ? value.replace(/^data:image\/[\w.+-]+;base64,/, '') : ''
  if (!text || text.length > Math.ceil(PREVIEW_MAX_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('画师串预览图须为不超过 512 KB 的图片')
  const data = Buffer.from(text, 'base64')
  if (data.length > PREVIEW_MAX_BYTES || !previewMediaType(data)) throw new Error('画师串预览图须为不超过 512 KB 的 PNG、JPEG 或 WebP 图片')
  return data
}
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
      if (input.enabled === true && (changesProvider || edits || !current.ready)) throw new Error('请先保存完整生图配置（渠道、模型和 API Key），再开启场景生图')
      let next = current
      if (edits) {
        const style = imageStyleSettings({ ...doc.style, ...input.style })
        // New preview images arrive inline; only their revision goes to the image module,
        // and the bytes are written once the settings themselves have been accepted.
        const uploads = new Map()
        if (Array.isArray(input.artists)) input = { ...input, artists: input.artists.map(entry => {
          if (!entry || typeof entry !== 'object' || entry.previewData === undefined) return entry
          const { previewData, ...rest } = entry
          if (typeof rest.id !== 'string' || !PREVIEW_ID.test(rest.id)) throw new Error('画师串格式不正确')
          if (!previewData) return { ...rest, preview: '' }
          const data = previewBytes(previewData)
          uploads.set(rest.id, data)
          return { ...rest, preview: createHash('sha256').update(data).digest('hex').slice(0, 12) }
        }) }
        if (uploads.size && typeof store.writeBytes !== 'function') throw new Error('当前存储不支持保存预览图')
        const adapted = await migrationInput({ ...channelSettings(current), ...input, provider: id }, current)
        next = await service().configure(adapted)
        doc.style = style
        for (const [artist, data] of uploads) await store.writeBytes(PREVIEW_DIR + artist, data)
        // Drop previews of removed entries or entries whose preview was cleared.
        const kept = new Set((next.artists || []).filter(entry => entry.preview).map(entry => entry.id))
        for (const entry of current.artists || []) if (entry.preview && !kept.has(entry.id)) await store.remove(PREVIEW_DIR + entry.id).catch(() => {})
      }
      await store.updateJson(path, value => {
        const latest = document(value || {})
        const providers = { ...latest.providers }
        if (!next.migrationPending) { delete providers[id]; if (latest.provider === 'dsh-image-gen') delete providers['dsh-image-gen'] }
        return { ...latest, version: 4, provider: id, providers, style: doc.style,
          // A switch left on cannot outlive the configuration it was turned on for.
          enabled: (input.enabled ?? doc.enabled) && Boolean(next.ready) }
      })
      return read()
    }),
    readArtistPreview: async id => {
      if (typeof id !== 'string' || !PREVIEW_ID.test(id) || typeof store.readBytes !== 'function') throw new Error('预览图不存在')
      const data = await store.readBytes(PREVIEW_DIR + id)
      if (!data?.length) throw new Error('预览图不存在')
      return { data, mediaType: previewMediaType(data) || 'application/octet-stream' }
    },
    testConnection: input => serial(async () => { const current = await read(input?.provider); return service().test(await migrationInput({ ...channelSettings(current), ...input, provider: current.provider }, current)) }),
    listModels: input => serial(async () => { const current = await read(input?.provider); return service().models(await migrationInput({ ...channelSettings(current), ...input, provider: current.provider }, current)) }),
  }
}
