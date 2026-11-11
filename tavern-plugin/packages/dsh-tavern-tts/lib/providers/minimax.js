import { TtsError, describeTtsError } from '../core.js'
import { pcmWav } from './audio.js'
import { presetMood } from './params.js'
// MiniMax T2A v2 (ported from upstream lib/domain/speech.js): the same request body, except audio comes back as PCM, which
// this service keeps as PCM16 WAV like every other provider.
const SAMPLE_RATE = 32000
// The T2A models a figure picks from (its voice source's `model`); the first is what a source without one speaks with.
// MiniMax has no model listing, so this table is the list.
export const MINIMAX_MODELS = Object.freeze(['speech-02-hd', 'speech-02-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-01-hd', 'speech-01-turbo']
  .map(id => Object.freeze({id, label:id})))
export const MINIMAX_DEFAULT_MODEL = MINIMAX_MODELS[0].id
// A system voice id names its language before the first `_` ("Japanese_IntellectualSenior"); the older Chinese voices
// (female-shaonv) carry no prefix and a Chinese voice_name. Anything else lists without a language.
const LANGUAGES = {'Chinese (Mandarin)':'zh', Chinese:'zh', Cantonese:'yue', English:'en', Japanese:'ja', Korean:'ko', Spanish:'es', Portuguese:'pt', French:'fr',
  Indonesian:'id', German:'de', Russian:'ru', Italian:'it', Arabic:'ar', Turkish:'tr', Ukrainian:'uk', Dutch:'nl', Vietnamese:'vi', Thai:'th', Polish:'pl',
  Romanian:'ro', Greek:'el', Czech:'cs', Finnish:'fi', Hindi:'hi'}
function voiceLanguages(id, name) {
  const prefix = LANGUAGES[id.slice(0, id.indexOf('_'))]
  return prefix ? [prefix] : /[\u3400-\u9fff]/.test(name || '') ? ['zh'] : []
}
// /v1/get_voice (free): every voice this account can speak with — system voices, its clones and designed voices.
// The account's own voices (mine) are not tied to a language: a clone or design speaks in any of them, so the language filter keeps them.
const listed = body => ['system_voice', 'voice_cloning', 'voice_generation'].flatMap(group => (body[group] || []).filter(v => typeof v?.voice_id === 'string' && v.voice_id)
  .map(v => group === 'system_voice' ? {id:v.voice_id, label:v.voice_name || v.voice_id, languages:voiceLanguages(v.voice_id, v.voice_name)}
    : {id:v.voice_id, label:v.voice_name || v.voice_id, languages:[], mine:true}))
// Upstream's emotion → MiniMax style table; a mood outside it speaks neutral.
const STYLES = {
  happy: ['joy', 'amusement', 'excitement', 'love', 'gratitude', 'pride', 'optimism', 'relief', 'admiration', 'approval', 'caring', 'desire'],
  sad: ['sadness', 'grief', 'disappointment', 'remorse'],
  angry: ['anger', 'annoyance', 'disapproval'],
  fearful: ['fear', 'nervousness'],
  disgusted: ['disgust'],
  surprised: ['surprise', 'realization']
}
export const MINIMAX_MOODS = Object.freeze(Object.fromEntries(Object.entries(STYLES).flatMap(([style, moods]) => moods.map(mood => [mood, style]))))
export const minimaxMood = spec => Object.hasOwn(spec.params,'emotion') ? spec.params.emotion : presetMood(MINIMAX_MOODS,spec)
// base_resp.status_code, from the T2A v2 error table.
function failureCode(code, status) {
  if ([1004, 2049].includes(code) || [401, 403].includes(status)) return 'MINIMAX_AUTH_FAILED'
  if ([1002, 1039].includes(code) || status === 429) return 'MINIMAX_RATE_LIMITED'
  if (code === 1008) return 'MINIMAX_BALANCE_REQUIRED'
  if ([1026, 1027, 1042].includes(code)) return 'MINIMAX_TEXT_REJECTED'
  if (code === 2013) return 'MINIMAX_INVALID_REQUEST'
  return 'MINIMAX_REQUEST_FAILED'
}
function failure(code, status) {
  const error = new TtsError(code, status)
  error.message = describeTtsError(code)
  return error
}
const endpoint = (provider, path) => provider.config.url + path + (provider.config.groupId ? '?GroupId=' + encodeURIComponent(provider.config.groupId) : '')
export function createMinimaxAdapter({ fetch: fetchImpl = globalThis.fetch } = {}) {
  async function post(provider, secret, path, body, signal, timeoutMs) {
    let response, result
    try {
      response = await fetchImpl(endpoint(provider, path), {method:'POST',headers:{'Content-Type':'application/json',...(secret.key ? {Authorization:'Bearer ' + secret.key} : {})},
        body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal ? [signal] : [])])})
      result = await response.json().catch(() => null)
    } catch { throw failure(signal?.aborted ? 'ABORTED' : 'MINIMAX_CONNECTION_FAILED') }
    const code = Number(result?.base_resp?.status_code || 0)
    if (!response.ok || code) {
      const error = failure(failureCode(code, response.ok ? undefined : response.status), response.ok ? undefined : response.status)
      if (path === '/v1/get_voice' && error.code === 'MINIMAX_REQUEST_FAILED' && result.base_resp?.status_msg) {
        error.message = String(result.base_resp.status_msg)
        if (secret.key) error.message = error.message.split(secret.key).join('[redacted]')
      }
      throw error
    }
    if (!result) throw failure('MINIMAX_INVALID_AUDIO')
    return result
  }
  return {
    async catalog(provider, secret) { return { items: (await this.voices(provider, secret)).voices } },
    // The one voice list: 测试连接 counts it and a figure's 音色 picks from it. Free, answers authentication, never synthesizes.
    async voices(provider, secret) {
      const body = await post(provider, secret, '/v1/get_voice', {voice_type:'all'}, undefined, 10000)
      return { voices:listed(body), models:structuredClone(MINIMAX_MODELS), source:'live' }
    },
    // An id this account can speak with (its clones and designed voices included), checked against the live list.
    async findVoice(provider, secret, voiceId) {
      const hit = (await this.voices(provider, secret)).voices.find(v => v.id === voiceId)
      if (!hit) throw failure('MINIMAX_VOICE_NOT_FOUND')
      return hit
    },
    async synthesize(provider, secret, spec) {
      // The figure's model; a service saved before the model moved still names one until the startup move
      // (service-model-migration.js) takes it to the figures.
      const body = await post(provider, secret, '/v1/t2a_v2', {model:spec.params.model || provider.config.model || MINIMAX_DEFAULT_MODEL, text:spec.text, stream:false,
        voice_setting:{voice_id:spec.params.voice, speed:spec.params.speed ?? 1, vol:1, pitch:0, emotion:minimaxMood(spec) || 'neutral'},
        audio_setting:{format:'pcm', sample_rate:SAMPLE_RATE, channel:1}}, spec.signal, 45000)
      const audio = body.data?.audio
      if (typeof audio !== 'string' || !audio || audio.length % 4 || !/^[0-9a-f]+$/i.test(audio)) throw failure('MINIMAX_INVALID_AUDIO')
      return pcmWav(Buffer.from(audio, 'hex'), SAMPLE_RATE)
    },
  }
}
