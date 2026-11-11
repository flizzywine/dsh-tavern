// 自定义语音服务: one adapter for any HTTP TTS API, driven only by the saved connection (http-config.js); the presets
// (OpenAI 兼容, 火山方舟 Agent Plan) are values of the same fields. Discovery never synthesizes; a response body, URL or
// key never reaches an error message (they may carry credentials). Responses are bounded by boundedFetch (32 MB).
import { randomUUID } from 'node:crypto'
import { presetParams } from './params.js'
import { httpConfig, parseHeaders, fillTemplate, pick } from './http-config.js'
import { pcmWav } from './audio.js'
import volcengineSpeakers from '../shared/volcengine-speakers.json' with { type: 'json' }

const CATALOGS = { volcengine: volcengineSpeakers }
const failure = (message, extra = {}) => Object.assign(new Error(message), extra)
const httpFailure = status => status === 401 || status === 403
  ? failure('API Key 无效或无权访问（HTTP ' + status + '）', { code: 'PROVIDER_AUTH_FAILED', status })
  : failure('语音服务请求失败（HTTP ' + status + '）', { status })
const base64 = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(value)) throw failure('语音服务返回的音频无效')
  return Buffer.from(value, 'base64')
}

export function createOpenAICompatibleAdapter({ fetch: fetchImpl = globalThis.fetch } = {}) {
  // `{{key}}` is the saved API Key; a header that needs it is left out when there is none (a keyless local server).
  function headers(c, secret, requestId) {
    const result = {}
    for (const [name, value] of parseHeaders(c.headers)) {
      if (/\{\{\s*key\s*\}\}/.test(value) && !secret.key) continue
      result[name] = value.replace(/\{\{\s*(key|requestId)\s*\}\}/g, (_, p) => p === 'key' ? secret.key : requestId)
    }
    return result
  }
  async function send(c, secret, path, { method = 'GET', payload, signal, timeoutSec = 15 } = {}) {
    const requestId = randomUUID(), url = new URL(path, c.url + '/')
    if (payload && method === 'GET') for (const [k, v] of Object.entries(payload)) if (v !== null && typeof v !== 'object') url.searchParams.set(k, String(v))
    const body = payload && method !== 'GET' ? JSON.stringify(payload) : undefined
    try {
      return await fetchImpl(url.href, { method, redirect: 'error', body,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers(c, secret, requestId) },
        signal: AbortSignal.any([AbortSignal.timeout(timeoutSec * 1000), ...(signal ? [signal] : [])]) })
    } catch (error) { throw signal?.aborted ? failure('已取消', { code: 'ABORTED' }) : error?.code === 'INVALID_AUDIO' ? error : failure('语音服务未连接或请求超时') }
  }
  // A status field outside the success (and end) values is the service refusing: its value, never its message text.
  function refused(c, chunk) {
    if (!c.statusPath) return false
    const status = String(pick(chunk, c.statusPath))
    if (c.endValues.split(',').includes(status)) return 'end'
    if (c.okValues && !c.okValues.split(',').includes(status)) throw failure('语音服务拒绝了请求（' + c.statusPath + ' = ' + status.slice(0, 40) + '）')
    return false
  }
  function audio(c, bytes) {
    if (c.audioFormat === 'pcm') { if (!bytes.length) throw failure('语音服务没有返回音频'); return pcmWav(bytes, c.sampleRate) }
    return bytes
  }
  async function decode(c, response) {
    if (c.responseMode === 'audio') return audio(c, Buffer.from(await response.arrayBuffer()))
    const text = await response.text()
    if (c.responseMode === 'json') {
      let body
      try { body = JSON.parse(text) } catch { throw failure('语音服务返回的不是 JSON') }
      refused(c, body)
      return audio(c, base64(pick(body, c.audioPath)))
    }
    // lines: Server-Sent Events or one JSON object per line, each with a piece of base64 audio.
    const chunks = []; let ended = !c.endValues
    for (let line of text.split(/\r?\n/)) {
      line = line.trim()
      if (!line || line.startsWith(':') || /^(event|id|retry):/.test(line)) continue
      if (line.startsWith('data:')) line = line.slice(5).trim()
      if (!line) continue
      if (line === '[DONE]') { ended = true; break }
      let chunk
      try { chunk = JSON.parse(line) } catch { throw failure('语音服务返回的流式数据无效') }
      if (refused(c, chunk) === 'end') { ended = true; break }
      const piece = pick(chunk, c.audioPath)
      if (piece) chunks.push(base64(piece))
    }
    if (!ended) throw failure('语音服务的音频没有传完')
    return audio(c, Buffer.concat(chunks))
  }
  async function listing(c, secret, path, listPath, key) {
    if (!path) return []
    const response = await send(c, secret, path, { timeoutSec: Math.min(c.timeoutSec, 15) })
    if (!response.ok) throw httpFailure(response.status)
    let body
    try { body = await response.json() } catch { throw failure('语音服务返回的列表无效') }
    const rows = listPath ? pick(body, listPath) : Array.isArray(body) ? body : body?.data || body?.[key]
    if (!Array.isArray(rows) || rows.length > 10000) throw failure('语音服务返回的列表无效')
    return rows.map(row => {
      const id = typeof row === 'string' ? row : row?.id || row?.voice_id
      if (typeof id !== 'string' || !id.trim() || id.length > 160 || /[\r\n]/.test(id)) throw failure('语音服务返回的列表无效')
      return { id, label: typeof row.name === 'string' ? row.name.slice(0, 160) : id,
        ...(key === 'voices' ? { languages: Array.isArray(row.languages) ? row.languages.filter(l => ['zh', 'en', 'ja', 'ko', 'yue'].includes(l)) : ['zh', 'en', 'ja'] } : {}) }
    })
  }
  function request(provider, secret, spec) {
    const c = httpConfig(provider.config), params = presetParams('openai-compatible', spec.params)
    const payload = fillTemplate(c.body, { text: spec.text, voice: params.voice, model: params.model, speed: params.speed, format: c.audioFormat,
      language: spec.language, instructions: params.instructions, requestId: randomUUID() })
    return { c, response: send(c, secret, c.speechPath, { method: c.method, payload, signal: spec.signal, timeoutSec: c.timeoutSec }) }
  }
  const builtin = c => structuredClone(CATALOGS[c.voiceCatalog] || [])
  return {
    // 测试: the free GET first; without one (or when it is missing), one tiny synthesis checks the key.
    async verify(provider, secret) {
      const c = httpConfig(provider.config)
      if (c.testPath) {
        const listed = await send(c, secret, c.testPath).catch(() => { throw failure('连不上服务，请检查 Base URL') })
        await listed.body?.cancel?.().catch(() => {})
        if (listed.ok) return { status: 'connected' }
        if (listed.status === 401 || listed.status === 403) throw failure('API Key 无效（HTTP ' + listed.status + '）', { code: 'PROVIDER_AUTH_FAILED' })
      }
      const voice = c.testVoice || builtin(c)[0]?.id || 'test'
      const { response: pending } = request(provider, secret, { text: '嗯', language: 'zh', params: { voice } })
      const response = await pending.catch(() => { throw failure('连不上服务，请检查 Base URL') })
      if (response.status === 401 || response.status === 403) throw failure('API Key 无效（HTTP ' + response.status + '）', { code: 'PROVIDER_AUTH_FAILED' })
      if (response.status === 404 || response.status === 405) throw failure('找不到合成接口，请检查 Base URL 和合成路径（HTTP ' + response.status + '）')
      if (response.status === 400 || response.status === 422) return { status: 'reachable', message: '服务能连上；测试音色不可用，在人物声音里选模型和音色', synthesisTested: true }
      if (!response.ok) throw failure('服务返回错误（HTTP ' + response.status + '）')
      await decode(c, response)
      return { status: 'connected', synthesisTested: true }
    },
    async catalog(provider) { return { items: builtin(httpConfig(provider.config)) } },
    async voices(provider, secret) {
      const c = httpConfig(provider.config)
      const [models, listed] = await Promise.all([listing(c, secret, c.modelsPath, c.modelsListPath, 'models'), listing(c, secret, c.voicesPath, c.voicesListPath, 'voices')])
      const voices = c.voicesPath ? listed : builtin(c)
      return { models, voices, source: c.modelsPath || c.voicesPath ? 'live' : c.voiceCatalog ? 'builtin' : 'manual' }
    },
    async synthesize(provider, secret, spec) {
      const { c, response: pending } = request(provider, secret, spec), response = await pending
      if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw httpFailure(response.status) }
      return decode(c, response)
    },
  }
}
