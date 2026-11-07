import { presetParams, presetMood } from './params.js'
import { TtsError } from '../core.js'
import { qwenWav } from './qwen-audio.js'
import { BUILTIN_PRESETS } from './presets.js'
import QWEN_VOICES from '../shared/qwen-voices.json' with { type: 'json' }

// system voices from the official list (help.aliyun.com/zh/model-studio/qwen-tts-voice-list).
// Names containing spaces (Eldric Sage, Ono Anna, Radio Gol) are omitted: the voice validator rejects them.
const QWEN_LANGUAGES = ['zh', 'en', 'fr', 'de', 'ru', 'it', 'es', 'pt', 'ja', 'ko']
// Only offer the verified Bella-compatible model; saved instruct presets remain readable.
export const QWEN_MODELS = Object.freeze([{ id: 'qwen3-tts-flash', label: 'Qwen3-TTS Flash', instruct: false }])
export const qwenVoices = () => QWEN_VOICES.map(v => ({ ...v, languages: [...QWEN_LANGUAGES] }))
// Capability metadata for saved presets is independent of the recommended model list.
export function qwenModelInstructions(model) {
  return /^qwen3-tts-(?:instruct-)?flash(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ? model.includes('instruct') : null
}

export const QWEN_MOODS = Object.freeze({}) // styles belong to voice declarations.
export function qwenMood(spec) {
  if (!/instruct/.test(spec.params.model || '')) return null
  return Object.hasOwn(spec.params,'moodInstruction') ? spec.params.moodInstruction : presetMood(QWEN_MOODS, spec)
}
// The preset's base style (if any) precedes the mood instruction; both only for instruct models.
export function qwenInstructions(spec) {
  if (!/instruct/.test(spec.params.model || '')) return null
  return [spec.params.instructions, qwenMood(spec)].filter(Boolean).join('；') || null
}

export function createQwenAdapter({ fetch: fetchImpl = globalThis.fetch, warn = console.warn } = {}) {
  function failure(status, body = {}, phase = 'synthesis') {
    // Only status and a bounded provider code are diagnostic; never echo its message, URL or request.
    const upstream = typeof body?.code === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(body.code) ? body.code : 'Unknown';
    const code = /Arrearage|Unpurchased|FreeTier|QuotaExhausted|InsufficientBalance/i.test(upstream) || status === 402 ? 'QWEN_BILLING_REQUIRED'
      : status === 401 || /InvalidApiKey|InvalidAccessKey/i.test(upstream) ? 'QWEN_AUTH_FAILED'
      : status === 429 ? 'QWEN_RATE_LIMITED' : status === 403 ? 'QWEN_ACCESS_DENIED'
      : status === 400 && phase === 'synthesis' && upstream === 'InvalidParameter' &&
        typeof body.message === 'string' && /^voice\b.{0,160}\b(?:is not supported|is unsupported)\b.{0,160}\bmodel\b.{0,160}$/i.test(body.message) ? 'QWEN_VOICE_UNSUPPORTED'
      : status === 400 && phase === 'synthesis' && upstream === 'InvalidParameter' && body.message === 'Due to invalid text, invalid audio was returned.' ? 'QWEN_INVALID_TEXT'
      : status === 404 ? phase === 'audio' ? 'QWEN_AUDIO_NOT_FOUND'
        : upstream === 'InvalidParameter' && body.message === 'Model not exist.' ? 'QWEN_MODEL_NOT_FOUND' : 'QWEN_RESOURCE_NOT_FOUND' : 'QWEN_REQUEST_FAILED';
    warn('[dsh-tts:qwen] HTTP ' + status + ' phase=' + phase + ' code=' + upstream + ' category=' + code);
    const error = new TtsError(code, status);
    error.message = {QWEN_INVALID_TEXT:'Qwen 文本没有可朗读内容或被服务拒绝，请修改台词后重播',QWEN_MODEL_NOT_FOUND:'Qwen 当前服务无法访问此配音模型（404），请在百炼控制台检查模型开通状态与区域',QWEN_AUDIO_NOT_FOUND:'Qwen 合成音频下载失败（404），请重试',QWEN_RESOURCE_NOT_FOUND:'Qwen 语音服务资源不存在（404），请检查区域、模型与音色',QWEN_BILLING_REQUIRED:'Qwen 配音额度或账户余额不足，请检查阿里云用量与账单',QWEN_AUTH_FAILED:'Qwen API 密钥无效',QWEN_RATE_LIMITED:'Qwen 语音请求过于频繁或达到限额',QWEN_ACCESS_DENIED:'Qwen 配音访问被拒绝，请检查模型权限与账户状态'}[code] || 'Qwen 语音服务请求失败（' + status + '）';
    throw error;
  }
  async function request(url, options, phase = 'synthesis') {
    let response
    try { response = await fetchImpl(url, { ...options, redirect: 'error' }) } catch {
      const error = new TtsError(options.signal?.aborted ? options.signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED' : 'SERVICE_OFFLINE');
      error.message = 'Qwen 语音连接失败或请求超时'; throw error;
    }
    if (!response.ok) failure(response.status, await response.json().catch(() => ({})), phase);
    return response
  }
  return {
    async catalog() { return { items: structuredClone(BUILTIN_PRESETS.filter(p => p.kind === 'qwen')).map(p => ({ ...p, state: 'ready' })) } },
    // Base voices for the preset editor; the catalogue above stays the card-picker list.
    async voices(provider, secret = {}) {
      if (!secret.key) return { voices:qwenVoices(), models:structuredClone(QWEN_MODELS), source:'builtin' }
      const host = provider.config.region === 'intl' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com'
      const response = await request('https://' + host + '/compatible-mode/v1/models', { method:'GET', headers:{...(secret.key ? {Authorization:'Bearer ' + secret.key} : {})}, signal:AbortSignal.timeout(10000) }, 'discovery')
      let body
      try { body = await response.json() } catch { throw new Error('Qwen 模型列表无效') }
      if (!Array.isArray(body?.data)) throw new Error('Qwen 模型列表无效')
      // Qwen-Audio uses SpeechSynthesizer and a different voice list (Bella is rejected).
      // Do not offer it through this Qwen3 transport, or reintroduce the unavailable instruct model.
      const models = body.data.filter(m => typeof m?.id === 'string' && /^qwen3-tts-flash(?:-\d{4}-\d{2}-\d{2})?$/.test(m.id)).map(m => ({id:m.id,label:m.id,instruct:false}))
      // Some regional model-list APIs omit TTS; keep the verified base model available.
      return { voices:qwenVoices(), models:models.length ? models : structuredClone(QWEN_MODELS), source:'builtin', modelSource:models.length ? 'live' : 'builtin' }
    },
    // Unbilled key check: the OpenAI-compatible model listing requires a valid key.
    async probe(provider, secret) {
      const host = provider.config.region === 'intl' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com'
      await request('https://' + host + '/compatible-mode/v1/models', { method: 'GET', headers: { ...(secret.key ? {Authorization: 'Bearer ' + secret.key} : {}) }, signal: AbortSignal.timeout(10000) }, 'discovery')
    },
    async synthesize(provider, secret, spec) {
      // Punctuation-only pauses (for example an ellipsis) are not speech; avoid a paid API request.
      if (!/[\p{L}\p{N}]/u.test(spec.text)) throw new TtsError('QWEN_INVALID_TEXT', 400)
      const params = presetParams('qwen', spec.params), { voice, model } = params
      const instructions = qwenInstructions({ ...spec, params })
      const signal = AbortSignal.any([AbortSignal.timeout(45000), ...(spec.signal ? [spec.signal] : [])])
      const host = provider.config.region === 'intl' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com'
      // voice language selects speech text upstream; Auto preserves mixed-language pronunciation.
      const response = await request('https://' + host + '/api/v1/services/aigc/multimodal-generation/generation', {
        method: 'POST', headers: { ...(secret.key ? {Authorization: 'Bearer ' + secret.key} : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: { text: spec.text, voice, language_type: 'Auto', ...(instructions ? { instructions } : {}) } }), signal
      })
      const result = await response.json()
      if (result.code) failure(response.status, result)
      let url
      try { url = new URL(result.output?.audio?.url) } catch { throw new Error('Qwen 未返回有效的音频地址') }
      // The official examples return signed http:// OSS URLs; the key is never sent there.
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Qwen 未返回有效的音频地址')
      // Download only the returned URL, without forwarding the API key or following redirects.
      return qwenWav(await (await request(url.href, { signal }, 'audio')).arrayBuffer())
    }
  }
}
