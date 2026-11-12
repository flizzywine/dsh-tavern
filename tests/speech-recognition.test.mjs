import test from 'node:test'
import assert from 'node:assert/strict'
import {createSpeechRecognition,validateRecognitionConfig,validateRecognitionService,recognitionAudio,recognitionKeyRef} from '../tavern-plugin/lib/domain/speech-recognition.js'
import {createSpeechRecognitionHost} from '../tavern-plugin/lib/speech-recognition-host.js'

const audio=Buffer.alloc(640), encoded=audio.toString('base64'), tick=()=>new Promise(resolve=>setImmediate(resolve))
const SENSEVOICE={id:'sensevoice',label:'SenseVoice',kind:'openai-compatible',url:'http://127.0.0.1:9887/v1',model:'sensevoice',language:'zh',final:'firered'}
const FIRERED={id:'firered',label:'FireRed',kind:'openai-compatible',url:'http://127.0.0.1:9888/v1',model:'firered',language:'zh'}
const OPENAI={id:'openai',label:'OpenAI',kind:'openai',model:'gpt-4o-mini-transcribe',language:'zh'}
// A server by its address: /info (models, languages, turn detection), /turn, /audio/transcriptions.
function servers(described={}) {
  const requests=[]
  const fetch=async(url,request={})=>{
    url=String(url);requests.push({url,request})
    const base=url.replace(/\/(info|turn|audio\/transcriptions)$/,''), info=described[base]
    if(url.endsWith('/info'))return info===undefined?new Response('{}',{status:404}):info===null?new Response('',{status:503}):Response.json(info)
    if(url.endsWith('/turn'))return Response.json({probability:.97,modelMs:11})
    return Response.json({text:'words from '+request.body.get('model'),language:request.body.get('language'),seconds:.02})
  }
  return {requests,fetch}
}
const keys=(values={})=>{const map=new Map(Object.entries(values));return {map,store:()=>({resolve:async ref=>map.has(ref)?{value:map.get(ref)}:undefined,describe:async ref=>({configured:map.has(ref)}),set:async(ref,value)=>map.set(ref,value),unset:async ref=>map.delete(ref)})}}

test('a service is an API by its address: its model, its key (when given) and its own language; no secret in results',async()=>{
  const {requests,fetch}=servers()
  const {store}=keys({[recognitionKeyRef('sensevoice')]:'test-secret'})
  const service=createSpeechRecognition({getConfig:()=>({services:[SENSEVOICE,FIRERED]}),credentials:store,fetch})
  const result=await service.recognize({serviceId:'sensevoice',audio})
  assert.equal(result.text,'words from sensevoice');assert.equal(result.provider,'sensevoice');assert.equal(result.modelMs,20)
  const sent=requests.find(row=>row.url.endsWith('/audio/transcriptions'))
  assert.equal(sent.url,'http://127.0.0.1:9887/v1/audio/transcriptions')
  assert.equal(sent.request.headers.Authorization,'Bearer test-secret');assert.equal(sent.request.redirect,'error')
  assert.equal(sent.request.body.get('language'),'zh')
  assert.doesNotMatch(JSON.stringify(result),/test-secret/)
  // A service with no key of its own sends none; one the backend does not have is unavailable, never another one.
  await service.recognize({serviceId:'firered',audio})
  assert.equal(requests.at(-1).request.headers.Authorization,undefined)
  await assert.rejects(service.recognize({serviceId:'gone',audio}),{code:'ASR_PROVIDER_UNAVAILABLE'})
  // The official endpoint always needs its key.
  const cloud=createSpeechRecognition({getConfig:()=>({services:[OPENAI]}),credentials:keys().store,fetch})
  await assert.rejects(cloud.recognize({serviceId:'openai',audio}),{code:'ASR_NO_KEY'})
  assert.deepEqual(await cloud.readiness('openai'),{available:false,provider:'openai',reason:'ASR_NO_KEY'})
  assert.equal(await cloud.endpoint({serviceId:'openai',audio}),null)
})

test('定稿用: the final words go to the final service when it takes the language; partials and other languages stay',async()=>{
  const {requests,fetch}=servers({'http://127.0.0.1:9888/v1':{models:[{id:'firered',state:'ready'}],languages:['zh']}})
  const service=createSpeechRecognition({getConfig:()=>({services:[SENSEVOICE,FIRERED]}),credentials:keys().store,fetch})
  assert.equal((await service.recognize({serviceId:'sensevoice',audio,final:true})).text,'words from firered')
  assert.equal((await service.recognize({serviceId:'sensevoice',audio})).text,'words from sensevoice')
  assert.equal((await service.recognize({serviceId:'sensevoice',audio,language:'ja',final:true})).text,'words from sensevoice')
  assert.equal(requests.filter(row=>row.url.endsWith('/info')).length,1,'its description is kept between pauses')
  // FireRed still loading (it says so) or not running: the service itself reads the final words, the call goes on.
  for (const described of [{state:'loading',languages:['zh']},null]) {
    const {fetch}=servers({'http://127.0.0.1:9888/v1':described})
    const own=createSpeechRecognition({getConfig:()=>({services:[SENSEVOICE,FIRERED]}),credentials:keys().store,fetch})
    assert.equal((await own.recognize({serviceId:'sensevoice',audio,final:true})).text,'words from sensevoice')
  }
})

test('turn detection and readiness follow what the server describes; a server without /info is still a server',async()=>{
  const described={'http://127.0.0.1:9887/v1':{models:[{id:'sensevoice'}],capabilities:{turnDetection:true}}}
  const {requests,fetch}=servers(described)
  let now=0
  const service=createSpeechRecognition({getConfig:()=>({services:[SENSEVOICE,FIRERED]}),credentials:keys().store,fetch,now:()=>now})
  assert.deepEqual(await service.endpoint({serviceId:'sensevoice',audio}),{probability:.97,modelMs:11})
  assert.equal(requests.at(-1).url,'http://127.0.0.1:9887/v1/turn')
  assert.equal(await service.endpoint({serviceId:'firered',audio}),null)
  assert.deepEqual(await service.readiness('firered'),{available:true,provider:'firered'})
  described['http://127.0.0.1:9887/v1']=null;now=60000
  assert.deepEqual(await service.readiness('sensevoice'),{available:false,provider:'sensevoice'})
  assert.deepEqual(await service.readiness('gone'),{available:false,reason:'ASR_PROVIDER_UNAVAILABLE'})
  assert.deepEqual((await service.describe({...FIRERED},'')).available,true)
})

test('stream sessions coalesce chunks, publish partials and final, enforce ownership and stop on unload',async()=>{
  let finish,dispatches=0
  const extension={id:'plugin/asr',label:'插件识别',recognize:async({audio,onPartial})=>{
    dispatches++;onPartial({text:'partial '+audio.length})
    if(dispatches===1)await new Promise(resolve=>{finish=resolve})
    return {text:'final '+audio.length,language:'zh'}
  }}
  const service=createSpeechRecognition({getConfig:()=>({services:[]}),credentials:keys().store,providers:()=>[extension]})
  const session=service.start({owner:'s',serviceId:'plugin/asr'})
  service.append({owner:'s',id:session.id,sequence:1,audio:encoded});await tick()
  assert.equal(service.poll({owner:'s',id:session.id}).text,'partial 640')
  assert.throws(()=>service.poll({owner:'other',id:session.id}),/ASR_SESSION_GONE/)
  assert.throws(()=>service.append({owner:'s',id:session.id,sequence:3,audio:encoded}),/ASR_SEQUENCE_INVALID/)
  service.append({owner:'s',id:session.id,sequence:2,audio:encoded})
  service.append({owner:'s',id:session.id,sequence:3,audio:encoded,final:true})
  finish();await tick();await tick()
  const result=service.poll({owner:'s',id:session.id})
  assert.equal(dispatches,2);assert.equal(result.text,'final 1920');assert.equal(result.done,true)
  assert.throws(()=>service.start({owner:'s',serviceId:'gone'}),/ASR_PROVIDER_UNAVAILABLE/)
  service.dispose();assert.throws(()=>service.poll({owner:'s',id:session.id}),/ASR_SESSION_GONE/)
})

test('cancellation releases a stalled extension and does not route failures to another service',async()=>{
  let requests=0
  const controller=new AbortController()
  const service=createSpeechRecognition({getConfig:()=>({services:[SENSEVOICE]}),credentials:keys().store,providers:()=>[{id:'plugin/asr',label:'x',recognize:()=>new Promise(()=>{})}],fetch:()=>{requests++;throw Error('must not fall back')}})
  const result=service.recognize({serviceId:'plugin/asr',audio,signal:controller.signal});await tick();controller.abort()
  await assert.rejects(result,{code:'ASR_CANCELLED'});assert.equal(requests,0)
  const broken=createSpeechRecognition({getConfig:()=>({services:[SENSEVOICE]}),credentials:keys().store,fetch:async()=>{throw Error('test-secret')}})
  await assert.rejects(broken.recognize({serviceId:'sensevoice',audio}),error=>error.message==='ASR_FAILED')
  for(const input of [null,[],Buffer.alloc(0),Buffer.alloc(3),Buffer.alloc(1920002)]) await assert.rejects(broken.recognize({serviceId:'sensevoice',audio:input}),{code:'ASR_AUDIO_INVALID'})
  assert.throws(()=>broken.start({owner:'',serviceId:'sensevoice'}),/ASR_OWNER_INVALID/)
})

test('services are validated once as they are saved; audio admits only bounded even PCM',()=>{
  assert.deepEqual(validateRecognitionService({...SENSEVOICE,url:'http://127.0.0.1:9887/v1/'}).url,'http://127.0.0.1:9887/v1')
  assert.equal(validateRecognitionService(OPENAI).url,undefined,'the official address is not the player\'s')
  for(const [patch,code] of [[{kind:'local'},'ASR_PROVIDER_INVALID'],[{url:'ftp://x'},'ASR_URL_INVALID'],[{id:'Bad Id'},'ASR_SERVICE_ID_INVALID'],[{label:''},'ASR_LABEL_INVALID'],[{final:'sensevoice'},'ASR_FINAL_INVALID'],[{token:'x'},'ASR_CONFIG_INVALID']])
    assert.throws(()=>validateRecognitionService({...SENSEVOICE,...patch}),new RegExp(code))
  assert.throws(()=>validateRecognitionConfig({services:[SENSEVOICE]}),/ASR_FINAL_INVALID/,'定稿用 names a configured service')
  assert.throws(()=>validateRecognitionConfig({services:[FIRERED,FIRERED]}),/ASR_SERVICE_ID_TAKEN/)
  assert.deepEqual(recognitionAudio(encoded),audio)
  for(const value of ['', 'AA==','**'])assert.throws(()=>recognitionAudio(value),/ASR_AUDIO_INVALID/)
})

test('the host: CAS-saved services, keys only in credentials, the offered list, and a deleted final service dropped',async()=>{
  let document
  const {map,store}=keys()
  const {fetch}=servers({'http://127.0.0.1:9887/v1':{models:[{id:'sensevoice'}]}})
  const host=await createSpeechRecognitionHost({store:{readJson:async()=>document,updateJson:async(_,update)=>document=update(document)},credentials:store,providers:()=>[{id:'plugin/asr',label:'插件识别'}],fetch})
  assert.equal(host.current(),'plugin/asr','the first offered')
  let view=await host.methods.saveSpeechRecognitionService({service:FIRERED,expectedRevision:0})
  view=await host.methods.saveSpeechRecognitionService({service:SENSEVOICE,key:'private-key',expectedRevision:view.revision})
  assert.deepEqual(view.services.map(row=>[row.id,row.key.configured]),[['firered',false],['sensevoice',true]])
  await assert.rejects(host.methods.saveSpeechRecognitionService({service:FIRERED,expectedRevision:0}),{code:'ASR_SETTINGS_CONFLICT'})
  assert.doesNotMatch(JSON.stringify({document,view}),/private-key/)
  assert.equal(host.current(),'firered','a saved service comes before a plugin\'s')
  assert.deepEqual((await host.methods.listSpeechRecognitionServices()).services.map(row=>[row.id,row.available]),[['firered',true],['sensevoice',true],['plugin/asr',true]])
  view=await host.methods.getSpeechRecognitionConfig()
  view=await host.methods.deleteSpeechRecognitionService({id:'firered',expectedRevision:view.revision})
  assert.equal(view.services.find(row=>row.id==='sensevoice').final,undefined,'its 定稿用 use goes with it')
  view=await host.methods.deleteSpeechRecognitionService({id:'sensevoice',expectedRevision:view.revision})
  assert.equal(map.has(recognitionKeyRef('sensevoice')),false)
  host.service.dispose()
})

test('settings written before services become one service with its key under that service; nothing old is left',async()=>{
  let document={revision:3,config:{provider:'openai-compatible',language:'zh',localUrl:'http://127.0.0.1:9887',model:'gpt-4o-mini-transcribe',compatibleUrl:'http://127.0.0.1:9887/v1',compatibleModel:'sensevoice'}}
  const {map,store}=keys({DSH_TAVERN_ASR_COMPATIBLE_KEY:'lan-key',DSH_TAVERN_ASR_LOCAL_TOKEN:'worker-token'})
  const host=await createSpeechRecognitionHost({store:{readJson:async()=>document,updateJson:async(_,update)=>document=update(document)},credentials:store,providers:()=>[],fetch:servers().fetch})
  assert.deepEqual(document,{revision:4,config:{services:[{id:'sensevoice',label:'SenseVoice',kind:'openai-compatible',url:'http://127.0.0.1:9887/v1',model:'sensevoice',language:'zh'}]}})
  assert.equal(map.get(recognitionKeyRef('sensevoice')),'lan-key')
  assert.equal(map.has('DSH_TAVERN_ASR_COMPATIBLE_KEY'),false)
  assert.equal(map.get('DSH_TAVERN_ASR_LOCAL_TOKEN'),'worker-token','the local worker\'s own token stays')
  const again=await createSpeechRecognitionHost({store:{readJson:async()=>document,updateJson:async()=>assert.fail('read twice, written once')},credentials:store,providers:()=>[],fetch:servers().fetch})
  host.service.dispose();again.service.dispose()
})
