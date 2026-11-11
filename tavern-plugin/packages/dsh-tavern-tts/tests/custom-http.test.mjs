// 自定义语音服务: one adapter driven by the saved connection; the presets are plain values. All HTTP is mocked; no keys.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenAICompatibleAdapter } from '../src/providers/openai-compatible.js'
import { providerConfig } from '../src/providers/params.js'
import { HTTP_PRESETS } from '../src/providers/http-config.js'
import { createServiceSettings, validateSettings } from '../src/settings.js'
import { createTts } from '../src/service.js'

const pcm = [Buffer.from([1,0,2,0]),Buffer.from([3,0,4,0])]
const adapterWith = respond => { const calls = []; return {calls, adapter:createOpenAICompatibleAdapter({fetch:async (url,options) => { calls.push({url,options}); return respond(url,options) }})} }

// docs.volcengine.com/docs/ark/agent-plan-personal-voice-model: HTTP Chunked, X-Api-Key + X-Api-Resource-Id, base64 lines.
test('火山方舟 Agent Plan preset posts the documented request to the plan endpoint and joins the streamed audio', async () => {
  const provider = {config:providerConfig('openai-compatible',{preset:'volc-agent-plan'})}
  assert.equal(provider.config.url,'https://openspeech.bytedance.com')
  const lines = [...pcm.map(b => JSON.stringify({code:0,message:'',data:b.toString('base64')})),JSON.stringify({code:20000000,message:'OK',data:null,usage:{text_words:2}})]
  const {calls, adapter} = adapterWith(() => new Response(lines.join('\n') + '\n'))
  const wav = await adapter.synthesize(provider,{key:'plan-key'},{text:'你好',language:'zh',params:{voice:'zh_female_vv_uranus_bigtts'}})
  const [{url, options}] = calls
  assert.equal(url,'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional'); assert.equal(options.method,'POST')
  assert.equal(options.headers['X-Api-Key'],'plan-key'); assert.equal(options.headers['X-Api-Resource-Id'],'seed-tts-2.0')
  assert.match(options.headers['X-Api-Request-Id'],/^[0-9a-f-]{36}$/); assert.equal(options.headers.Authorization,undefined)
  assert.deepEqual(JSON.parse(options.body),{req_params:{text:'你好',speaker:'zh_female_vv_uranus_bigtts',audio_params:{format:'pcm',sample_rate:24000}}})
  assert.equal(wav.toString('ascii',0,4),'RIFF'); assert.equal(wav.readUInt32LE(24),24000); assert.deepEqual(wav.subarray(44),Buffer.concat(pcm))
  // the builtin 豆包 2.0 speakers are its voice list; listing them requests nothing.
  const listed = await adapter.voices(provider,{key:'plan-key'})
  assert.equal(listed.source,'builtin'); assert.ok(listed.voices.some(v => v.id === 'zh_female_vv_uranus_bigtts')); assert.equal(calls.length,1)
  // a refusal shows its status value, never the provider's text; a cut stream is not half a line of audio.
  const refused = adapterWith(() => new Response(JSON.stringify({code:45000000,message:'secret detail'}) + '\n'))
  await assert.rejects(refused.adapter.synthesize(provider,{key:'k'},{text:'嗯',params:{voice:'v'}}),e => /code = 45000000/.test(e.message) && !e.message.includes('secret'))
  const cut = adapterWith(() => new Response(lines[0] + '\n'))
  await assert.rejects(cut.adapter.synthesize(provider,{key:'k'},{text:'嗯',params:{voice:'v'}}),/没有传完/)
  const denied = adapterWith(() => new Response('{}',{status:401}))
  await assert.rejects(denied.adapter.synthesize(provider,{key:'bad'},{text:'嗯',params:{voice:'v'}}),{code:'PROVIDER_AUTH_FAILED'})
})

test('OpenAI preset sends the OpenAI speech body; empty placeholders drop their key and a keyless server gets no Authorization', async () => {
  const provider = {config:providerConfig('openai-compatible',{preset:'openai',url:'https://speech.invalid/'})}
  const {calls, adapter} = adapterWith(() => new Response(Buffer.from('RIFF')))
  await adapter.synthesize(provider,{key:'k'},{text:'Hi',language:'en',params:{voice:'alloy',model:'tts-1',speed:1.2}})
  assert.equal(calls[0].url,'https://speech.invalid/v1/audio/speech'); assert.equal(calls[0].options.headers.Authorization,'Bearer k')
  assert.deepEqual(JSON.parse(calls[0].options.body),{model:'tts-1',voice:'alloy',input:'Hi',response_format:'wav',speed:1.2})
  await adapter.synthesize(provider,{},{text:'Hi',params:{voice:'alloy'}})
  assert.equal(calls[1].options.headers.Authorization,undefined); assert.equal(JSON.parse(calls[1].options.body).model,undefined)
})

test('JSON base64 responses and GET query templates follow the configured fields', async () => {
  const provider = {config:providerConfig('openai-compatible',{preset:'blank',url:'http://127.0.0.1:9000',speechPath:'/speak',method:'GET',headers:'X-Token: {{key}}',
    body:'{"q":"{{text}}","spk":"{{voice}}","rate":"{{speed}}"}',responseMode:'json',audioPath:'result.audio',statusPath:'ok',okValues:'true',audioFormat:'pcm',sampleRate:'16000'})}
  assert.equal(provider.config.sampleRate,16000)
  const {calls, adapter} = adapterWith(() => Response.json({ok:true,result:{audio:Buffer.concat(pcm).toString('base64')}}))
  const wav = await adapter.synthesize(provider,{key:'t'},{text:'你好',params:{voice:'a b'}})
  const url = new URL(calls[0].url)
  assert.equal(url.pathname,'/speak'); assert.equal(url.searchParams.get('q'),'你好'); assert.equal(url.searchParams.get('spk'),'a b'); assert.equal(url.searchParams.get('rate'),'1')
  assert.equal(calls[0].options.body,undefined); assert.equal(calls[0].options.headers['X-Token'],'t')
  assert.equal(wav.readUInt32LE(24),16000)
  const refused = adapterWith(() => Response.json({ok:false}))
  await assert.rejects(refused.adapter.synthesize(provider,{key:'t'},{text:'嗯',params:{voice:'a'}}),/ok = false/)
})

test('a connection is checked once when saved: only http(s), known placeholders, the key only in headers', () => {
  const blank = input => providerConfig('openai-compatible',{preset:'blank',url:'https://a.example',...input})
  assert.throws(() => blank({url:'file:///etc/passwd'}),/Base URL 无效/)
  assert.throws(() => blank({url:'https://user:pw@a.example'}),/Base URL 无效/)
  assert.throws(() => blank({body:'{"text":"{{text}}","k":"{{key}}"}'}),/不认识/)
  assert.throws(() => blank({body:'{"voice":"{{voice}}"}'}),/\{\{text\}\}/)
  assert.throws(() => blank({body:'not json'}),/JSON/)
  assert.throws(() => blank({headers:'Host: evil.example'}),/请求头/)
  assert.throws(() => blank({headers:'X-Voice: {{voice}}'}),/\{\{key\}\}/)
  assert.throws(() => blank({speechPath:'//evil.example/x'}),/合成路径/)
  assert.throws(() => blank({timeoutSec:600}),/超时/)
  assert.throws(() => blank({responseMode:'json'}),/音频字段/)
  assert.throws(() => providerConfig('openai-compatible',{preset:'nope',url:'https://a.example'}),/预设无效/)
  // a saved config is its expanded fields: normalizing it again changes nothing.
  for (const preset of Object.keys(HTTP_PRESETS)) {
    const c = providerConfig('openai-compatible',{preset,url:'https://a.example'})
    assert.deepEqual(providerConfig('openai-compatible',c),c)
  }
})

test('services saved before 自定义语音服务 load as the OpenAI preset and are written out in full once; keys stay in credentials', async t => {
  const legacy = {id:'openai',kind:'openai-compatible',label:'Old',config:{url:'https://speech.invalid',speechPath:'/v1/audio/speech',modelsPath:'/v1/models',voicesPath:''}}
  let settings = validateSettings({enabled:true,providers:[legacy],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}), writes = 0
  const store = new Map([['DSH_TAVERN_TTS_OPENAI_KEY','mock-key']]), tts = createTts()
  const credentials = {resolve:async ref => ({value:store.get(ref)}),describe:async ref => ({configured:store.has(ref),writable:true}),set:async (ref,value) => store.set(ref,value),unset:async ref => store.delete(ref)}
  const services = createServiceSettings({tts,get:() => settings,replace:async next => { writes++; settings = next },credentials:() => credentials,fetch:async () => new Response(null,{status:500})})
  t.after(async () => { services.dispose(); await tts.dispose() })
  assert.deepEqual(await services.upgradeHttpServices(),{upgraded:1})
  const [upgraded] = settings.providers
  assert.deepEqual(upgraded.config,{...HTTP_PRESETS.openai,url:'https://speech.invalid',modelsPath:'/v1/models'})
  assert.equal(JSON.stringify(settings).includes('mock-key'),false)
  assert.deepEqual(await services.upgradeHttpServices(),{upgraded:0}); assert.equal(writes,1)
})
