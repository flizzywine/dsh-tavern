import {createSpeechRecognition,defaultRecognitionConfig,validateRecognitionConfig,RECOGNITION_KEYS} from './domain/speech-recognition.js'

const SETTINGS = 'speech-recognition/settings.json'
export async function createSpeechRecognitionHost({store,credentials,providers,fetch,startLocal}) {
  let document = await store.readJson(SETTINGS) || {revision:0,config:defaultRecognitionConfig()}
  const service = createSpeechRecognition({getConfig:()=>document.config,credentials,providers,fetch})
  let launchAt=0,launch=null,launchError=null
  const methods = {
    async getSpeechRecognitionConfig() {
      const status={}
      for(const provider of Object.keys(RECOGNITION_KEYS))status[provider]={configured:!!(await credentials()?.describe(RECOGNITION_KEYS[provider]))?.configured}
      return {...structuredClone(document),credentials:status,providers:[{id:'local',label:'本地识别'},{id:'openai',label:'OpenAI'},{id:'openai-compatible',label:'OpenAI 兼容识别'},...providers().map(({id,label})=>({id,label}))]}
    },
    async saveSpeechRecognitionConfig({config,expectedRevision}) {
      const next=validateRecognitionConfig(config,providers())
      document=await store.updateJson(SETTINGS,current=>{
        const previous=current || {revision:0}
        if(previous.revision!==expectedRevision)throw Object.assign(new Error('识别设置已变化，请重新读取'),{code:'ASR_SETTINGS_CONFLICT'})
        return {revision:previous.revision+1,config:next}
      })
      return methods.getSpeechRecognitionConfig()
    },
    async setSpeechRecognitionKey({provider,value}) {
      if(!Object.hasOwn(RECOGNITION_KEYS,provider) || value!==null && (typeof value!=='string' || !/^[\x21-\x7e]{1,4096}$/.test(value)))throw Object.assign(new Error('识别密钥无效'),{code:'ASR_KEY_INVALID'})
      const secrets=credentials()
      if(!secrets?.set)throw Object.assign(new Error('凭据库不可写'),{code:'ASR_CREDENTIALS_UNAVAILABLE'})
      await (value===null ? secrets.unset(RECOGNITION_KEYS[provider]) : secrets.set(RECOGNITION_KEYS[provider],value))
      return {configured:!!(await secrets.describe(RECOGNITION_KEYS[provider]))?.configured}
    },
    startSpeechRecognition(args) {return service.start({owner:args.sessionId,language:args.language})},
    appendSpeechRecognition(args) {return service.append({owner:args.sessionId,id:args.id,sequence:args.sequence,audio:args.audio,final:args.final})},
    pollSpeechRecognition(args) {return service.poll({owner:args.sessionId,id:args.id})},
    cancelSpeechRecognition(args) {return service.cancel({owner:args.sessionId,id:args.id})},
  }
  return {
    service,methods,
    async readiness() {
      const status=await service.readiness()
      if(!status.available && status.provider==='local' && status.reason!=='ASR_NO_KEY' && startLocal && !launch && Date.now()-launchAt>45000) {
        launchAt=Date.now();launchError=null
        launch=Promise.resolve().then(()=>startLocal({url:document.config.localUrl})).catch(()=>{launchError='ASR_LOCAL_START_FAILED'}).finally(()=>{launch=null})
      }
      return {...status,...(!status.available && launch ? {starting:true} : {}),...(!status.available && launchError ? {reason:launchError} : {})}
    },
  }
}
