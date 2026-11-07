// configurable OpenAI speech endpoints; discovery never synthesizes.
import { presetParams } from './params.js'

export function createOpenAICompatibleAdapter({ fetch: fetchImpl = globalThis.fetch } = {}) {
  async function request(provider, secret, path, options = {}) {
    let response
    try {
      response = await fetchImpl(new URL(path, provider.config.url + '/').href, {
        ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(10000),
        headers: { ...(secret.key ? { Authorization: 'Bearer ' + secret.key } : {}), ...options.headers },
      })
    } catch { throw new Error('语音服务未连接或请求超时') }
    // Do not expose response bodies, URLs or fetch errors: they may contain credentials.
    if (!response.ok) throw Object.assign(new Error('语音服务请求失败（HTTP ' + response.status + '）'), {status:response.status})
    return response
  }
  async function listing(provider, secret, path, key) {
    if (!path) return []
    const response = await request(provider, secret, path)
    let body
    try { body = await response.json() } catch { throw new Error('语音服务返回的列表无效') }
    const rows = Array.isArray(body) ? body : body?.data || body?.[key]
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('语音服务返回的列表无效')
    return rows.map(row => {
      const id = typeof row === 'string' ? row : row?.id || row?.voice_id
      if (typeof id !== 'string' || !id.trim() || id.length > 160 || /[\r\n]/.test(id)) throw new Error('语音服务返回的列表无效')
      return { id, label: typeof row.name === 'string' ? row.name.slice(0,160) : id,
        ...(key === 'voices' ? { languages: Array.isArray(row.languages) ? row.languages.filter(l => ['zh','en','ja','ko','yue'].includes(l)) : ['zh','en','ja'] } : {}) }
    })
  }
  // explicit 测试连接 without list paths. Free first: GET /v1/models on the same
  // origin answers auth; only when that route is missing, one tiny synthesis (a single character) checks the key.
  async function status(provider, secret, path, options = {}) {
    try {
      const response = await fetchImpl(new URL(path, provider.config.url + '/').href, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { ...(secret.key ? { Authorization: 'Bearer ' + secret.key } : {}), ...options.headers } })
      await response.body?.cancel?.().catch(() => {})
      return response.status
    } catch { throw new Error('连不上服务，请检查服务地址') }
  }
  const denied = code => code === 401 || code === 403
  return {
    async verify(provider, secret) {
      const listed = await status(provider, secret, '/v1/models')
      if (listed >= 200 && listed < 300) return { status: 'connected' }
      if (denied(listed)) throw new Error('密钥无效（HTTP ' + listed + '）')
      const spoken = await status(provider, secret, provider.config.speechPath, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: '嗯', response_format: 'wav' }) })
      if (spoken >= 200 && spoken < 300) return { status: 'connected', synthesisTested: true }
      if (denied(spoken)) throw new Error('密钥无效（HTTP ' + spoken + '）')
      if (spoken === 404 || spoken === 405) throw new Error('找不到合成接口，请检查服务地址和合成路径（HTTP ' + spoken + '）')
      if (spoken === 400 || spoken === 422) return { status: 'reachable', message: '服务能连上；默认模型不可用，在声音预设里选模型和音色', synthesisTested: true }
      throw new Error('服务返回错误（HTTP ' + spoken + '）')
    },
    async catalog() { return { items: [] } },
    async voices(provider, secret) {
      const [models, voices] = await Promise.all([
        listing(provider, secret, provider.config.modelsPath, 'models'),
        listing(provider, secret, provider.config.voicesPath, 'voices'),
      ])
      return { models, voices, source: provider.config.modelsPath || provider.config.voicesPath ? 'live' : 'manual' }
    },
    async synthesize(provider, secret, spec) {
      const params = presetParams('openai-compatible', spec.params)
      const response = await request(provider, secret, provider.config.speechPath, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([AbortSignal.timeout(45000), ...(spec.signal ? [spec.signal] : [])]),
        body: JSON.stringify({ ...params, input: spec.text, response_format: 'wav' }),
      })
      return Buffer.from(await response.arrayBuffer())
    },
  }
}
