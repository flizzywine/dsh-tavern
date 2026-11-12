import {createSpeechRecognition,defaultRecognitionConfig,validateRecognitionConfig,validateRecognitionService,recognitionKeyRef,RECOGNITION_KINDS} from './domain/speech-recognition.js'

const SETTINGS = 'speech-recognition/settings.json'
const fail = (message, code) => Object.assign(new Error(message),{code})
const KEY = /^[\x21-\x7e]{1,4096}$/

// The settings written before 语音识别 had services ({provider, localUrl, model, compatibleUrl, compatibleModel}) become
// one service, its key moved under that service's own name. Read once at start, written back; nothing reads the old shape.
const LEGACY_KEYS = {local:'DSH_TAVERN_ASR_LOCAL_TOKEN',openai:'DSH_TAVERN_ASR_OPENAI_KEY','openai-compatible':'DSH_TAVERN_ASR_COMPATIBLE_KEY'}
export function legacyRecognitionService(old) {
  const language = typeof old.language === 'string' ? old.language : 'zh'
  if (old.provider === 'openai') return {id:'openai',label:'OpenAI',kind:'openai',model:old.model || RECOGNITION_KINDS.openai.model,language}
  const model = old.provider === 'local' ? 'sensevoice' : old.compatibleModel || 'sensevoice'
  const url = old.provider === 'local' ? String(old.localUrl || 'http://127.0.0.1:9887').replace(/\/+$/,'') + '/v1' : old.compatibleUrl
  const id = model.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'local'
  return {id,label:model === 'sensevoice' ? 'SenseVoice' : model.slice(0,30),kind:'openai-compatible',url,model,language}
}
async function migrate(store, credentials, document) {
  const old = document.config
  if (!old?.provider) return document
  const secrets = credentials()
  // Plugin channels were never saved settings: a config naming one keeps no service.
  const service = Object.hasOwn(LEGACY_KEYS,old.provider) ? validateRecognitionService(legacyRecognitionService(old)) : null
  if (service && secrets?.set) {
    const key = (await secrets.resolve(LEGACY_KEYS[old.provider]))?.value
    if (key) await secrets.set(recognitionKeyRef(service.id),key)
    // The local worker reads DSH_TAVERN_ASR_LOCAL_TOKEN itself (dsh-local-voice): only the stage's copies go.
    for (const name of ['DSH_TAVERN_ASR_OPENAI_KEY','DSH_TAVERN_ASR_COMPATIBLE_KEY']) if ((await secrets.describe(name))?.configured) await secrets.unset(name)
  }
  return store.updateJson(SETTINGS,current => ({revision:(current?.revision || 0) + 1,config:{services:service ? [service] : []}}))
}

export async function createSpeechRecognitionHost({store,credentials,providers,fetch}) {
  let document = await store.readJson(SETTINGS) || {revision:0,config:defaultRecognitionConfig()}
  document = await migrate(store,credentials,document)
  const service = createSpeechRecognition({getConfig:()=>document.config,credentials,providers,fetch})
  // write(config) under the revision the editor read; a stale editor gets ASR_SETTINGS_CONFLICT and reads again.
  async function write(expectedRevision, change) {
    document = await store.updateJson(SETTINGS,current => {
      const previous = current || {revision:0,config:defaultRecognitionConfig()}
      if (previous.revision !== expectedRevision) throw fail('识别设置已变化，请重新读取','ASR_SETTINGS_CONFLICT')
      return {revision:previous.revision + 1,config:validateRecognitionConfig(change(previous.config))}
    })
  }
  async function setKey(id, value) {
    if (value === undefined) return
    if (value !== null && (typeof value !== 'string' || !KEY.test(value))) throw fail('识别密钥无效','ASR_KEY_INVALID')
    const secrets = credentials()
    if (!secrets?.set) throw fail('凭据库不可写','ASR_CREDENTIALS_UNAVAILABLE')
    await (value === null ? secrets.unset(recognitionKeyRef(id)) : secrets.set(recognitionKeyRef(id),value))
  }
  // What the 语音后端 offers: the configured services, then the plugin channels. Users (the phone) pick one by id.
  const offered = () => [...document.config.services.map(({id,label}) => ({id,label})),...providers().map(({id,label}) => ({id,label}))]
  const methods = {
    async getSpeechRecognitionConfig() {
      const services = await Promise.all(document.config.services.map(async row => ({...row,key:{configured:!!(await credentials()?.describe(recognitionKeyRef(row.id)))?.configured}})))
      return {revision:document.revision,services,external:providers().map(({id,label}) => ({id,label})),
        kinds:Object.entries(RECOGNITION_KINDS).map(([kind,row]) => ({kind,label:row.label,url:row.url,model:row.model,keyRequired:row.keyRequired}))}
    },
    // {service, key?: string (set) | null (clear) | undefined (keep), expectedRevision}. A new id is added; a known one replaced.
    async saveSpeechRecognitionService({service:input,key,expectedRevision}) {
      const row = validateRecognitionService(input)
      await write(expectedRevision,config => {
        const services = config.services.slice(), at = services.findIndex(other => other.id === row.id)
        if (at < 0) services.push(row); else services[at] = row
        return {services}
      })
      await setKey(row.id,key)
      return methods.getSpeechRecognitionConfig()
    },
    // A service another one uses for its final words loses that use with it.
    async deleteSpeechRecognitionService({id,expectedRevision}) {
      await write(expectedRevision,config => ({services:config.services.filter(row => row.id !== id).map(({final,...row}) => final === id ? row : {...row,...(final ? {final} : {})})}))
      if ((await credentials()?.describe(recognitionKeyRef(id)))?.configured) await setKey(id,null)
      return methods.getSpeechRecognitionConfig()
    },
    // A draft service's models, languages and turn detection, before it is saved (key: as typed, else the saved one).
    describeSpeechRecognitionService({service:input,key}) {
      if (key !== undefined && key !== null && (typeof key !== 'string' || !KEY.test(key))) throw fail('识别密钥无效','ASR_KEY_INVALID')
      return service.describe(input,key ?? undefined)
    },
    // Each offered service with whether it answers now (the backend's status words).
    async listSpeechRecognitionServices() {
      return {services:await Promise.all(offered().map(async row => ({...row,available:(await service.readiness(row.id)).available})))}
    },
    startSpeechRecognition(args) {return service.start({owner:args.sessionId,serviceId:args.serviceId,language:args.language})},
    appendSpeechRecognition(args) {return service.append({owner:args.sessionId,id:args.id,sequence:args.sequence,audio:args.audio,final:args.final})},
    pollSpeechRecognition(args) {return service.poll({owner:args.sessionId,id:args.id})},
    cancelSpeechRecognition(args) {return service.cancel({owner:args.sessionId,id:args.id})},
  }
  return {
    service,methods,
    // The service a user of recognition (the phone's calls) hears with: the first one the backend offers. Users never
    // choose one of their own; the 语音后端 is where services are set.
    current:() => offered()[0]?.id || '',
    readiness:serviceId => service.readiness(serviceId),
  }
}
