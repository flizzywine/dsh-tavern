// Shared recognition service. Providers see audio, never contacts, calls or story state.
import {randomUUID} from 'node:crypto'
import {untilAborted} from './plugin-callback.js'

export const RECOGNITION_KEYS = Object.freeze({local:'DSH_TAVERN_ASR_LOCAL_TOKEN',openai:'DSH_TAVERN_ASR_OPENAI_KEY','openai-compatible':'DSH_TAVERN_ASR_COMPATIBLE_KEY'})
// openai and openai-compatible are one transcription format (POST {base}/audio/transcriptions); the compatible base URL is
// the player's (a local SenseVoice worker, a LAN or cloud server) and its key is optional.
export const OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const defaultRecognitionConfig = () => ({provider:'local',language:'zh',localUrl:'http://127.0.0.1:9887',model:'gpt-4o-mini-transcribe',compatibleUrl:'http://127.0.0.1:9887/v1',compatibleModel:'sensevoice'})
const fail = code => Object.assign(new Error(code), {code})
const MAX_AUDIO = 16000 * 2 * 60, MODEL_ID = /^[a-zA-Z0-9._:/-]{1,100}$/
export function validateRecognitionConfig(value, providers = []) {
  const config = {...defaultRecognitionConfig(),...value}
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(defaultRecognitionConfig(),key))) throw fail('ASR_CONFIG_INVALID')
  if (![...Object.keys(RECOGNITION_KEYS),...providers.map(row=>row.id)].includes(config.provider)) throw fail('ASR_PROVIDER_INVALID')
  if (typeof config.language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(config.language)) throw fail('ASR_LANGUAGE_INVALID')
  if ([config.model,config.compatibleModel].some(model => typeof model !== 'string' || !MODEL_ID.test(model))) throw fail('ASR_MODEL_INVALID')
  let base
  try {base = new URL(config.compatibleUrl)} catch {}
  if (!base || !['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw fail('ASR_COMPATIBLE_URL_INVALID')
  config.compatibleUrl = base.href.replace(/\/+$/,'')
  let url
  try {url = new URL(config.localUrl)} catch {}
  if (!url || url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail('ASR_LOCAL_URL_INVALID')
  return config
}
export function recognitionAudio(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_AUDIO / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw fail('ASR_AUDIO_INVALID')
  const bytes = Buffer.from(value,'base64')
  if (!bytes.length || bytes.length % 2 || bytes.length > MAX_AUDIO) throw fail('ASR_AUDIO_INVALID')
  return bytes
}
function wav(pcm) {
  const head = Buffer.alloc(44)
  head.write('RIFF');head.writeUInt32LE(36 + pcm.length,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16)
  head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(16000,24);head.writeUInt32LE(32000,28)
  head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(pcm.length,40)
  return Buffer.concat([head,pcm])
}
async function cloudTranscript(response, onPartial, language) {
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) return response.json()
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', text = ''
  const event = block => {
    const body = block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')
    if (!body || body === '[DONE]') return
    const row = JSON.parse(body)
    if (row.type === 'error') throw fail('ASR_PROVIDER_ERROR')
    if (row.type === 'transcript.text.delta' && typeof row.delta === 'string') {text += row.delta; onPartial?.({text,language})}
    if (row.type === 'transcript.text.done' && typeof row.text === 'string') text = row.text
  }
  try {
    for (;;) {
      const {value,done} = await reader.read()
      buffer += decoder.decode(value, {stream:!done})
      buffer = buffer.replace(/\r\n/g,'\n')
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {event(buffer.slice(0,end));buffer = buffer.slice(end + 2)}
      if (buffer.length > 256000 || text.length > 12000) throw fail('ASR_RESPONSE_TOO_LARGE')
      if (done) {if(buffer.trim())event(buffer);break}
    }
    return {text,language}
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock()}
}

const transcriptionBase = config => config.provider === 'openai' ? OPENAI_BASE_URL : config.compatibleUrl

export function createSpeechRecognition({getConfig,credentials,providers = () => [],fetch:send = globalThis.fetch,id = randomUUID,now = () => performance.now()}) {
  const sessions = new Map()
  // The official endpoint always needs its key; a compatible server only when it was given one.
  async function bearer(provider) {
    const key = await credentials()?.resolve(RECOGNITION_KEYS[provider])
    if (!key?.value && provider !== 'openai-compatible') throw fail('ASR_NO_KEY')
    return key?.value ? {Authorization:'Bearer ' + key.value} : {}
  }
  // Optional discovery of a compatible server (GET {base}/info): turnDetection marks POST {base}/turn. A server without the
  // route is still a recognition server, just without one; the answer is kept briefly so each pause does not ask again.
  // finalModel names the server's model for the words that become the player's line (recognize({final:true}), a call's
  // pause snapshot) - a slower, more accurate one (the local worker's firered) while the live line keeps compatibleModel.
  let discovered = null
  async function discover(config, headers) {
    const base = transcriptionBase(config)
    if (discovered?.base === base && discovered.until > now()) return discovered.info
    const response = await send(base + '/info',{headers,signal:AbortSignal.timeout(1500),redirect:'error'})
    const info = response.ok ? await response.json() : response.status === 404 ? {} : null
    if (!info) throw fail('ASR_HTTP_ERROR')
    const finalModel = info.capabilities?.finalModel
    const capabilities = {turnDetection:info.capabilities?.turnDetection === true,finalModel:typeof finalModel === 'string' && MODEL_ID.test(finalModel) ? finalModel : null}
    discovered = {base,until:now() + 30000,info:capabilities}
    return capabilities
  }
  async function recognize({audio,language,signal,onPartial,final = false}, config = getConfig()) {
    config = validateRecognitionConfig(config,providers())
    const started = now(), provider = config.provider, lang = language || config.language
    if (!(audio instanceof Uint8Array) || !audio.length || audio.length % 2 || audio.length > MAX_AUDIO) throw fail('ASR_AUDIO_INVALID')
    if (typeof lang !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(lang)) throw fail('ASR_LANGUAGE_INVALID')
    audio = Buffer.from(audio)
    const combined = signal ? AbortSignal.any([signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
    combined.throwIfAborted()
    let result
    try {
      if (!Object.hasOwn(RECOGNITION_KEYS,provider)) {
        const extension = providers().find(row=>row.id === provider)
        if (!extension) throw fail('ASR_PROVIDER_UNAVAILABLE')
        result = await untilAborted(Promise.resolve().then(() => {
          combined.throwIfAborted()
          return extension.recognize({audio:new Uint8Array(audio),sampleRate:16000,language:lang,signal:combined,onPartial})
        }),combined)
      } else {
        let url, body, headers = await bearer(provider)
        if (provider === 'local') {
          url = new URL('/v1/transcribe',config.localUrl)
          body = audio; headers = {...headers,'Content-Type':'application/octet-stream','X-Language':lang}
        } else {
          url = transcriptionBase(config) + '/audio/transcriptions'
          body = new FormData();body.set('file',new Blob([wav(audio)],{type:'audio/wav'}),'speech.wav')
          const finalModel = final && provider === 'openai-compatible' ? (await discover(config,headers).catch(() => ({}))).finalModel : null
          body.set('model',provider === 'openai' ? config.model : finalModel || config.compatibleModel);body.set('language',lang);body.set('stream','true')
        }
        const response = await send(url,{method:'POST',headers,body,signal:combined,redirect:'error'})
        if (!response.ok) throw fail('ASR_HTTP_ERROR')
        result = provider === 'local' ? await response.json() : await cloudTranscript(response,onPartial,lang)
      }
      combined.throwIfAborted()
      if (typeof result?.text !== 'string' || result.text.length > 12000) throw fail('ASR_RESPONSE_INVALID')
      return {text:result.text,language:result.language || lang,provider,roundTripMs:now()-started,
        modelMs:Number.isFinite(result.seconds) ? result.seconds * 1000 : null}
    } catch(error) {
      if (combined.aborted) throw fail(signal?.aborted ? 'ASR_CANCELLED' : 'ASR_TIMEOUT')
      throw fail(['ASR_NO_KEY','ASR_PROVIDER_UNAVAILABLE','ASR_HTTP_ERROR','ASR_RESPONSE_INVALID','ASR_RESPONSE_TOO_LARGE','ASR_PROVIDER_ERROR'].includes(error.code) ? error.code : 'ASR_FAILED')
    }
  }
  function owned(owner,sessionId) {
    const row = sessions.get(sessionId)
    if (!row || row.owner !== owner) throw fail('ASR_SESSION_GONE')
    return row
  }
  function snapshot(row) {return {id:row.id,revision:row.revision,text:row.text,language:row.language,done:row.done,error:row.error,timing:row.timing}}
  function cancel(row) {row.controller.abort();clearTimeout(row.timer);sessions.delete(row.id)}
  function touch(row) {clearTimeout(row.timer);row.timer=setTimeout(()=>cancel(row),60000);row.timer.unref?.()}
  async function decode(row) {
    if (row.running || row.done) return
    row.running = true
    try {
      while (!row.controller.signal.aborted && row.decoded !== row.sequence) {
        const sequence = row.sequence, audio = Buffer.concat(row.audio,row.bytes)
        const result = await recognize({audio,language:row.language,signal:row.controller.signal,onPartial:value=>{
          if (!row.controller.signal.aborted && typeof value?.text === 'string' && value.text.length <= 12000) {row.text=value.text;row.revision++}
        }},row.config)
        if (row.controller.signal.aborted) return
        row.decoded=sequence;row.text=result.text;row.language=result.language;row.timing={modelMs:result.modelMs,roundTripMs:result.roundTripMs};row.revision++
        if (row.final && row.sequence === sequence) {row.done=true;row.audio=[]}
      }
    } catch(error) {if(!row.controller.signal.aborted){row.error=error.code;row.done=true;row.audio=[];row.revision++}}
    finally {row.running=false}
  }
  return Object.freeze({
    recognize,
    // Has the speaker finished? {probability, modelMs} from the provider's optional turn detector, or null when it has none
    // (the phone call then judges the end by the pause alone). A detector the provider declares and that fails is a failure.
    async endpoint({audio}) {
      if (!(audio instanceof Uint8Array) || !audio.length || audio.length % 2 || audio.length > MAX_AUDIO) throw fail('ASR_AUDIO_INVALID')
      const config = validateRecognitionConfig(getConfig(),providers())
      if (!['local','openai-compatible'].includes(config.provider)) return null
      const headers = await bearer(config.provider)
      if (config.provider === 'openai-compatible' && !(await discover(config,headers).catch(() => ({}))).turnDetection) return null
      try {
        const response = await send(config.provider === 'local' ? new URL('/v1/endpoint',config.localUrl) : config.compatibleUrl + '/turn', {
          method:'POST', headers:{...headers,'Content-Type':'application/octet-stream'},
          body:audio, signal:AbortSignal.timeout(5000), redirect:'error',
        })
        if (!response.ok) throw fail('ASR_ENDPOINT_UNAVAILABLE')
        const {probability,modelMs} = await response.json()
        if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw fail('ASR_ENDPOINT_UNAVAILABLE')
        return {probability,modelMs}
      } catch { throw fail('ASR_ENDPOINT_UNAVAILABLE') }
    },
    async readiness() {
      let config
      try {config=validateRecognitionConfig(getConfig(),providers())}
      catch(error) {return {available:false,reason:error.code}}
      if (!Object.hasOwn(RECOGNITION_KEYS,config.provider)) return {available:providers().some(row=>row.id===config.provider),provider:config.provider}
      if(config.provider==='openai-compatible') {
        try {await discover(config,await bearer(config.provider));return {available:true,provider:config.provider}}
        catch{return {available:false,provider:config.provider}}
      }
      const key=await credentials()?.resolve(RECOGNITION_KEYS[config.provider])
      if(!key?.value)return {available:false,provider:config.provider,reason:'ASR_NO_KEY'}
      if(config.provider==='openai')return {available:true,provider:'openai'}
      try {const response=await send(new URL('/v1/info',config.localUrl),{headers:{Authorization:'Bearer '+key.value},signal:AbortSignal.timeout(1500),redirect:'error'});return {available:response.ok,provider:'local'}}
      catch{return {available:false,provider:'local'}}
    },
    start({owner,language}) {
      if (typeof owner !== 'string' || !owner.trim() || owner.length > 200) throw fail('ASR_OWNER_INVALID')
      if (language !== undefined && (typeof language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(language))) throw fail('ASR_LANGUAGE_INVALID')
      for(const row of sessions.values())if(row.owner===owner)cancel(row)
      const config=validateRecognitionConfig(structuredClone(getConfig()),providers()), row={id:id(),owner,config,language:language || config.language,controller:new AbortController(),audio:[],bytes:0,sequence:0,decoded:0,revision:0,text:'',done:false,final:false,error:null,timing:null,running:false,timer:null}
      sessions.set(row.id,row);touch(row);return snapshot(row)
    },
    append({owner,id:sessionId,sequence,audio,final=false}) {
      const row=owned(owner,sessionId)
      if(row.done || row.final || sequence !== row.sequence + 1 || typeof final !== 'boolean')throw fail('ASR_SEQUENCE_INVALID')
      const bytes=recognitionAudio(audio)
      if(row.bytes+bytes.length>MAX_AUDIO)throw fail('ASR_AUDIO_TOO_LONG')
      row.audio.push(bytes);row.bytes+=bytes.length;row.sequence=sequence;row.final=final;touch(row)
      void decode(row);return snapshot(row)
    },
    poll({owner,id:sessionId}) {const row=owned(owner,sessionId);touch(row);return snapshot(row)},
    cancel({owner,id:sessionId}) {cancel(owned(owner,sessionId));return {cancelled:true}},
    dispose() {for(const row of sessions.values())cancel(row)},
  })
}
