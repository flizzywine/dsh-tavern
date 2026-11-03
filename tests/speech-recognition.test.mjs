import test from 'node:test'
import assert from 'node:assert/strict'
import {createSpeechRecognition,defaultRecognitionConfig,validateRecognitionConfig,recognitionAudio,RECOGNITION_KEYS} from '../tavern-plugin/lib/domain/speech-recognition.js'
import {createSpeechRecognitionHost} from '../tavern-plugin/lib/speech-recognition-host.js'

const audio=Buffer.alloc(640), encoded=audio.toString('base64'), tick=()=>new Promise(resolve=>setImmediate(resolve))
function setup(options={}) {
  const requests=[],refs=[]
  const service=createSpeechRecognition({getConfig:()=>defaultRecognitionConfig(),credentials:()=>({resolve:async ref=>{refs.push(ref);return {value:'test-secret'}}}),fetch:async(url,request)=>{requests.push({url:String(url),request});return Response.json({text:'你好',language:'zh',seconds:.02})},...options})
  return {service,requests,refs}
}

test('recognition defaults to local, resolves only its credential, sends PCM and exposes no secret',async()=>{
  const {service,requests,refs}=setup()
  const result=await service.recognize({audio})
  assert.equal(result.text,'你好');assert.equal(result.modelMs,20)
  assert.deepEqual(refs,[RECOGNITION_KEYS.local])
  assert.equal(requests[0].url,'http://127.0.0.1:9887/v1/transcribe')
  assert.equal(requests[0].request.headers.Authorization,'Bearer test-secret')
  assert.deepEqual(requests[0].request.body,audio)
  assert.equal(requests[0].request.redirect,'error')
  assert.doesNotMatch(JSON.stringify(result),/test-secret/)
})

test('a caller that names no language gets the configured one (the phone call names none)',async()=>{
  const {service,requests}=setup({getConfig:()=>({...defaultRecognitionConfig(),language:'ja'})})
  await service.recognize({audio})
  assert.equal(requests[0].request.headers['X-Language'],'ja')
  assert.equal(service.start({owner:'s'}).language,'ja')
  await service.recognize({audio,language:'zh'})
  assert.equal(requests[1].request.headers['X-Language'],'zh')
  service.dispose()
})

test('cloud recognition streams revisable text through split UTF-8 SSE and uses the same service',async()=>{
  const encoder=new TextEncoder(),partial=[],requests=[]
  const data=encoder.encode('data: {"type":"transcript.text.delta","delta":"你"}\r\n\r\ndata: {"type":"transcript.text.delta","delta":"好"}\n\ndata: {"type":"transcript.text.done","text":"你好。"}\n\n')
  const {service}=setup({getConfig:()=>({...defaultRecognitionConfig(),provider:'openai'}),fetch:async(url,request)=>{
    requests.push({url,request})
    return new Response(new ReadableStream({start(controller){for(const byte of data)controller.enqueue(Uint8Array.of(byte));controller.close()}}),{headers:{'content-type':'text/event-stream'}})
  }})
  const result=await service.recognize({audio,onPartial:row=>partial.push(row)})
  assert.equal(result.text,'你好。');assert.equal(result.modelMs,null)
  assert.deepEqual(partial.map(row=>row.text),['你','你好'])
  assert.equal(requests[0].url,'https://api.openai.com/v1/audio/transcriptions')
  const wav=Buffer.from(await requests[0].request.body.get('file').arrayBuffer())
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.deepEqual(wav.subarray(44),audio)
})

test('stream sessions coalesce chunks, publish partials and final, enforce ownership and stop on unload',async()=>{
  let finish,dispatches=0
  const extension={id:'plugin/asr',recognize:async({audio,onPartial})=>{
    dispatches++;onPartial({text:'partial '+audio.length})
    if(dispatches===1)await new Promise(resolve=>{finish=resolve})
    return {text:'final '+audio.length,language:'zh'}
  }}
  const {service}=setup({getConfig:()=>({...defaultRecognitionConfig(),provider:extension.id}),providers:()=>[extension]})
  const session=service.start({owner:'s'})
  service.append({owner:'s',id:session.id,sequence:1,audio:encoded});await tick()
  assert.equal(service.poll({owner:'s',id:session.id}).text,'partial 640')
  assert.throws(()=>service.poll({owner:'other',id:session.id}),/ASR_SESSION_GONE/)
  assert.throws(()=>service.append({owner:'s',id:session.id,sequence:3,audio:encoded}),/ASR_SEQUENCE_INVALID/)
  service.append({owner:'s',id:session.id,sequence:2,audio:encoded})
  service.append({owner:'s',id:session.id,sequence:3,audio:encoded,final:true})
  finish();await tick();await tick()
  const result=service.poll({owner:'s',id:session.id})
  assert.equal(dispatches,2);assert.equal(result.text,'final 1920');assert.equal(result.done,true)
  service.dispose();assert.throws(()=>service.poll({owner:'s',id:session.id}),/ASR_SESSION_GONE/)
})

test('cancellation releases a stalled extension and does not route failures to another provider',async()=>{
  let requests=0
  const controller=new AbortController()
  const {service}=setup({getConfig:()=>({...defaultRecognitionConfig(),provider:'plugin/asr'}),providers:()=>[{id:'plugin/asr',recognize:()=>new Promise(()=>{})}],fetch:()=>{requests++;throw Error('must not fall back')}})
  const result=service.recognize({audio,signal:controller.signal});await tick();controller.abort()
  await assert.rejects(result,{code:'ASR_CANCELLED'});assert.equal(requests,0)
  const missing=setup({credentials:()=>({resolve:async()=>undefined})})
  await assert.rejects(missing.service.recognize({audio}),{code:'ASR_NO_KEY'});assert.equal(missing.requests.length,0)
  const broken=setup({fetch:async()=>{throw Error('test-secret')}})
  await assert.rejects(broken.service.recognize({audio}),error=>error.message==='ASR_FAILED')
})

test('direct service admission matches RPC limits and a new owner session revokes the old one',async()=>{
  const {service,requests}=setup()
  for(const input of [null,[],Buffer.alloc(0),Buffer.alloc(3),Buffer.alloc(1920002)]) await assert.rejects(service.recognize({audio:input}),{code:'ASR_AUDIO_INVALID'})
  await assert.rejects(service.recognize({audio,language:'bad language'}),{code:'ASR_LANGUAGE_INVALID'})
  assert.equal(requests.length,0)
  const unsafe=setup({getConfig:()=>({...defaultRecognitionConfig(),localUrl:'http://foreign.invalid'})})
  await assert.rejects(unsafe.service.recognize({audio}),{code:'ASR_LOCAL_URL_INVALID'})
  assert.equal((await unsafe.service.readiness()).available,false)
  assert.equal(unsafe.requests.length,0);assert.equal(unsafe.refs.length,0)
  assert.throws(()=>service.start({owner:''}),/ASR_OWNER_INVALID/)
  assert.throws(()=>service.start({owner:'s',language:'bad language'}),/ASR_LANGUAGE_INVALID/)
  const first=service.start({owner:'s'})
  assert.throws(()=>service.append({owner:'s',id:first.id,sequence:1,audio:encoded,final:'false'}),/ASR_SEQUENCE_INVALID/)
  const next=service.start({owner:'s'})
  assert.notEqual(next.id,first.id)
  assert.throws(()=>service.poll({owner:'s',id:first.id}),/ASR_SESSION_GONE/)
  service.dispose()
})

test('settings are CAS-owned, keys stay in credentials and audio admits only bounded even PCM',async()=>{
  let document
  const keys=new Map()
  const host=await createSpeechRecognitionHost({store:{readJson:async()=>document,updateJson:async(_,update)=>document=update(document)},credentials:()=>({resolve:async ref=>keys.has(ref)?{value:keys.get(ref)}:undefined,describe:async ref=>({configured:keys.has(ref)}),set:async(ref,value)=>keys.set(ref,value),unset:async ref=>keys.delete(ref)}),providers:()=>[]})
  const saved=await host.methods.saveSpeechRecognitionConfig({config:defaultRecognitionConfig(),expectedRevision:0})
  assert.equal(saved.revision,1)
  await assert.rejects(host.methods.saveSpeechRecognitionConfig({config:defaultRecognitionConfig(),expectedRevision:0}),{code:'ASR_SETTINGS_CONFLICT'})
  await host.methods.setSpeechRecognitionKey({provider:'local',value:'private-key'})
  const status=await host.methods.getSpeechRecognitionConfig()
  assert.equal(status.credentials.local.configured,true)
  assert.doesNotMatch(JSON.stringify({document,status}),/private-key/)
  await host.methods.setSpeechRecognitionKey({provider:'local',value:null});assert.equal(keys.size,0)
  assert.throws(()=>validateRecognitionConfig({token:'forbidden'}),/ASR_CONFIG_INVALID/)
  assert.throws(()=>validateRecognitionConfig({localUrl:'https://foreign.invalid'}),/ASR_LOCAL_URL_INVALID/)
  assert.deepEqual(recognitionAudio(encoded),audio)
  for(const value of ['', 'AA==','**'])assert.throws(()=>recognitionAudio(value),/ASR_AUDIO_INVALID/)
  host.service.dispose()
})

test('local readiness coalesces background startup and recovers after health becomes ready',async()=>{
  let ready=false,launches=0,complete
  const host=await createSpeechRecognitionHost({store:{readJson:async()=>null},credentials:()=>({resolve:async()=>({value:'test-secret'})}),providers:()=>[],fetch:async()=>new Response('',{status:ready?200:503}),startLocal:async()=>{launches++;await new Promise(resolve=>{complete=resolve})}})
  assert.equal((await host.readiness()).starting,true)
  assert.equal((await host.readiness()).starting,true)
  assert.equal(launches,1)
  ready=true;complete();await tick()
  assert.equal((await host.readiness()).available,true)
  host.service.dispose()
})

test('audio endpoint uses only local Smart Turn and never falls back on failure', async () => {
  const {service,requests,refs}=setup({fetch:async()=>Response.json({probability:.96,modelMs:23})})
  assert.deepEqual(await service.endpoint({audio}),{probability:.96,modelMs:23})
  assert.deepEqual(refs,[RECOGNITION_KEYS.local])
  const unavailable=setup({fetch:async()=>new Response(null,{status:503})})
  await assert.rejects(unavailable.service.endpoint({audio}),{code:'ASR_ENDPOINT_UNAVAILABLE'})
  await assert.rejects(service.endpoint({audio:Buffer.alloc(3)}),{code:'ASR_AUDIO_INVALID'})
})

test('OpenAI-compatible recognition: the configured base URL, an optional key, and an optional turn detector',async()=>{
  const requests=[]
  let turnDetection=true,infoStatus=200
  const fetch=async(url,request={})=>{
    requests.push({url:String(url),request})
    if(String(url).endsWith('/info'))return infoStatus===200?Response.json({protocol:'openai-audio',capabilities:{turnDetection}}):new Response('{}',{status:infoStatus})
    if(String(url).endsWith('/turn'))return Response.json({probability:.97,modelMs:11})
    return Response.json({text:'こんにちは',language:'ja',duration:1.2})
  }
  const config={...defaultRecognitionConfig(),provider:'openai-compatible',compatibleUrl:'http://127.0.0.1:9887/v1/'}
  const keyless=createSpeechRecognition({getConfig:()=>config,credentials:()=>({resolve:async()=>undefined}),fetch})
  const result=await keyless.recognize({audio})
  assert.equal(result.text,'こんにちは');assert.equal(result.provider,'openai-compatible')
  assert.equal(requests[0].url,'http://127.0.0.1:9887/v1/audio/transcriptions')
  assert.equal(requests[0].request.headers.Authorization,undefined)
  assert.equal(requests[0].request.body.get('model'),'sensevoice')
  assert.deepEqual(await keyless.readiness(),{available:true,provider:'openai-compatible'})
  assert.deepEqual(await keyless.endpoint({audio}),{probability:.97,modelMs:11})
  assert.equal(requests.at(-1).url,'http://127.0.0.1:9887/v1/turn')
  // A server without a turn detector (or without /info) leaves the end of speech to the pause rule: null, not a failure.
  turnDetection=false
  const plain=createSpeechRecognition({getConfig:()=>config,credentials:()=>({resolve:async()=>({value:'lan-key'})}),fetch})
  assert.equal(await plain.endpoint({audio}),null)
  assert.equal(requests.at(-1).request.headers.Authorization,'Bearer lan-key')
  infoStatus=404
  const bare=createSpeechRecognition({getConfig:()=>config,credentials:()=>({resolve:async()=>undefined}),fetch})
  assert.equal((await bare.readiness()).available,true);assert.equal(await bare.endpoint({audio}),null)
  // Cloud OpenAI has no turn detector and still requires its key.
  const cloud=createSpeechRecognition({getConfig:()=>({...defaultRecognitionConfig(),provider:'openai'}),credentials:()=>({resolve:async()=>undefined}),fetch})
  assert.equal(await cloud.endpoint({audio}),null)
  await assert.rejects(cloud.recognize({audio}),{code:'ASR_NO_KEY'})
  assert.throws(()=>validateRecognitionConfig({provider:'openai-compatible',compatibleUrl:'ftp://example.com'}),/ASR_COMPATIBLE_URL_INVALID/)
})

test('a compatible server that declares a final model reads the pause snapshot with it; live partials keep compatibleModel',async()=>{
  const models=[]
  let declared='firered'
  const fetch=async(url,request={})=>{
    if(String(url).endsWith('/info'))return Response.json({protocol:'openai-audio',capabilities:{turnDetection:true,...(declared?{finalModel:declared}:{})}})
    models.push(request.body.get('model'));return Response.json({text:'你好',language:'zh'})
  }
  let clock=0
  const make=()=>createSpeechRecognition({getConfig:()=>({...defaultRecognitionConfig(),provider:'openai-compatible'}),credentials:()=>({resolve:async()=>undefined}),fetch,id:()=>'session-1',now:()=>clock})
  const service=make()
  await service.recognize({audio,final:true})
  service.start({owner:'call-a'})
  service.append({owner:'call-a',id:'session-1',sequence:1,audio:Buffer.from(audio).toString('base64')})
  await new Promise(resolve=>setTimeout(resolve,10))
  service.dispose()
  // A server without one (or with an unusable name) reads every request with compatibleModel, as before.
  declared=null;clock+=60000
  await service.recognize({audio,final:true})
  declared='fire red';clock+=60000
  await service.recognize({audio,final:true})
  assert.deepEqual(models,['firered','sensevoice','sensevoice','sensevoice'])
  // Cloud OpenAI declares nothing: its configured model.
  const cloud=createSpeechRecognition({getConfig:()=>({...defaultRecognitionConfig(),provider:'openai'}),credentials:()=>({resolve:async()=>({value:'sk-test'})}),fetch})
  await cloud.recognize({audio,final:true})
  assert.equal(models.at(-1),'gpt-4o-mini-transcribe')
})