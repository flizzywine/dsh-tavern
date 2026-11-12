// Shared recognition service: the 语音后端's 语音识别 services. Providers see audio, never contacts, calls or story state.
// A service is an API reached by URL — a cloud one or a model on this machine (本地模型 page), the same way: OpenAI's
// transcription format (POST {base}/audio/transcriptions, optional GET {base}/info and POST {base}/turn).
// Plugin channels (tavern.speechProvider({recognize})) join the list as services of their own.
import {randomUUID} from 'node:crypto'
import {untilAborted} from './plugin-callback.js'

export const OPENAI_BASE_URL = 'https://api.openai.com/v1'
// kind → its defaults. openai always needs its key; an OpenAI-compatible server only when it was given one.
export const RECOGNITION_KINDS = Object.freeze({
  openai:Object.freeze({label:'OpenAI',url:OPENAI_BASE_URL,model:'gpt-4o-mini-transcribe',keyRequired:true}),
  'openai-compatible':Object.freeze({label:'OpenAI 兼容',url:'',model:'',keyRequired:false}),
})
export const recognitionKeyRef = id => 'DSH_TAVERN_ASR_' + id.toUpperCase().replace(/-/g,'_') + '_KEY'
export const defaultRecognitionConfig = () => ({services:[]})
const fail = code => Object.assign(new Error(code), {code})
const MAX_AUDIO = 16000 * 2 * 60, MODEL_ID = /^[a-zA-Z0-9._:/-]{1,100}$/, SERVICE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/, LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/
const FIELDS = ['id','label','kind','url','model','language','final']

export function validateRecognitionService(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !FIELDS.includes(key))) throw fail('ASR_CONFIG_INVALID')
  const kind = RECOGNITION_KINDS[value.kind]
  if (!kind) throw fail('ASR_PROVIDER_INVALID')
  if (typeof value.id !== 'string' || !SERVICE_ID.test(value.id)) throw fail('ASR_SERVICE_ID_INVALID')
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (!label || label.length > 30) throw fail('ASR_LABEL_INVALID')
  const model = value.model ?? kind.model
  if (typeof model !== 'string' || !MODEL_ID.test(model)) throw fail('ASR_MODEL_INVALID')
  const language = value.language ?? 'zh'
  if (typeof language !== 'string' || !LANGUAGE.test(language)) throw fail('ASR_LANGUAGE_INVALID')
  let url = kind.url
  if (!url) {
    let base
    try {base = new URL(value.url)} catch {}
    if (!base || !['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw fail('ASR_URL_INVALID')
    url = base.href.replace(/\/+$/,'')
  }
  if (value.final !== undefined && (typeof value.final !== 'string' || !value.final || value.final === value.id)) throw fail('ASR_FINAL_INVALID')
  return {id:value.id,label,kind:value.kind,...(kind.url ? {} : {url}),model,language,...(value.final ? {final:value.final} : {})}
}
export function validateRecognitionConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.services) || Object.keys(value).some(key => key !== 'services')) throw fail('ASR_CONFIG_INVALID')
  const services = value.services.map(validateRecognitionService), ids = new Set(services.map(row => row.id))
  if (ids.size !== services.length) throw fail('ASR_SERVICE_ID_TAKEN')
  // A final service names another configured one; a deleted one is dropped by the host before this is asked.
  if (services.some(row => row.final && !ids.has(row.final))) throw fail('ASR_FINAL_INVALID')
  return {services}
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
async function transcript(response, onPartial, language) {
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

const baseOf = service => RECOGNITION_KINDS[service.kind].url || service.url

export function createSpeechRecognition({getConfig,credentials,providers = () => [],fetch:send = globalThis.fetch,id = randomUUID,now = () => performance.now()}) {
  const sessions = new Map()
  async function bearer(service, typed) {
    const value = typed ?? (await credentials()?.resolve(recognitionKeyRef(service.id)))?.value
    if (!value && RECOGNITION_KINDS[service.kind].keyRequired) throw fail('ASR_NO_KEY')
    return value ? {Authorization:'Bearer ' + value} : {}
  }
  // A configured service, or a plugin channel by its id. Unknown: unavailable (the phone names one the backend dropped).
  function serviceOf(serviceId) {
    const row = getConfig().services.find(service => service.id === serviceId)
    if (row) return row
    const extension = providers().find(entry => entry.id === serviceId)
    if (extension) return {id:extension.id,label:extension.label,extension}
    throw fail('ASR_PROVIDER_UNAVAILABLE')
  }
  // GET {base}/info, the server's own description: models [{id,state?}], languages, capabilities.turnDetection. A server
  // without the route is still a recognition server (404 → nothing declared). Kept briefly so each pause does not ask again.
  const infos = new Map()
  async function info(service, typed) {
    if (service.kind === 'openai') return {models:[{id:service.model}],languages:null,turnDetection:false}
    const base = baseOf(service), cached = typed === undefined && infos.get(base)
    if (cached && cached.until > now()) return cached.info
    const response = await send(base + '/info',{headers:await bearer(service,typed),signal:AbortSignal.timeout(1500),redirect:'error'})
    const body = response.ok ? await response.json() : response.status === 404 ? {} : null
    if (!body) throw fail(response.status === 401 ? 'ASR_UNAUTHORIZED' : 'ASR_HTTP_ERROR')
    const result = {
      models:(Array.isArray(body.models) ? body.models : []).filter(row => typeof row?.id === 'string' && MODEL_ID.test(row.id)).slice(0,40).map(row => ({id:row.id,...(typeof row.state === 'string' ? {state:row.state.slice(0,20)} : {})})),
      languages:Array.isArray(body.languages) ? body.languages.filter(lang => typeof lang === 'string' && LANGUAGE.test(lang)).slice(0,20) : null,
      turnDetection:body.capabilities?.turnDetection === true,
      // a server still loading (or failed) says so; one that does not is taken as ready
      ready:body.state === undefined || body.state === 'ready',
    }
    if (typed === undefined) infos.set(base,{until:now() + 30000,info:result})
    return result
  }
  async function transcribe(service, {audio,language,signal,onPartial}) {
    if (service.extension) return untilAborted(Promise.resolve().then(() => {
      signal.throwIfAborted()
      return service.extension.recognize({audio:new Uint8Array(audio),sampleRate:16000,language,signal,onPartial})
    }),signal)
    const body = new FormData()
    body.set('file',new Blob([wav(audio)],{type:'audio/wav'}),'speech.wav')
    body.set('model',service.model);body.set('language',language);body.set('stream','true')
    const response = await send(baseOf(service) + '/audio/transcriptions',{method:'POST',headers:await bearer(service),body,signal,redirect:'error'})
    if (!response.ok) throw fail('ASR_HTTP_ERROR')
    return transcript(response,onPartial,language)
  }
  // final: these words become the player's line (a call's pause snapshot): the service's 定稿用 service reads them when it
  // takes this language and is ready; otherwise (no final service, one still loading or down, or one that declares other
  // languages) the service itself.
  async function recognize({serviceId,audio,language,signal,onPartial,final = false}) {
    const started = now(), own = serviceOf(serviceId), lang = language || own.language || 'zh'
    if (!(audio instanceof Uint8Array) || !audio.length || audio.length % 2 || audio.length > MAX_AUDIO) throw fail('ASR_AUDIO_INVALID')
    if (typeof lang !== 'string' || !LANGUAGE.test(lang)) throw fail('ASR_LANGUAGE_INVALID')
    audio = Buffer.from(audio)
    const combined = signal ? AbortSignal.any([signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
    combined.throwIfAborted()
    try {
      let service = own
      if (final && own.final) {
        const finisher = serviceOf(own.final), described = await info(finisher).catch(() => null)
        if (described?.ready && (!described.languages || described.languages.includes(lang))) service = finisher
      }
      const result = await transcribe(service,{audio,language:lang,signal:combined,onPartial})
      combined.throwIfAborted()
      if (typeof result?.text !== 'string' || result.text.length > 12000) throw fail('ASR_RESPONSE_INVALID')
      return {text:result.text,language:result.language || lang,provider:service.id,roundTripMs:now()-started,
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
        const result = await recognize({serviceId:row.serviceId,audio,language:row.language,signal:row.controller.signal,onPartial:value=>{
          if (!row.controller.signal.aborted && typeof value?.text === 'string' && value.text.length <= 12000) {row.text=value.text;row.revision++}
        }})
        if (row.controller.signal.aborted) return
        row.decoded=sequence;row.text=result.text;row.language=result.language;row.timing={modelMs:result.modelMs,roundTripMs:result.roundTripMs};row.revision++
        if (row.final && row.sequence === sequence) {row.done=true;row.audio=[]}
      }
    } catch(error) {if(!row.controller.signal.aborted){row.error=error.code;row.done=true;row.audio=[];row.revision++}}
    finally {row.running=false}
  }
  // available: the service answers (its /info, or its key for the official endpoint). A plugin channel: registered.
  async function readiness(serviceId) {
    let service
    try {service = serviceOf(serviceId)} catch(error) {return {available:false,reason:error.code}}
    if (service.extension) return {available:true,provider:service.id}
    try {await bearer(service)} catch(error) {return {available:false,provider:service.id,reason:error.code}}
    if (service.kind === 'openai') return {available:true,provider:service.id}
    try {await info(service);return {available:true,provider:service.id}}
    catch(error) {return {available:false,provider:service.id,...(error.code === 'ASR_UNAUTHORIZED' ? {reason:'ASR_UNAUTHORIZED'} : {})}}
  }
  return Object.freeze({
    recognize,readiness,
    // The editor's 测试 / model list for a draft service (typed key, or the saved one when the key is left alone).
    async describe(service, typed) {
      const row = validateRecognitionService(service)
      try {return {available:true,...await info(row,typed ?? (await credentials()?.resolve(recognitionKeyRef(row.id)))?.value ?? '')}}
      catch(error) {return {available:false,reason:error.code || 'ASR_HTTP_ERROR'}}
    },
    // Has the speaker finished? {probability, modelMs} from the service's turn detector (POST {base}/turn, declared in its
    // /info), or null when it has none (the phone call then judges the end by the pause alone).
    async endpoint({serviceId,audio}) {
      if (!(audio instanceof Uint8Array) || !audio.length || audio.length % 2 || audio.length > MAX_AUDIO) throw fail('ASR_AUDIO_INVALID')
      const service = serviceOf(serviceId)
      if (service.extension || service.kind === 'openai' || !(await info(service).catch(() => ({}))).turnDetection) return null
      try {
        const response = await send(baseOf(service) + '/turn', {
          method:'POST', headers:{...await bearer(service),'Content-Type':'application/octet-stream'},
          body:audio, signal:AbortSignal.timeout(5000), redirect:'error',
        })
        if (!response.ok) throw fail('ASR_ENDPOINT_UNAVAILABLE')
        const {probability,modelMs} = await response.json()
        if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw fail('ASR_ENDPOINT_UNAVAILABLE')
        return {probability,modelMs}
      } catch { throw fail('ASR_ENDPOINT_UNAVAILABLE') }
    },
    start({owner,serviceId,language}) {
      if (typeof owner !== 'string' || !owner.trim() || owner.length > 200) throw fail('ASR_OWNER_INVALID')
      if (language !== undefined && (typeof language !== 'string' || !LANGUAGE.test(language))) throw fail('ASR_LANGUAGE_INVALID')
      const service = serviceOf(serviceId)
      for(const row of sessions.values())if(row.owner===owner)cancel(row)
      const row={id:id(),owner,serviceId:service.id,language:language || service.language || 'zh',controller:new AbortController(),audio:[],bytes:0,sequence:0,decoded:0,revision:0,text:'',done:false,final:false,error:null,timing:null,running:false,timer:null}
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
