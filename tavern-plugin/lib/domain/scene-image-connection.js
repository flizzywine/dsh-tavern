import { sceneImageChannel, imageCredentialRef, SCENE_IMAGE_CHANNELS } from './scene-image-channels.js'

const MAX_BYTES = 256 * 1024

function endpoint(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('请填写 API 根地址')
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('请填写有效的 HTTP(S) API 根地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 根地址不能包含密钥、查询参数或账号密码')
  return url.href.replace(/\/+$/, '')
}

async function limitedJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('模型列表过大，请手动填写模型')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('服务没有返回模型列表，请手动填写模型')
  let size = 0
  const chunks = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error('模型列表过大，请手动填写模型')
      chunks.push(Buffer.from(value))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('服务未返回有效模型列表，请手动填写模型') }
  } finally { await reader.cancel().catch(() => {}) }
}

/** Read-only setup checks. No generation, settings writes, or redirect following. */
export function createSceneImageConnection({ settings, credentials, fetchImpl = fetch, timeoutMs = 5000 }) {
  async function request(input = {}, listModels = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('连接配置必须是对象')
    const channel = sceneImageChannel(input.provider)
    const current = await settings(channel.id)
    const baseURL = endpoint(input.baseURL ?? current.baseURL)
    const authType = ['webui', 'comfyui'].includes(channel.id) ? (input.authType ?? current.authType) : 'bearer'
    if (!['none', 'basic', 'bearer'].includes(authType)) throw new Error('请选择有效的鉴权方式')
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('API Key 必须是文本')
    let apiKey = authType === 'basic' ? input.apiKey || '' : input.apiKey?.trim() || ''
    // Never send an existing secret to an edited endpoint or a different identity.
    const username = String(input.username ?? current.username ?? '')
    const sameEndpoint = current.baseURL && baseURL === endpoint(current.baseURL)
    if (!apiKey && authType !== 'none' && sameEndpoint && authType === (current.authType || 'bearer') && username === (current.username || '')) {
      apiKey = (await credentials()?.resolve(imageCredentialRef(channel.id, authType)))?.value || ''
    }
    if (!apiKey && authType !== 'none' && current.hasKey && !sameEndpoint) throw new Error('地址已修改，请重新填写 API Key 后测试，旧密钥不会发送到新地址')
    if (/[\r\n]/.test(apiKey) || /[:\r\n]/.test(username)) throw new Error('鉴权信息格式不正确')
    if (listModels && !SCENE_IMAGE_CHANNELS.find(item => item.id === channel.id).canListModels) return { models: [], message: '此渠道暂不支持自动获取模型，请使用预设或手动填写。' }
    const headers = { accept: 'application/json' }
    if (apiKey && authType !== 'none') {
      if (authType === 'basic') headers.authorization = 'Basic ' + Buffer.from(username + ':' + apiKey).toString('base64')
      else if (channel.id === 'gemini') headers['x-goog-api-key'] = apiKey
      else headers.authorization = 'Bearer ' + apiKey
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(listModels ? baseURL + '/models' : baseURL + '/', {
        method: listModels ? 'GET' : 'HEAD', headers, redirect: 'manual', signal: controller.signal
      })
      const httpStatus = response.status
      if ([401, 403].includes(httpStatus)) return { status: 'auth_failed', httpStatus, models: [], message: '服务已响应，但鉴权被拒绝，请检查 API Key 或访问权限。' }
      if (!listModels) return {
        status: response.ok ? 'connected' : 'reachable', httpStatus,
        message: response.ok ? '连接成功。仅确认服务可达，未验证模型或生图能力。'
          : `网络已连通（HTTP ${httpStatus}）。服务返回非成功状态；未验证密钥或生图能力。`
      }
      if (!response.ok) return { models: [], httpStatus, message: `模型列表获取失败（HTTP ${httpStatus}），可手动填写模型。` }
      const payload = await limitedJson(response)
      const entries = channel.id === 'gemini' ? payload.models : payload.data
      if (!Array.isArray(entries)) throw new Error('服务未返回有效模型列表，请手动填写模型')
      const models = [...new Set(entries.map(item => channel.id === 'gemini' ? item?.name?.replace(/^models\//, '') : item?.id)
        .filter(id => typeof id === 'string' && id.trim() && id.length <= 200 && !/[\u0000-\u001f]/.test(id) && (!apiKey || !id.includes(apiKey))))].slice(0, 500)
      return { models, message: models.length ? '已获取模型列表。列表不保证每个模型支持生图，请选择图片模型。' : '没有获取到模型，可手动填写。' }
    } catch (error) {
      if (controller.signal.aborted) return { status: 'failed', models: [], message: '连接超时（5 秒），请检查地址或网络。' }
      // Provider response bodies and transport exceptions may contain secrets.
      return { status: 'failed', models: [], message: response ? '模型列表读取失败，可手动填写模型。' : '连接失败，请检查地址、网络或 HTTPS 证书。' }
    } finally {
      clearTimeout(timer)
      await response?.body?.cancel().catch(() => {})
    }
  }
  return { test: input => request(input), models: input => request(input, true) }
}
