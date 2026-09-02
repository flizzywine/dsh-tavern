// Test-only adapter for the retained standalone upstream Studio contract.
// Tavern production calls the internal module directly; it never imports this.
const route = '/plugins/dsh-image-gen/studio'
const unavailable = '内置 dsh-image-gen 工作台未就绪；请确认已更新安装并重启 Tavern，再到设置 → 插件 → Image generation 配置云端生图。'

export function createSceneImagePlugin({ webServer, attachments, fetchImpl = globalThis.fetch }) {
  async function request(body, signal) {
    const port = webServer?.()?.port
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(unavailable)
    const timeout = AbortSignal.timeout(body ? 300000 : 5000)
    const response = await fetchImpl(`http://127.0.0.1:${port}${route}`, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(response.status === 404 ? unavailable : `dsh-image-gen 接口失败（HTTP ${response.status}）；请检查插件配置和日志。`)
    }
    let bytes = 0
    const chunks = []
    for await (const chunk of response.body || []) {
      bytes += chunk.length
      if (bytes > 256 * 1024) throw new Error('dsh-image-gen 返回数据过大')
      chunks.push(Buffer.from(chunk))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new Error(unavailable) }
  }
  async function inspect(signal) {
    const data = await request(undefined, signal)
    const profile = Array.isArray(data.providers) ? data.providers.find(item => item?.provider === data.activeProvider) : undefined
    // The installed plugin owns provider support; new adapters need no Tavern protocol changes.
    if (!profile || typeof profile.provider !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(profile.provider) || typeof profile.model !== 'string' || !profile.model.trim()
      || !profile.ratioOptions?.some(item => item.value === profile.defaultRatio)
      || !profile.qualityOptions?.some(item => item.value === profile.defaultQuality)) throw new Error('dsh-image-gen 工作台配置无效或版本不兼容')
    return { pluginReady: profile.configured === true, pluginProvider: profile.provider, model: profile.model,
      aspectRatio: profile.defaultRatio, size: profile.defaultQuality }
  }
  async function resolve(config) {
    if (config.provider !== 'dsh-image-gen') return config
    try { return { ...config, ...await inspect() } }
    catch { return { ...config, pluginReady: false, pluginError: unavailable } }
  }
  async function generate(input) {
    if (input.referenceImages?.length) throw new Error('插件最小接入仅支持文生图，暂不支持参考图')
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.trim().length > 2000) throw new Error('dsh-image-gen 工作台提示词限 2000 字符，请精简画面方案；未请求生图')
    const current = await inspect(input.signal)
    if (!current.pluginReady) throw new Error('请先在 dsh-image-gen 插件设置中配置 API Key')
    if (['pluginProvider', 'model', 'aspectRatio', 'size'].some(key => current[key] !== input[key])) throw new Error('插件生图配置已变化，请重新整理画面后重试；未请求生图')
    const result = await request({ mode: 'generate', provider: current.pluginProvider, model: current.model,
      prompt: input.prompt.trim(), ratio: current.aspectRatio, quality: current.size }, input.signal)
    if (result.provider !== current.pluginProvider || result.model !== current.model || !result.attachment?.attachmentId) throw new Error('dsh-image-gen 未返回匹配的图片附件')
    const image = await attachments().readImage(result.attachment, input.signal)
    const data = Buffer.from(image.data)
    const mediaType = image.mediaType || image.ref?.mediaType
    if (!data.length || data.length > (input.maxBytes || 20 * 1024 * 1024) || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) throw new Error('插件图片为空、过大或格式不支持')
    return { data, mediaType, attachment: result.attachment, metadata: { provider: current.pluginProvider, model: current.model, backend: 'dsh-image-gen' } }
  }
  return { resolve, generate }
}
