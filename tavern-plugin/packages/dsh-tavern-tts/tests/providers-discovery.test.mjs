import {resolveVoiceSpec} from '../src/voice-resolver.js'
// G12-G13. All HTTP is mocked; no keys or paid provider calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createOpenAICompatibleAdapter } from '../src/providers/openai-compatible.js'
import { createQwenAdapter } from '../src/providers/qwen.js'
import { createVolcengineAdapter, parseVolcengine } from '../src/providers/volcengine.js'
import { providerConfig, presetParams } from '../src/providers/params.js'
import { createServiceSettings, validateSettings } from '../src/settings.js'
import { createTts } from '../src/service.js'
import { voicePreset, describeTtsError } from '../src/core.js'
import { pcmWav } from '../src/providers/audio.js'

const config = providerConfig('openai-compatible',{url:'https://speech.invalid',modelsPath:'/v1/models',voicesPath:'/v1/voices'})
const preset = {schemaVersion:1,id:'custom/voice',label:'Voice',enabled:true,kind:'openai-compatible',providerId:'custom',languages:['en'],params:{voice:'alloy',model:'tts-1',speed:1.1,instructions:'Calm'}}

test('online pickers return known voices immediately, coalesce refreshes and retain them on failure',async t => {
  for (const kind of ['qwen','azure']) {
    let finish, calls = 0
    const gate = new Promise(resolve => {finish = resolve})
    const config = providerConfig(kind, {region:kind === 'azure' ? 'eastasia' : 'cn'})
    const settings = {providers:[{id:'online',kind,config}],voices:[]}
    const tts = createTts(), services = createServiceSettings({tts,get:() => settings,credentials:() => ({resolve:async () => ({value:'test-key'})}),fetch:async () => {calls++;await gate;throw new TypeError('fetch failed')}})
    t.after(async () => {services.dispose();await tts.dispose()})
    const first = await services.listOnlinePresetVoices({provider:kind})
    assert.ok(first.voices.length > 0); assert.equal(first.source,'builtin'); assert.equal(first.refreshing,true)
    const second = await services.listOnlinePresetVoices({provider:kind})
    assert.deepEqual(second,first)
    finish(); await new Promise(resolve => setTimeout(resolve,20))
    const failed = await services.listOnlinePresetVoices({provider:kind})
    assert.equal(calls,1); assert.equal(failed.refreshing,false); assert.deepEqual(failed.voices,first.voices)
    assert.match(failed.message,/已保留可选声音.*检查连接/); assert.equal(failed.message.includes('fetch failed'),false)
  }
})

test('Fish catalogue is cache-first, language-scoped, popularity sorted and keeps selected voices',async () => {
  let release
  const gate = new Promise(resolve => {release = resolve}), calls = []
  const services = createServiceSettings({get:() => ({providers:[{id:'fish',kind:'fish-audio',config:providerConfig('fish-audio',{})}]}),credentials:() => ({resolve:async () => ({value:'test-key'})}),fetch:async (url,options) => {
    if (url.endsWith('/model/previous-choice')) {
      calls.push('selected'); assert.equal(options.method,'GET')
      return Response.json({_id:'previous-choice',title:'Selected title',type:'tts',state:'trained',languages:['ja']})
    }
    const query = new URL(url).searchParams; calls.push(query.get('language'))
    assert.equal(options.method,'GET'); assert.equal(query.get('sort_by'),'task_count'); assert.equal(query.get('page_size'),'100')
    await gate
    const language = query.get('language'), voice = (id,count,tags=[]) => ({_id:id,title:id,type:'tts',state:'trained',visibility:'public',languages:[language],tags,task_count:count,like_count:7,samples:[{audio:'https://cdn.example/sample.mp3'}]})
    return Response.json({items:[voice(language+'-low',2),voice(language+'-high',20),...['narration','新闻','朗読','educational','广告'].map((tag,i) => voice('excluded'+i,100,[tag]))]})
  }})
  const input = {language:'ja',selectedVoiceId:'previous-choice'}
  const first = services.listRecommendedFishVoices(input)
  assert.equal(first.refreshing,true); assert.equal(first.voices[0].voiceId,'previous-choice')
  assert.ok(first.voices.slice(1).every(v => v.languages.includes('ja')))
  assert.deepEqual(services.listRecommendedFishVoices(input),first)
  release(); await new Promise(resolve => setTimeout(resolve,20))
  const refreshed = services.listRecommendedFishVoices(input)
  assert.equal(refreshed.refreshing,false); assert.deepEqual(calls,['ja','selected'])
  assert.equal(refreshed.voices[0].name,'Selected title')
  assert.deepEqual(refreshed.voices.map(v => v.voiceId),['previous-choice','ja-high','ja-low'])
  assert.equal(refreshed.voices[1].likeCount,7); assert.equal(refreshed.voices[1].sampleUrl,'https://cdn.example/sample.mp3')
  services.listRecommendedFishVoices(); await new Promise(resolve => setTimeout(resolve,20))
  assert.deepEqual(calls,['ja','selected','zh','ja'])
  assert.equal(services.listRecommendedFishVoices({selectedVoiceId:'previous-choice'}).voices[0].name,'Selected title')
  assert.equal(services.listRecommendedFishVoices().voices.length,4)
})

test('Fish catalogue falls back without a key or after failure, enriching curated metadata only through GET',async () => {
  const noService = createServiceSettings({get:() => ({providers:[]}),fetch:() => assert.fail('no network')})
  assert.equal(noService.listRecommendedFishVoices({language:'zh'}).voices.length,11)
  const calls = [], services = createServiceSettings({get:() => ({providers:[{id:'fish',kind:'fish-audio',config:providerConfig('fish-audio',{})}]}),credentials:() => ({resolve:async () => ({value:'test-key'})}),fetch:async (url,options) => {
    assert.equal(options.method,'GET'); calls.push(url)
    if (url.includes('?')) return new Response('',{status:503})
    const id = url.split('/').at(-1)
    return Response.json({_id:id,title:'Resolved '+id,type:'tts',state:'trained',visibility:'public',languages:['zh'],samples:[{audio:'https://cdn.example/fallback.mp3'}]})
  }})
  const first = services.listRecommendedFishVoices({language:'zh'})
  await new Promise(resolve => setTimeout(resolve,20))
  const result = services.listRecommendedFishVoices({language:'zh'})
  assert.deepEqual(result.voices.map(v => v.voiceId),first.voices.map(v => v.voiceId))
  assert.equal(result.voices[0].sampleUrl,'https://cdn.example/fallback.mp3'); assert.equal(result.refreshing,false); assert.equal(calls.length,12)
})

test('custom endpoints reject URL credentials, queries, cross-origin paths and unsupported parameters',() => {
  for (const url of ['file:///tmp','https://user:password@speech.invalid','https://speech.invalid?token=x','https://speech.invalid/#x']) assert.throws(() => providerConfig('openai-compatible',{url}))
  for (const path of ['https://elsewhere.invalid/models','//elsewhere.invalid/models','/models?key=x','/../models','/x\\models','']) assert.throws(() => providerConfig('openai-compatible',{url:'https://speech.invalid',speechPath:path}))
  assert.equal(config.speechPath,'/v1/audio/speech')
  assert.equal(voicePreset(preset).params.speed,1.1)
  assert.throws(() => presetParams('openai-compatible',{voice:'alloy',model:'tts-1',key:'not-allowed'}))
  assert.throws(() => presetParams('openai-compatible',{voice:'alloy',model:'tts-1',speed:9}))
})

test('custom discovery parses common envelopes and uses only GET; synthesis requests WAV',async () => {
  const calls = [], key = randomUUID(), audio = pcmWav(Buffer.alloc(100,1))
  const adapter = createOpenAICompatibleAdapter({fetch:async (url, options) => {
    calls.push({url,options})
    if (url.endsWith('/models')) return Response.json({data:[{id:'tts-1'}]})
    if (url.endsWith('/voices')) return Response.json({voices:[{voice_id:'alloy',name:'Alloy',languages:['en']}]})
    return new Response(audio)
  }})
  const list = await adapter.voices({config},{key})
  assert.deepEqual(list.models,[{id:'tts-1',label:'tts-1'}]); assert.equal(list.voices[0].id,'alloy')
  assert.equal(calls.every(c => !c.options.method || c.options.method === 'GET'),true)
  assert.equal(calls.every(c => c.options.redirect === 'error' && c.options.headers.Authorization === 'Bearer ' + key),true)
  assert.equal(JSON.stringify(list).includes(key),false)
  assert.deepEqual(await adapter.synthesize({config},{key},{text:'Hello',params:preset.params}),audio)
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{...preset.params,input:'Hello',response_format:'wav'})
  assert.equal(calls.at(-1).url,'https://speech.invalid/v1/audio/speech')
})

test('optional discovery makes no requests; network, HTTP and malformed JSON errors never expose content',async () => {
  const manual = {config:providerConfig('openai-compatible',{url:'https://speech.invalid'})}
  const adapter = createOpenAICompatibleAdapter({fetch:async () => {throw Error('must not call')}})
  assert.deepEqual(await adapter.voices(manual,{}),{models:[],voices:[],source:'manual'})
  const privateValue = randomUUID()
  for (const fetch of [async () => {throw Error(privateValue)},async () => new Response(privateValue,{status:401}),async () => new Response(privateValue),async () => Response.json(null),async () => Response.json({data:[null]})]) {
    await assert.rejects(createOpenAICompatibleAdapter({fetch}).voices({config},{}),e => !e.message.includes(privateValue))
  }
})

test('custom service stores credentials only in existing credential store and roundtrips presets through synthesis',async t => {
  let settings = {enabled:true,providers:[],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const tts = createTts(), store = new Map(), calls = [], key = randomUUID(), audio = pcmWav(Buffer.alloc(100,1))
  const credentials = {resolve:async ref => ({value:store.get(ref)}),describe:async ref => ({configured:store.has(ref),writable:true}),set:async (ref,value) => store.set(ref,value),unset:async ref => store.delete(ref)}
  const services = createServiceSettings({tts,get:() => settings,replace:async next => {settings=next},credentials:() => credentials,fetch:async (url,options) => {
    calls.push(options.method || 'GET')
    return options.method === 'POST' ? new Response(audio) : Response.json({data:[{id:url.endsWith('/models') ? 'tts-1' : 'alloy'}]})
  }})
  t.after(async () => {services.dispose();await tts.dispose()})
  await services.save({id:'custom',kind:'openai-compatible',config,secrets:{key}})
  assert.equal(JSON.stringify(settings).includes(key),false); assert.equal(JSON.stringify(await services.list()).includes(key),false)
  assert.equal((await services.probe({id:'custom',kind:'openai-compatible',config})).status,'connected')
  assert.equal((await services.voices({id:'custom'})).models[0].id,'tts-1')
  assert.equal(calls.includes('POST'),false)
  await services.saveVoicePreset({preset,expectedRevision:null});validateSettings(settings)
  assert.equal((await tts.listServiceVoices()).find(v => v.id === preset.id).state,'ready')
  const {grant} = tts.grantServiceConsumer({principal:'test',scope:'test'})
  const result = await tts.synthesize({voiceId:preset.id,text:'Hello',language:'en'},{grant,scope:'test'})
  assert.deepEqual(await tts.readAudio({key:result.key,grant}),audio)
  assert.equal(calls.filter(c => c === 'POST').length,1)
  assert.equal((await tts.exportVoicePresets([preset.id]))[0].kind,'openai-compatible')
})

test('keyless custom services remain usable without fake voice catalogues',async t => {
  const tts = createTts(); let settings = {providers:[],voices:[]}
  // without list routes the explicit test asks the free GET /v1/models first.
  const calls = []
  const services = createServiceSettings({tts,get:() => settings,replace:async next => {settings=next},credentials:() => undefined,fetch:async (url,options) => {calls.push([options.method || 'GET',new URL(url).pathname]);return Response.json({data:[]})}})
  t.after(async () => {services.dispose();await tts.dispose()})
  const manual = providerConfig('openai-compatible',{url:'http://127.0.0.1:9881'})
  await services.save({id:'custom',kind:'openai-compatible',config:manual})
  assert.equal(calls.length,0,'saving never tests')
  assert.equal((await services.probe({id:'custom',kind:'openai-compatible',config:manual})).status,'connected')
  assert.deepEqual(await services.test({id:'custom'}),{ok:true,status:'connected',voiceCount:0,reachable:true,synthesisTested:false,credentialScope:'catalog'})
  assert.deepEqual(calls,[['GET','/v1/models'],['GET','/v1/models']])
  assert.equal((await tts.health({serviceId:'custom'}))[0].state,'configured')
})

// 测试连接 must really check paid endpoints, with mocked HTTP only.
test('OpenAI-compatible test: free model list first, else one tiny synthesis; provider errors in plain words',async () => {
  const provider = {config:providerConfig('openai-compatible',{url:'https://speech.invalid'})}
  const run = async (models, speech) => { const calls = []; const adapter = createOpenAICompatibleAdapter({fetch:async (url,options) => { calls.push({path:new URL(url).pathname,method:options.method || 'GET',body:options.body,auth:options.headers.Authorization}); return new Response(null,{status:url.endsWith('/v1/models') ? models : speech}) }})
    try { return {result:await adapter.verify(provider,{key:'k'}),calls} } catch (error) { return {error:error.message,calls} } }
  let r = await run(200,500); assert.deepEqual(r.result,{status:'connected'}); assert.equal(r.calls.length,1); assert.equal(r.calls[0].auth,'Bearer k')
  r = await run(401,200); assert.match(r.error,/密钥无效（HTTP 401）/); assert.equal(r.calls.length,1)
  r = await run(404,200); assert.deepEqual(r.result,{status:'connected',synthesisTested:true}); assert.deepEqual(r.calls.map(c => c.method + ' ' + c.path),['GET /v1/models','POST /v1/audio/speech'])
  assert.equal(JSON.parse(r.calls[1].body).input,'嗯','one character only')
  r = await run(404,403); assert.match(r.error,/密钥无效/)
  r = await run(404,404); assert.match(r.error,/找不到合成接口/)
  r = await run(404,422); assert.equal(r.result.status,'reachable')
  const offline = createOpenAICompatibleAdapter({fetch:async () => { throw Error('secret-detail') }})
  await assert.rejects(offline.verify(provider,{key:'k'}),e => /连不上服务/.test(e.message) && !e.message.includes('secret'))
})

test('Volcengine paid check uses V3 API Key and reports speaker refusal, auth and quota failures',async () => {
  const provider = {config:providerConfig('volcengine',{})}, calls = []
  const respond = body => createVolcengineAdapter({fetch:async (url,options) => { calls.push({url,options}); return body() }})
  const ok = respond(() => new Response(JSON.stringify({code:0,data:Buffer.alloc(8).toString('base64')}) + '\n' + JSON.stringify({code:20000000})))
  assert.deepEqual(await ok.verify(provider,{key:'ak'}),{status:'connected',synthesisTested:true})
  assert.equal(calls[0].options.method,'POST'); assert.equal(JSON.parse(calls[0].options.body).req_params.text,'嗯')
  assert.equal(calls[0].options.headers['X-Api-Key'],'ak')
  const speaker = respond(() => Response.json({code:45000000,message:'speaker permission denied'},{status:403}))
  await assert.rejects(speaker.verify(provider,{key:'ak'}),{code:'VOLCENGINE_VOICE_FORBIDDEN'})
  const grant = respond(() => Response.json({code:45000010,message:'grant not found'},{status:401}))
  await assert.rejects(grant.verify(provider,{key:'bad'}),/API Key 无效/)
  const quota = respond(() => new Response(JSON.stringify({code:55000000,message:'quota exceeded'})))
  await assert.rejects(quota.verify(provider,{key:'ak'}),/额度已用完/)
})

test('Qwen discovery only offers Bella-compatible transport models, not instruct or Qwen-Audio',async () => {
  for (const region of ['cn','intl']) {
    const ids = ['qwen3-tts-flash','qwen3-tts-flash-2025-11-27','qwen3-tts-instruct-flash','qwen3-tts-instruct-flash-2026-01-26','qwen-audio-3.1-tts-flash','qwen-audio-3.1-tts-next','qwen-audio-3.0-tts-flash','qwen3-chat','qwen3-tts-flash-realtime']
    const urls = [], adapter = createQwenAdapter({fetch:async url => {urls.push(url);return Response.json({data:ids.map(id => ({id}))})}})
    const result = await adapter.voices({config:{region}},{key:randomUUID()})
    assert.equal(new URL(urls[0]).hostname,region === 'cn' ? 'dashscope.aliyuncs.com' : 'dashscope-intl.aliyuncs.com')
    assert.deepEqual(result.models.map(m => [m.id,m.instruct]),[['qwen3-tts-flash',false],['qwen3-tts-flash-2025-11-27',false]])
    assert.equal(result.modelSource,'live'); assert.ok(result.voices.some(v => v.id === 'Bella'))
  }
})

test('Qwen empty or unsupported-only discovery falls back without offering the unavailable instruct model',async () => {
  for (const ids of [[],['qwen3-tts-instruct-flash','qwen-audio-3.1-tts-flash','qwen-audio-3.1-tts-next']]) {
    const adapter = createQwenAdapter({fetch:async () => Response.json({data:ids.map(id => ({id}))})})
    const result = await adapter.voices({config:{region:'cn'}},{key:'fake'})
    assert.deepEqual(result.models,[{id:'qwen3-tts-flash',label:'Qwen3-TTS Flash',instruct:false}])
    assert.equal(result.modelSource,'builtin')
  }
})

// No owner credentials or network: exercise the figure source through the registered provider.
test('Volcengine figure catalogue, credential storage and synthesis share the existing service', async t => {
  let settings = {enabled:true,providers:[],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const store = new Map(), calls = [], tts = createTts()
  const credentials = {resolve:async ref => ({value:store.get(ref)}),describe:async ref => ({configured:store.has(ref),writable:true}),set:async (ref,value) => store.set(ref,value),unset:async ref => store.delete(ref)}
  let response = () => new Response(JSON.stringify({code:0,data:Buffer.alloc(100).toString('base64')})+'\n'+JSON.stringify({code:20000000}))
  const services = createServiceSettings({tts,get:() => settings,replace:async next => {settings=next},credentials:() => credentials,fetch:async (url,options) => {calls.push({url,options});return response()}})
  t.after(async () => {services.dispose();await tts.dispose()})
  const listing = await services.listOnlinePresetVoices({provider:'volcengine'})
  assert.equal(listing.source,'builtin'); assert.ok(listing.voices.length); assert.equal(calls.length,0)
  await services.save({id:'doubao',kind:'volcengine',config:{resourceId:'seed-tts-2.0'},secrets:{key:'mock-access-key'}})
  assert.equal(JSON.stringify(settings).includes('mock-access-key'),false)
  assert.equal(JSON.stringify(await services.list()).includes('mock-access-key'),false)
  assert.deepEqual(await services.listOnlinePresetVoices({provider:'volcengine',serviceId:'doubao'}),listing)
  assert.equal(calls.length,0,'catalogue does not bill a synthesis to check credentials')
  const {effective} = resolveVoiceSpec({voice:{name:'Test',language:'zh',defaultSource:'online',sources:{online:{kind:'preset',provider:'volcengine',voiceName:listing.voices[0].id}}},binding:{voice:'test'},text:'Hello'})
  assert.equal(effective.voice.params.speaker,listing.voices[0].id)
  tts.registerVoiceSource({owner:'test',sourceId:'figure',revision:'one',voices:[effective.voice],bindings:{voice:'doubao'}})
  const {grant} = tts.grantConsumer({source:'figure',principal:'test',scope:'figure'})
  const synthesize = text => tts.synthesize({voice:{source:'figure',id:'voice'},text,language:'zh'},{grant,scope:'figure'})
  const result = await synthesize('hello')
  assert.equal((await tts.readAudio({key:result.key,grant})).toString('ascii',0,4),'RIFF')
  assert.equal(calls[0].url,'https://openspeech.bytedance.com/api/v3/tts/unidirectional')
  assert.equal(calls[0].options.headers['X-Api-App-Id'],undefined)
  assert.equal(calls[0].options.headers['X-Api-Access-Key'],undefined)
  assert.match(calls[0].options.headers['X-Api-Request-Id'],/^[0-9a-f-]{36}$/)
  const payload = JSON.parse(calls[0].options.body)
  assert.equal(payload.user,undefined)
  assert.equal(typeof payload.req_params.additions,'string')
  assert.deepEqual(JSON.parse(payload.req_params.additions),{})
  assert.equal(payload.req_params.audio_params.format,'pcm')
  assert.equal(payload.req_params.audio_params.sample_rate,24000)
  assert.equal(calls[0].options.headers['X-Api-Key'],'mock-access-key')
  assert.equal(calls[0].options.headers['X-Api-Resource-Id'],'seed-tts-2.0')
  assert.equal(JSON.parse(calls[0].options.body).req_params.speaker,listing.voices[0].id)
  for (const [message,code] of [['grant not found','VOLCENGINE_AUTH_FAILED'],['quota exceeded','VOLCENGINE_QUOTA_EXCEEDED'],['Init Engine Instance failed','VOLCENGINE_RESOURCE_MISMATCH'],['speaker permission denied','VOLCENGINE_VOICE_FORBIDDEN']]) {
    response = () => new Response(JSON.stringify({code:45000000,message:message+' private upstream detail'}))
    await assert.rejects(synthesize(message),{code})
    assert.match(describeTtsError(code),/火山.*请/)
    assert.equal(describeTtsError(code).includes('private upstream detail'),false)
  }
  for (const [upstream,message,code] of [
    [45000000,'quota exceeded for types: concurrency','VOLCENGINE_RATE_LIMITED'],
    [45000000,'payload unmarshal: marshal ws msg body to JSON failed: unmarshal request','VOLCENGINE_INVALID_REQUEST'],
    [45000000,'single request size too large','VOLCENGINE_TEXT_TOO_LONG'],
    [40402003,'TTSExceededTextLimit:exceed max limit','VOLCENGINE_TEXT_TOO_LONG'],
    [45000001,'[Invalid argument] EmptyRequest','VOLCENGINE_INVALID_REQUEST'],
    [45000001,'[Invalid argument] InvalidModel','VOLCENGINE_INVALID_REQUEST'],
    [45000001,'[Invalid argument] speaker not found','VOLCENGINE_INVALID_SPEAKER'],
    [45002000,'TTS invalid speaker','VOLCENGINE_INVALID_SPEAKER'],
    [45002001,'No readable text!','VOLCENGINE_NO_READABLE_TEXT'],
    [55000000,'resource ID is mismatched with speaker related resource','VOLCENGINE_RESOURCE_MISMATCH'],
    [55000000,'Request timeout: synthesis processing timeout','VOLCENGINE_CONNECTION_FAILED'],
    [55000000,'internal error','VOLCENGINE_SERVER_ERROR'],
    [45000000,'unknown detail','VOLCENGINE_REQUEST_FAILED']
  ]) {
    for (const status of [200,400]) {
      response = () => new Response(JSON.stringify({code:upstream,message:message+' private upstream detail'}),{status})
      await assert.rejects(synthesize(`${status} ${message}`),{code})
    }
    assert.match(describeTtsError(code),/火山.*请/)
    assert.equal(describeTtsError(code).includes('private upstream detail'),false)
  }
  for (const [status,code] of [[401,'VOLCENGINE_AUTH_FAILED'],[403,'VOLCENGINE_AUTH_FAILED'],[429,'VOLCENGINE_RATE_LIMITED'],[503,'VOLCENGINE_SERVER_ERROR']]) {
    response = () => new Response('private upstream detail',{status})
    await assert.rejects(synthesize(`http ${status}`),{code})
  }
  response = () => new Response('{broken')
  await assert.rejects(synthesize('broken response'),{code:'VOLCENGINE_INVALID_AUDIO'})
})

test('Volcengine official V3 chunks: metadata, PCM chunks and terminal code; incomplete streams fail', () => {
  const pcm = Buffer.from([1,0,2,0])
  const events = [{code:0,data:pcm.subarray(0,2).toString('base64')},{code:0,data:null,sentence:{text:'test',words:[]}},{code:0,data:pcm.subarray(2).toString('base64')},{code:20000000,message:'ok',data:null,usage:{text_words:4}}]
  for (const stream of [events.map(e=>JSON.stringify(e)).join('\n'),events.map(e=>'event: '+(e.code===20000000?'152':'352')+'\ndata: '+JSON.stringify(e)).join('\n\n')]) {
    const wav = parseVolcengine(stream)
    assert.equal(wav.readUInt32LE(24),24000)
    assert.deepEqual(wav.subarray(44),pcm)
  }
  for (const stream of ['{"code":0,"data":"AQACAA=="}','{"code":20000000}','{"code":0,"data":"!"}\n{"code":20000000}']) assert.throws(()=>parseVolcengine(stream),{code:'VOLCENGINE_INVALID_AUDIO'})
})

test('Volcengine new-console config and official 2.0 curated catalogue require no App ID or discovery request',async () => {
  assert.deepEqual(providerConfig('volcengine',{}),{resourceId:'seed-tts-2.0'})
  const kinds = createServiceSettings({get:()=>({providers:[],voices:[]})}).kinds()
  assert.deepEqual(kinds.find(k=>k.kind==='volcengine').fields.filter(f=>f.secret).map(f=>[f.key,f.required]),[['key',false]])
  assert.equal(kinds.find(k=>k.kind==='volcengine').fields.some(f=>f.key==='appId'),false)
  const catalogue = await createVolcengineAdapter({fetch:()=>{throw Error('must not fetch')}}).catalog()
  assert.equal(catalogue.items[0].id,'zh_female_vv_uranus_bigtts')
  assert.equal(catalogue.items.length,12)
  assert.ok(catalogue.items.every(v=>v.id.endsWith('_uranus_bigtts')))
})
test('keyless custom Fish discovers server models and prepares references only when advertised', async t => {
  const {createServer} = await import('node:http')
  const {createFishAudioAdapter} = await import('../src/providers/fish-audio.js')
  const calls = [], server = createServer((req,res) => {
    calls.push({url:req.url,authorization:req.headers.authorization})
    req.resume()
    if (req.url.endsWith('/v1/info')) {
      res.setHeader('Content-Type','application/json')
      res.end(JSON.stringify({state:'ready',models:[{id:'fixture-model',label:'Fixture model'}],capabilities:req.url.startsWith('/warm/') ? {prepareVoice:true,voiceDirections:true} : {}}))
    } else if (req.url.endsWith('/v1/warm')) { res.writeHead(202); res.end('{}') }
    else { res.setHeader('Content-Type','application/octet-stream'); res.end(Buffer.alloc(8820)) }
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  const adapter = createFishAudioAdapter(), p = prefix => ({id:'custom',kind:'fish-audio',config:{url:base + prefix,model:'fixture-model'}})
  // A configured model must still discover capabilities on the first synthesis.
  await adapter.synthesize(p('/cold'),{},{text:'hello',language:'en',params:{referenceId:'voice'}})
  assert.deepEqual(calls.map(c => c.url),['/cold/v1/info','/cold/v1/tts'])
  calls.length = 0
  const listed = await adapter.voices(p('/warm'),{})
  assert.deepEqual(listed.models,[{id:'fixture-model',label:'Fixture model'}])
  assert.equal(listed.state,'ready')
  assert.equal(listed.source,'live'); assert.equal(listed.models[0].billing,undefined)
  const references = [{bytes:Buffer.from([1,2]),promptText:'Sample'}]
  assert.equal(await adapter.prewarm(p('/warm'),{},{references}),true)
  assert.equal(await adapter.prewarm(p('/plain'),{},{references}),false)
  await adapter.synthesize(p('/warm'),{},{text:'hello',language:'en',params:{},references})
  assert.equal(calls.filter(c => c.url.endsWith('/v1/warm')).length,1)
  assert.equal(calls.filter(c => c.url.endsWith('/v1/tts')).length,1)
  assert.ok(calls.every(c => c.authorization === undefined))
})

test('custom Fish with a configured model synthesizes without info and retries discovery', async () => {
  const {createFishAudioAdapter} = await import('../src/providers/fish-audio.js')
  const calls = []
  let available = false
  const adapter = createFishAudioAdapter({fetch:async (url, options) => {
    const route = new URL(url).pathname
    calls.push(route)
    if (route === '/v1/info') return available
      ? Response.json({models:[{id:'fixture-model'}],capabilities:{prepareVoice:true}})
      : new Response('',{status:404})
    assert.equal(options.headers.model,'fixture-model')
    return new Response(route === '/v1/tts' ? Buffer.alloc(8820) : '{}')
  }})
  const provider = {config:{url:'http://fixture.invalid',model:'fixture-model'}}
  const spec = {text:'hello',language:'en',params:{referenceId:'voice'}}
  await adapter.synthesize(provider,{},spec)
  await adapter.synthesize(provider,{},spec)
  assert.deepEqual(calls,['/v1/info','/v1/tts','/v1/info','/v1/tts'])
  await assert.rejects(adapter.synthesize({config:{url:provider.config.url}},{},spec),{code:'VOICE_NOT_FOUND'})
  available = true
  assert.equal(await adapter.prewarm(provider,{},{references:[{bytes:Buffer.from([1,2]),promptText:'Sample'}]}),true)
  assert.deepEqual(calls.slice(-2),['/v1/info','/v1/warm'])
})

test('custom Fish never inherits a cloud environment key or cloud catalogue', async t => {
  const previous = process.env.FISH_AUDIO_API_KEY
  process.env.FISH_AUDIO_API_KEY = 'cloud-fixture-only'
  t.after(() => { if (previous === undefined) delete process.env.FISH_AUDIO_API_KEY; else process.env.FISH_AUDIO_API_KEY = previous })
  const tts = createTts(), settings = {providers:[{id:'custom',kind:'fish-audio',config:{url:'http://fixture.invalid',model:'server-model'}}],voices:[]}, calls = []
  const services = createServiceSettings({tts,get:() => settings,credentials:() => null,fetch:async(url,options) => {
    calls.push({url,headers:options.headers})
    return Response.json({models:[{id:'server-model'}],capabilities:{}})
  }})
  t.after(async () => {services.dispose();await tts.dispose()})
  services.sync()
  assert.equal((await services.list())[0].secrets.key.configured,false)
  assert.deepEqual(services.listRecommendedFishVoices({serviceId:'custom'}).voices,[])
  const result = await services.probe({id:'custom',kind:'fish-audio',config:settings.providers[0].config})
  assert.equal(result.status,'connected'); assert.equal(result.models[0].id,'server-model')
  assert.ok(calls.every(c => c.headers.Authorization === undefined && c.url.endsWith('/v1/info')))
})

test('keyless Fish cloud rejection remains an actionable authentication error, not a local credential gate', async () => {
  const {createFishAudioAdapter} = await import('../src/providers/fish-audio.js')
  const adapter = createFishAudioAdapter({fetch:async (_url,options) => {
    assert.equal(options.headers.Authorization,undefined)
    return new Response('',{status:401})
  }})
  await assert.rejects(adapter.synthesize({config:{url:'https://api.fish.audio',model:'s2.1-pro-free'}},{},{text:'hello',language:'en',params:{referenceId:'fixture'}}),{code:'FISH_AUTH_FAILED'})
})

test('a pack voice source picks its own service instance; no global default service exists', async t => {
  const tts = createTts()
  t.after(() => tts.dispose())
  for (const id of ['cloud','custom']) tts.registerProvider('test',{id,kind:'fish-audio',revision:'one',capabilities:{voiceKinds:['reference']},synthesize:async () => assert.fail('no synthesis')})
  const voice = {defaultSource:'pool',sources:{pool:{provider:'fish-audio',kind:'reference-list',serviceId:'custom',references:[{media:'a'.repeat(64),text:'',language:'ja'}]}}}, binding = {voice:'figure'}
  assert.equal((await tts.resolveVoiceService({voice,binding},{readOnly:true})).effective.serviceId,'custom')
  voice.sources.pool = {provider:'fish-audio',kind:'voice-id',voiceId:'cloud-only',serviceId:'cloud'}
  assert.equal((await tts.resolveVoiceService({voice,binding},{readOnly:true})).effective.serviceId,'cloud')
  assert.equal((await tts.listServices()).some(s => 'isDefault' in s),false)
})
test('empty authentication is omitted across Azure, Qwen and Volcengine',async () => {
  const {createAzureAdapter} = await import('../src/providers/azure.js')
  const calls = [], fetch = async (url,options) => {calls.push({url,headers:options.headers}); return new Response('{}',{status:401})}
  await assert.rejects(createAzureAdapter({fetch}).catalog({config:{region:'eastasia'}},{}),/密钥/)
  await assert.rejects(createQwenAdapter({fetch}).probe({config:{region:'cn'}},{}),{code:'QWEN_AUTH_FAILED'})
  await assert.rejects(createVolcengineAdapter({fetch}).verify({config:{resourceId:'seed-tts-2.0'}},{}))
  assert.ok(calls.length >= 3)
  for (const c of calls) assert.ok(Object.keys(c.headers).every(k => !/authorization|subscription-key|api-key/i.test(k)))
})

test('saving a service permits empty keys without a credential store; deleting one in use needs force',async t => {
  let settings = {enabled:true,providers:[],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const tts = createTts()
  const services = createServiceSettings({tts,get:() => settings,replace:async v => {settings=v},credentials:() => null})
  t.after(async () => {services.dispose();await tts.dispose()})
  tts.registerUsageSource({owner:'packs',inspect:async serviceId => ({serviceId,count:1})})
  await services.save({id:'custom',kind:'fish-audio',config:{url:'http://fixture.invalid',model:'server-model'},secrets:{key:''}})
  assert.equal('defaultServiceId' in settings,false)
  const expectedRevision = (await services.list())[0].revision
  await assert.rejects(services.delete({id:'custom',expectedRevision}),{code:'SERVICE_IN_USE'})
  await services.delete({id:'custom',expectedRevision,force:true})
  assert.deepEqual(settings.providers,[])
})

test('the voice services catalog lists saved services and 浏览器朗读 without keys, URLs or config',async t => {
  let settings = {enabled:true,providers:[],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const tts = createTts(), events = []
  // the self-hosted Fish server has no /v1/info: its provider reports reference audio only.
  const fetch = async () => new Response('',{status:404})
  const services = createServiceSettings({tts,fetch,get:() => settings,replace:async v => {settings=v},credentials:() => null,changed:() => events.push('servicesChanged')})
  t.after(async () => {services.dispose();await tts.dispose()})
  const empty = await services.voiceServices()
  assert.deepEqual(empty.services.map(s => s.kind),['browser'])
  assert.equal(empty.kinds.minimax,'MiniMax')
  await services.save({id:'mm-a',kind:'minimax',label:'我的 MiniMax',config:{groupId:'group-private'},secrets:{key:''}})
  await services.save({id:'local-fish',kind:'fish-audio',config:{url:'http://fixture.invalid',model:'server-model'},secrets:{key:''}})
  assert.ok(events.includes('servicesChanged'))
  const {services:rows} = await services.voiceServices()
  assert.deepEqual(rows.map(s => [s.id,s.kind,s.label,s.state,s.voiceList,s.sources.join('+')]),[
    ['mm-a','minimax','我的 MiniMax','needs-key','preset','preset'],
    ['local-fish','fish-audio','local-fish','configured','provider','reference-list'],
    ['browser','browser','浏览器朗读','ready','browser','preset']])
  assert.doesNotMatch(JSON.stringify(rows),/group-private|fixture\.invalid|"config"/)
})

// 配音来源 are the provider's answer per service instance: the same Fish protocol backs the official cloud (声音库 included)
// and self-hosted servers, which say in /v1/info whether they serve a voice library.
test('the catalog lists each service with the 配音来源 its provider reports, asking a self-hosted server once per config',async t => {
  let settings = {enabled:true,providers:[],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const tts = createTts(), asked = []
  const info = library => ({models:[{id:'drama-3'}],state:'ready',capabilities:{prepareVoice:true,...(library ? {voiceLibrary:true} : {})}})
  const fetch = async url => { asked.push(String(url)); return Response.json(info(String(url).includes('library.invalid'))) }
  const services = createServiceSettings({tts,fetch,get:() => settings,replace:async v => {settings=v},credentials:() => null})
  t.after(async () => {services.dispose();await tts.dispose()})
  await services.save({id:'fish',kind:'fish-audio',label:'Fish Audio',config:{url:'https://api.fish.audio',model:'s2.1-pro-free'},secrets:{key:''}})
  await services.save({id:'fish-local',kind:'fish-audio',label:'Fish Audio（本地）',config:{url:'http://local.invalid',model:'drama-3'},secrets:{key:''}})
  await services.save({id:'fish-lib',kind:'fish-audio',config:{url:'http://library.invalid',model:'drama-3'},secrets:{key:''}})
  await services.save({id:'qwen',kind:'qwen',config:{region:'cn'},secrets:{key:''}})
  const sources = async () => Object.fromEntries((await services.voiceServices()).services.map(s => [s.id,s.sources.join('+')]))
  const expected = {fish:'reference-list+voice-id','fish-local':'reference-list','fish-lib':'reference-list+voice-id',qwen:'preset',browser:'preset'}
  assert.deepEqual(await sources(),expected)
  assert.deepEqual(await sources(),expected)
  // the cloud is not asked; each self-hosted server once (its answer is cached per service config).
  assert.deepEqual(asked.sort(),['http://library.invalid/v1/info','http://local.invalid/v1/info'])
})

test('another plugin\'s provider is listed with the 配音来源 it declares; one declaring none is not a voice service',async t => {
  let settings = {enabled:true,providers:[],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const tts = createTts()
  const services = createServiceSettings({tts,get:() => settings,replace:async v => {settings=v},credentials:() => null})
  t.after(async () => {services.dispose();await tts.dispose()})
  let discovered = 0
  const plugin = (id,capabilities,extra = {}) => tts.registerProvider('voice-plugin',{id,kind:'reference',revision:'1',capabilities,synthesize:async () => assert.fail('no synthesis'),...extra})
  plugin('clone-box',{paid:false},{label:'克隆盒',discover:async function () { discovered++; this.capabilities.voiceSources = ['reference-list'] }})
  plugin('speaker-box',{voiceSources:['preset','voice-id'],voiceList:'provider',billing:'paid'})
  plugin('synth-only',{})
  const rows = (await services.voiceServices()).services.filter(s => s.kind !== 'browser')
  assert.deepEqual(rows.map(s => [s.id,s.kind,s.label,s.billing,s.voiceList,s.sources.join('+')]),[
    ['clone-box','reference','克隆盒','free','provider','reference-list'],
    ['speaker-box','reference','speaker-box','paid','provider','preset+voice-id']])
  assert.equal(discovered,1)
})