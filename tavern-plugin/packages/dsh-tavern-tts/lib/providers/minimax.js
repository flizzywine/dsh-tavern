import { TtsError, describeTtsError } from '../core.js'
import { pcmWav } from './audio.js'
import { presetMood } from './params.js'
// MiniMax T2A v2 (ported from upstream lib/domain/speech.js): the same request body, except audio comes back as PCM, which
// this service keeps as PCM16 WAV like every other provider.
const SAMPLE_RATE = 32000
export const MINIMAX_VOICES = Object.freeze([
  ['female-shaonv','少女'], ['female-yujie','御姐'], ['female-chengshu','成熟女性'], ['female-tianmei','甜美女性'],
  ['male-qn-qingse','青涩青年'], ['male-qn-jingying','精英青年'], ['male-qn-badao','霸道青年'], ['male-qn-daxuesheng','青年大学生'],
  ['presenter_male','男性主持人'], ['presenter_female','女性主持人'], ['audiobook_male_1','男性有声书 1'], ['audiobook_female_1','女性有声书 1'],
].map(([id, label]) => Object.freeze({id, label, languages:['zh','en']})))
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
    if (!response.ok || code) throw failure(failureCode(code, response.ok ? undefined : response.status), response.ok ? undefined : response.status)
    if (!result) throw failure('MINIMAX_INVALID_AUDIO')
    return result
  }
  return {
    async catalog() { return { items: structuredClone(MINIMAX_VOICES), manual: true } },
    async voices() { return { voices: structuredClone(MINIMAX_VOICES), models: [], source: 'builtin' } },
    // The voice listing is free and answers authentication; 测试连接 never synthesizes.
    async probe(provider, secret) { await post(provider, secret, '/v1/get_voice', {voice_type:'system'}, undefined, 10000) },
    async synthesize(provider, secret, spec) {
      const body = await post(provider, secret, '/v1/t2a_v2', {model:spec.params.model || provider.config.model, text:spec.text, stream:false,
        voice_setting:{voice_id:spec.params.voice, speed:spec.params.speed ?? 1, vol:1, pitch:0, emotion:minimaxMood(spec) || 'neutral'},
        audio_setting:{format:'pcm', sample_rate:SAMPLE_RATE, channel:1}}, spec.signal, 45000)
      const audio = body.data?.audio
      if (typeof audio !== 'string' || !audio || audio.length % 4 || !/^[0-9a-f]+$/i.test(audio)) throw failure('MINIMAX_INVALID_AUDIO')
      return pcmWav(Buffer.from(audio, 'hex'), SAMPLE_RATE)
    },
  }
}
