import { channelSettings, channelNeedsKey, channelReady, imageCredentialRef, SCENE_IMAGE_CHANNELS } from './tavern/scene-image-channels.js'
import { createSceneImageConnection } from './tavern/scene-image-connection.js'
import { generateSceneImage } from './tavern/scene-image-provider.js'

// Same fields and credentials as the original plugin UI. Remaining providers
// live in one plugin-owned extra-settings field, not in Tavern's sidecar.
const mapped = {
  openai: ['openai', 'openaiBaseURL', 'openaiModel', 'OPENAI_API_KEY', ''],
  grok: ['grok', 'grokBaseURL', 'grokModel', 'XAI_API_KEY', ''],
  gemini: ['google', 'googleEndpoint', 'googleModel', 'GEMINI_API_KEY', '/interactions'],
  seedream: ['seedream', 'seedreamBaseURL', 'seedreamModel', 'ARK_API_KEY', ''],
  qwen: ['dashscope', 'dashscopeEndpoint', 'dashscopeModel', 'DASHSCOPE_API_KEY', ''],
}
export const configurationServiceName = 'tavernImageConfiguration'
const ids = new Set(SCENE_IMAGE_CHANNELS.filter(x => x.id !== 'dsh-image-gen').map(x => x.id))
function providerId(id) { if (!ids.has(id)) throw new Error('未知生图提供商'); return id }
function extras(value) { try { const data = JSON.parse(value.tavernChannels || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {} } catch { throw new Error('插件渠道配置损坏，请检查设置') } }
function ref(id, authType) { return mapped[id]?.[3] || imageCredentialRef(id, authType) }
function endpoint(value) { return value?.replace(/\/+$/, '') || '' }
function readChannel(value, id) {
  providerId(id)
  const data = { ...extras(value)[id] }
  const map = mapped[id]
  if (map) {
    if (value[map[1]] !== undefined) data.baseURL = map[4] && value[map[1]].endsWith(map[4]) ? value[map[1]].slice(0, -map[4].length) : value[map[1]]
    if (value[map[2]] !== undefined) data.model = value[map[2]]
  }
  return channelSettings(data, id)
}

/** A private in-process interface: secrets never cross the Studio HTTP route. */
export function createImageConfiguration({ read, write, credentials, attachments, fetchImpl = fetch }) {
  let pending = Promise.resolve()
  /** @template T @param {() => T | Promise<T>} fn @returns {Promise<T>} */
  function serial(fn) { const result = pending.then(fn); pending = result.catch(() => {}); return result }
  async function inspect(id) {
    const value = read()
    if (!id || id === 'dsh-image-gen') id = Object.keys(mapped).find(id => mapped[id][0] === value.provider) || 'openai'
    const config = readChannel(value, id)
    const key = channelNeedsKey(config) ? await credentials.resolve(ref(id, config.authType)) : undefined
    return { ...config, backend: 'dsh-image-gen', hasKey: Boolean(key?.value), ready: channelReady(config, key?.value),
      configured: Object.hasOwn(extras(value), id) || Boolean(key?.value), channels: SCENE_IMAGE_CHANNELS.filter(x => ids.has(x.id)) }
  }
  async function save(input) {
    const id = providerId(input.provider), before = read(), current = readChannel(before, id)
    const next = channelSettings({ ...current, ...input }, id)
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('API Key 必须是文本')
    const supplied = next.authType === 'basic' ? input.apiKey : input.apiKey?.trim()
    if (supplied && /[\r\n]/.test(supplied)) throw new Error('鉴权信息格式不正确')
    const keyRef = ref(id, next.authType), previousKey = await credentials.resolve(keyRef)
    const identityChanged = endpoint(next.baseURL) !== endpoint(current.baseURL) || next.authType !== current.authType || next.username !== current.username
    if (channelNeedsKey(next) && previousKey?.value && identityChanged && !supplied) throw new Error('地址或鉴权身份已修改，请重新填写 API Key；旧密钥不会发送到新地址')
    const additional = { ...next }; delete additional.provider
    const patch = { tavernChannels: '' }, map = mapped[id]
    if (map) {
      patch.provider = map[0]; patch[map[1]] = endpoint(next.baseURL) + map[4]; patch[map[2]] = next.model
      delete additional.baseURL; delete additional.model
    }
    patch.tavernChannels = JSON.stringify({ ...extras(before), [id]: additional })
    // No write of a key occurs until settings validation/persistence succeeds.
    // Snapshot capture and validation share this queue, not image HTTP or storage.
    await write(patch)
    try { if (supplied && channelNeedsKey(next)) await credentials.set(keyRef, supplied) }
    catch (error) {
      await write(Object.fromEntries(Object.keys(patch).map(key => [key, before[key] ?? (key === 'tavernChannels' ? '{}' : '')])))
      throw new Error('密钥保存失败，配置已回滚；请重试')
    }
    return inspect(id)
  }
  const connection = createSceneImageConnection({ settings: inspect, credentials: () => ({ resolve: oldRef => {
    // The original probe code addresses channel refs. Translate to plugin refs.
    const id = [...ids].find(id => imageCredentialRef(id) === oldRef)
    return credentials.resolve(id && mapped[id] ? mapped[id][3] : oldRef)
  } }), fetchImpl })
  return {
    serial,
    inspect: id => serial(() => inspect(id)),
    configure: input => serial(() => save(input)),
    capture: id => serial(async () => { const active = await inspect(id); const key = channelNeedsKey(active) ? await credentials.resolve(ref(active.provider, active.authType)) : undefined; return { active, apiKey: key?.value || '' } }),
    test: input => serial(() => connection.test(input)),
    models: input => serial(() => connection.models(input)),
    generate: async input => {
      const request = await serial(async () => {
        input.signal?.throwIfAborted()
        const current = await inspect(input.provider)
        const fields = ['baseURL', 'model', 'size', 'aspectRatio', 'authType', 'username']
        if (fields.some(key => current[key] !== input[key]) || current.workflow?.digest !== input.workflow?.digest) throw Object.assign(new Error('生图配置已变化，请重新整理画面；未请求生图'), { imageOutcome: 'not_requested' })
        // Keep the captured endpoint/key pair. Later saves only affect new jobs.
        if (!channelReady(input, input.apiKey)) throw Object.assign(new Error('请先完成生图配置'), { imageOutcome: 'not_requested' })
        return { ...input, ...structuredClone(channelSettings(input)) }
      })
      request.signal?.throwIfAborted()
      const generated = await generateSceneImage(request, fetchImpl === globalThis.fetch ? {} : { fetch: fetchImpl })
      // Always hand received bytes back to Tavern's durable save/recovery flow.
      // A local attachment failure must never turn into another paid generation.
      try {
        const attachment = await attachments.saveImage({ data: generated.data, mediaType: generated.mediaType, name: 'scene-image' })
        return { ...generated, attachment }
      } catch { return generated }
    },
  }
}
