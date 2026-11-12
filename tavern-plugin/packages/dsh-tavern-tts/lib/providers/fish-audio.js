// inline references belong to each request, never to persistent cloud models.
import { setTimeout as delay } from 'node:timers/promises'
import { hash, fail, TtsError, wav } from '../core.js'
import { pcmWav } from './audio.js'
import { presetParams, providerConfig } from './params.js'
import { fishMessagePack } from './fish-messagepack.js'
import { createFishDiscovery } from './fish-discovery.js'
import recommended from '../shared/fish-recommended.json' with {type:'json'}
import voiceCues from '../shared/voice-cues.cjs'

export function fishSpeechText(text, params, voiceDirections, spoken) {
  const mood = params.emotionTags !== false && !voiceCues.hasLeadingVoiceCue(text) ? params.emotionTag : undefined
  return (mood ? '[' + mood + '] ' : '') + voiceCues.projectVoiceCues(text, {cues:voiceDirections === true, spoken})
}

export const FISH_MOODS = Object.freeze({}) // styles belong to voice declarations.
export {FISH_MODELS} from './fish-models.js'
import {FISH_DEFAULT_MODEL, FISH_MODELS, fishModel, isFishCloud} from './fish-models.js'
export function fishRetryDelay(value, attempt, now = Date.now()) {
  const seconds = value === null ? NaN : Number(value)
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Math.max(1000 * 2 ** attempt, requested || 0)
}
function failure(status) {
  const code = {401:'FISH_AUTH_FAILED',403:'FISH_AUTH_FAILED',402:'FISH_BILLING_REQUIRED',429:'FISH_RATE_LIMITED'}[status] || 'FISH_REQUEST_FAILED'
  const error = new TtsError(code, status)
  error.message = {401:'Fish service requires authentication; check the API key (401).',403:'Fish service denied access; check the API key permissions (403).',402:'Fish Audio quota or balance is insufficient (402); the model was not changed.',429:'Fish Audio is busy or rate limited (429); please retry later.'}[status] || `Fish Audio request failed (${status}).`
  throw error
}
const HOLD_TTL_MS = 120000
export function createFishAudioAdapter({fetch = globalThis.fetch, sleep = (ms, signal) => delay(ms, undefined, {signal}), networkTimeoutMs = 120000} = {}) {
  const lanes = new Map(), infos = new Map(), libraries = new Map(), discovery = createFishDiscovery({fetch})
  // a server's own /v1/info, cached per URL and key until a refresh; a failed ask is not kept.
  function served(p, secret, refresh = false) {
    const key = hash([p.config.url, secret.key || ''])
    if (refresh) infos.delete(key)
    if (!infos.has(key)) infos.set(key, discovery.info(p, secret).catch(error => { infos.delete(key); throw error }))
    return infos.get(key)
  }
  async function info(p, secret, refresh = false) {
    if (isFishCloud(p.config)) return {models:structuredClone(FISH_MODELS),capabilities:{prepareVoice:false},source:'builtin'}
    return served(p, secret, refresh)
  }
  // Whether this service instance serves Fish's voice library (声音库 voice IDs), asked of the server itself and cached per
  // URL and key: a server with the discovery extension says so in /v1/info (`capabilities.voiceLibrary`); a server without
  // it (the official cloud) is asked whether its voice library API answers. Unanswered (offline, auth) rejects, not kept.
  function voiceLibrary(provider, secret) {
    const p = {...provider,config:providerConfig('fish-audio',provider.config)}, key = hash([p.config.url, secret.key || ''])
    if (!libraries.has(key)) libraries.set(key, served(p, secret).then(i => i.capabilities.voiceLibrary, error => {
      if (!['VOICE_NOT_FOUND','API_INCOMPATIBLE'].includes(error.code)) throw error
      return discovery.library(p, secret).catch(error => { if (error.code === 'VOICE_NOT_FOUND') return false; throw error })
    }).catch(error => { libraries.delete(key); throw error }))
    return libraries.get(key)
  }
  // The model a line speaks with: the figure's choice (its source's `model`), else the service's default — the cloud's
  // free model, a server's first listed one. The cloud takes only its known models (an unknown one is billed); a server
  // takes what it lists, or the asked model as is when it does not implement discovery.
  async function speakingModel(p, secret, requested) {
    if (isFishCloud(p.config)) {
      const id = requested ?? FISH_DEFAULT_MODEL
      if (!FISH_MODELS.some(m => m.id === id)) fail('INVALID_PARAMS')
      return {model:fishModel(id),capabilities:{}}
    }
    const metadata = await info(p, secret).catch(error => {
      // Keep this fallback out of the info cache so later calls retry capabilities.
      if (requested) return {models:[],capabilities:{}}
      throw error
    })
    const model = requested ? metadata.models.find(m => m.id === requested) || (metadata.models.length ? null : {id:requested,label:requested,billing:'unknown'}) : metadata.models[0]
    if (!model) fail('INVALID_PARAMS')
    return {model,capabilities:metadata.capabilities}
  }
  async function request(p, key, route, init, signal, onChunk, model, activity) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      const options = {...init, headers:{...(key ? {Authorization:'Bearer ' + key} : {}),...init.headers},redirect:'error',signal}
      const response = await (activity ? activity.send(fetch,p.config.url + route,options) : fetch(p.config.url + route,options))
      await activity?.headers(response)
      if (response.status === 429 && isFishCloud(p.config) && model?.billing === 'free' && attempt < 2) {
        const wait = fishRetryDelay(response.headers.get('retry-after'), attempt)
        await response.body?.cancel()
        // Do not shorten Retry-After: the operation deadline aborts long waits instead.
        await sleep(wait, signal); continue
      }
      if (!response.ok) { await response.body?.cancel(); failure(response.status) }
      const chunks = []; let size = 0
      for await (const chunk of response.body) {
        size += chunk.length; if (size > 32 * 1024 ** 2) fail('INVALID_AUDIO')
        chunks.push(chunk); onChunk?.(chunk)
      }
      await activity?.complete()
      return Buffer.concat(chunks)
    }
  }
  function inlineReferences(references) {
    if (!references.length) fail('MISSING_REFERENCE')
    return references.map(reference => ({audio:reference.bytes,text:reference.promptText}))
  }
  return {
    async catalog() { return {items:[]} },
    // the curated picks are the starting list; the picker searches Fish's own
    // (free) model listing by name and keeps manual ID entry.
    info,
    speakingModel,
    voiceLibrary,
    async voices(p = {config:{url:'https://api.fish.audio'}}, secret = {}) {
      if (!isFishCloud(p.config)) return info(p, secret, true)
      return {voices:recommended.map(v => ({id:v.voiceId,label:v.name,languages:v.languages || [],...(v.gender ? {gender:v.gender} : {}),description:(v.toneTags || []).slice(0,3).join(' · ')})),models:structuredClone(FISH_MODELS),source:'builtin',search:true}
    },
    // Explicit connection test only; never synthesize or create a voice during discovery.
    async probe(provider, secret) {
      const p = {...provider,config:providerConfig('fish-audio',provider.config)}
      if (!isFishCloud(p.config)) { await info(p, secret, true); return }
      // /model is public (any key, even a wrong one, answers 200); the account's credit is the free read that checks the key itself.
      try { await request(p,secret.key,'/wallet/self/api-credit',{method:'GET'},AbortSignal.timeout(10000)) }
      catch (error) { if (error instanceof TtsError) throw error; fail('SERVICE_OFFLINE') }
    },
    synthesize(provider, secret, spec) {
      const p = {...provider,config:providerConfig('fish-audio',provider.config)}
      // Unobserved calls retain the original deadline, including lane and discovery time.
      const deadline = () => AbortSignal.any([AbortSignal.timeout(networkTimeoutMs),...(spec.signal ? [spec.signal] : [])])
      const snapshot = spec.request?.capture('synthesize', spec.signal)
      let signal = snapshot?.observed ? snapshot.signal : deadline()
      // One lane per endpoint, shared by presets and inline references, including body reads/backoff.
      const previous = lanes.get(p.config.url) || Promise.resolve()
      const work = previous.catch(() => {}).then(async () => {
        signal?.throwIfAborted()
        const references = spec.references || (spec.reference ? [spec.reference] : undefined)
        // The figure's model is params.model (its source's choice); portable voice metadata (spec.model) is never sent upstream.
        const params = presetParams('fish-audio',spec.params, references ? {referenceId:'inline'} : {})
        if (references && spec.params?.referenceId !== undefined) fail('INVALID_PARAMS')
        const voice = references ? {references:inlineReferences(references)} : {reference_id:params.referenceId}
        const {model,capabilities} = await speakingModel(p, secret, params.model)
        // The service prepares text before cache identity; direct adapter callers use the same projection.
        const text = spec.textPrepared ? spec.text : fishSpeechText(spec.text, params, model.voiceDirections ?? capabilities.voiceDirections)
        const body = {text,...voice,format:'pcm',sample_rate:44100,latency:params.latency,prosody:{speed:params.speed,volume:params.volume},normalize:params.normalize}
        // Fish streams /v1/tts as it speaks; spec.onPcm receives the 16-bit mono 44.1 kHz PCM as it arrives.
        const init = {method:'POST',headers:{'Content-Type':references ? 'application/msgpack' : 'application/json',model:model.id},body:references ? fishMessagePack(body) : JSON.stringify(body)}
        const run = snapshot ? work => snapshot.run(work) : work => work(null)
        const pcm = await run(activity => {
          if (activity) signal = AbortSignal.any([AbortSignal.timeout(networkTimeoutMs),activity.signal])
          return request(p,secret.key,'/v1/tts',init,signal,spec.onPcm,model,activity)
        })
        return wav(pcmWav(pcm,44100))
      }).catch(error => { if (error instanceof TtsError) throw error; fail(signal?.aborted ? signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED' : error?.name === 'AbortError' ? 'ABORTED' : 'SERVICE_OFFLINE') }).finally(() => snapshot?.dispose())
      lanes.set(p.config.url,work)
      void work.finally(() => { if (lanes.get(p.config.url) === work) lanes.delete(p.config.url) }).catch(() => {})
      return work
    },
    // Optional extension (`/v1/info` capabilities.hold): a residency lease for an open call. The server keeps its model
    // loaded while the lease is live; it is renewed at half its ttl and expires by itself if this host goes away.
    async hold(provider, secret) {
      const p = {...provider,config:providerConfig('fish-audio',provider.config)}
      if (isFishCloud(p.config) || !(await info(p, secret, true)).capabilities.hold) return () => {}
      const post = async body => {
        const response = await fetch(p.config.url + '/v1/hold', {method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
          headers:{...(secret.key ? {Authorization:'Bearer ' + secret.key} : {}),'Content-Type':'application/json'},body:JSON.stringify(body)})
        if (!response.ok) { await response.body?.cancel(); failure(response.status) }
        return response.json()
      }
      const {id, ttlMs} = await post({ttlMs:HOLD_TTL_MS})
      const renew = setInterval(() => { void post({id,ttlMs}).catch(() => {}) }, ttlMs / 2)
      renew.unref?.()
      return () => { clearInterval(renew); void post({id,ttlMs,release:true}).catch(() => {}) }
    },
    // Optional Fish extension: never infer support from URL, model name or process residency.
    async prewarm(provider, secret, spec) {
      const p = {...provider,config:providerConfig('fish-audio',provider.config)}
      if (!(await info(p, secret)).capabilities.prepareVoice) return false
      const {model} = await speakingModel(p, secret, spec.model)
      const body = fishMessagePack({references:inlineReferences(spec.references)})
      const run = spec.request || ((operation, signal, work) => work(null))
      return run('prewarm',spec.signal,async activity => {
      const init = {method:'POST',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(10000),...((activity?.signal || spec.signal) ? [activity?.signal || spec.signal] : [])]),
        headers:{...(secret.key ? {Authorization:'Bearer ' + secret.key} : {}),'Content-Type':'application/msgpack',model:model.id},body}
      init.signal.throwIfAborted()
      const response = await (activity ? activity.send(fetch,p.config.url + '/v1/warm',init) : fetch(p.config.url + '/v1/warm',init))
      await activity?.headers(response)
      if (activity) {await response.arrayBuffer();activity.complete()}
      else await response.body?.cancel()
      if (!response.ok) failure(response.status)
      return true
      })
    },
  }
}
