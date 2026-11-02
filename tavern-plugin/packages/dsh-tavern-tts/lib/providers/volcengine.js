import { randomUUID } from 'node:crypto'
import { TtsError, describeTtsError } from '../core.js'
import speakers from '../shared/volcengine-speakers.json' with { type: 'json' }
import { pcmWav } from './audio.js'
import { presetMood } from './params.js'
// Official V3 HTTP Chunked: docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http
const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
export const VOLCENGINE_MOODS = Object.freeze({})
export const volcengineMood = spec => Object.hasOwn(spec.params,'emotion') ? spec.params.emotion : presetMood(VOLCENGINE_MOODS,spec)
// 45000000 and 55000000 each cover several documented reasons; the message disambiguates them.
function failureCode(code, message, status) {
  if (/quota exceeded for types: concurrency/i.test(message) || status === 429) return 'VOLCENGINE_RATE_LIMITED'
  if (/quota exceeded/i.test(message)) return 'VOLCENGINE_QUOTA_EXCEEDED'
  if (/resource ID is mismatched|Init Engine Instance failed/i.test(message)) return 'VOLCENGINE_RESOURCE_MISMATCH'
  if (/speaker.*(permission|not authorized)|permission.*speaker/i.test(message)) return 'VOLCENGINE_VOICE_FORBIDDEN'
  if (/grant not found/i.test(message) || [401,403].includes(status ?? Number(code))) return 'VOLCENGINE_AUTH_FAILED'
  if (Number(code) === 40402003 || /single request size too large/i.test(message)) return 'VOLCENGINE_TEXT_TOO_LONG'
  if (Number(code) === 45002000 || /speaker not found/i.test(message)) return 'VOLCENGINE_INVALID_SPEAKER'
  if (Number(code) === 45002001) return 'VOLCENGINE_NO_READABLE_TEXT'
  if (Number(code) === 45000001 || /payload unmarshal/i.test(message)) return 'VOLCENGINE_INVALID_REQUEST'
  if (/Request timeout:/i.test(message)) return 'VOLCENGINE_CONNECTION_FAILED'
  if (Number(code) === 55000000 || status >= 500) return 'VOLCENGINE_SERVER_ERROR'
  return 'VOLCENGINE_REQUEST_FAILED'
}
export function volcengineError(code, message = '') {
  return describeTtsError(failureCode(code, message))
}
function safeFailure(code, status) {
  const error = new TtsError(code, status)
  error.message = describeTtsError(code)
  return error
}
function providerFailure(code, message = '', status) {
  return safeFailure(failureCode(code, message, status), status)
}
export function parseVolcengine(text) {
  const chunks = []; let ended = false
  for (let line of text.split(/\r?\n/)) {
    line = line.trim(); if (!line || line.startsWith(':') || /^(event|id|retry):/.test(line)) continue
    if (line.startsWith('data:')) line = line.slice(5).trim()
    if (!line) continue
    let chunk
    try { chunk = JSON.parse(line) } catch { throw safeFailure('VOLCENGINE_INVALID_AUDIO') }
    if (chunk.code === 20000000) { ended = true; break }
    if (chunk.code !== 0) throw providerFailure(chunk.code, chunk.message || chunk.msg)
    if (chunk.data) { if (typeof chunk.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data)) throw safeFailure('VOLCENGINE_INVALID_AUDIO'); chunks.push(Buffer.from(chunk.data, 'base64')) }
  }
  if (!ended || !chunks.length) throw safeFailure('VOLCENGINE_INVALID_AUDIO')
  return pcmWav(Buffer.concat(chunks))
}
const headers = (provider, secret) => ({'Content-Type':'application/json',...(secret.key ? {'X-Api-Key':secret.key} : {}),'X-Api-Resource-Id':provider.config.resourceId,'X-Api-Request-Id':randomUUID()})
export function createVolcengineAdapter({ fetch: fetchImpl = globalThis.fetch } = {}) {
  const adapter = {
    async catalog() { return { items: structuredClone(speakers), manual: true } },
    // Explicit paid check only. A refused speaker is an actionable failure, not a successful synthesis.
    async verify(provider, secret, speaker = speakers[0].id) {
      await adapter.synthesize(provider, secret, {text:'嗯',language:'zh',params:{speaker}})
      return {status:'connected',synthesisTested:true}
    },
    async probe(provider, secret) {
      // Connectivity only; a HEAD rejection does not establish API key or speaker authorization.
      let response
      try { response = await fetchImpl(ENDPOINT, {method:'HEAD',headers:headers(provider,secret),redirect:'error',signal:AbortSignal.timeout(10000)}) }
      catch { throw safeFailure('VOLCENGINE_CONNECTION_FAILED') }
      if (!response.ok && ![400,404,405].includes(response.status)) throw providerFailure(response.status,'',response.status)
    },
    async synthesize(provider, secret, spec) {
      const emotion = volcengineMood(spec)
      // Keep Chinese/English mixing; V3 requires a JSON string, not an object, for additions.
      const additions = ['zh','en'].includes(spec.language) ? {} : {explicit_language:spec.language === 'es' ? 'es-mx' : spec.language}
      let response
      try { response = await fetchImpl(ENDPOINT, {method:'POST',headers:headers(provider,secret),body:JSON.stringify({req_params:{text:spec.text,speaker:spec.params.speaker,audio_params:{format:'pcm',sample_rate:24000,speech_rate:spec.params.speechRate ?? 0,loudness_rate:0,...(emotion ? {emotion,emotion_scale:1} : {})},additions:JSON.stringify(additions)}}),redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(45000),...(spec.signal ? [spec.signal] : [])])}) }
      catch { throw safeFailure(spec.signal?.aborted ? 'ABORTED' : 'VOLCENGINE_CONNECTION_FAILED') }
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw providerFailure(detail.code || response.status,detail.message || detail.msg,response.status) }
      let text
      try { text = await response.text() } catch { throw safeFailure(spec.signal?.aborted ? 'ABORTED' : 'VOLCENGINE_CONNECTION_FAILED') }
      return parseVolcengine(text)
    }
  }
  return adapter
}
