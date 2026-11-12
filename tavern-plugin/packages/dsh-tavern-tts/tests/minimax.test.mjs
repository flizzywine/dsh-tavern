// MiniMax T2A v2, ported from upstream speech.js. All HTTP is stubbed; no paid calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMinimaxAdapter } from '../src/providers/minimax.js'
import { providerConfig, presetParams, PROVIDER_KINDS, credentialRef } from '../src/providers/params.js'
import { createServiceSettings } from '../src/settings.js'
import { wav } from '../src/core.js'

const provider = {id:'minimax',kind:'minimax',config:providerConfig('minimax',{groupId:'g-1'})}
const pcm = Buffer.alloc(64, 1).toString('hex')
const reply = body => new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})

test('minimax sends the upstream T2A v2 body and maps voice, model and mood', async () => {
  const calls = [], adapter = createMinimaxAdapter({fetch:async (url, options) => { calls.push({url,options}); return reply({data:{audio:pcm},base_resp:{status_code:0}}) }})
  const audio = await adapter.synthesize(provider,{key:'secret'},{text:'你好',language:'zh',mood:'joy',params:presetParams('minimax',{voice:'female-yujie'})})
  assert.equal(calls[0].url,'https://api.minimaxi.com/v1/t2a_v2?GroupId=g-1')
  assert.equal(calls[0].options.headers.Authorization,'Bearer secret')
  assert.deepEqual(JSON.parse(calls[0].options.body),{model:'speech-02-hd',text:'你好',stream:false,
    voice_setting:{voice_id:'female-yujie',speed:1,vol:1,pitch:0,emotion:'happy'},audio_setting:{format:'pcm',sample_rate:32000,channel:1}})
  wav(audio)
  assert.equal(audio.readUInt32LE(24),32000)
  // A voice's own model and an explicit emotion win; an unmapped mood speaks neutral.
  await adapter.synthesize(provider,{key:'secret'},{text:'嗯',mood:'calm',params:presetParams('minimax',{voice:'v',model:'speech-02-turbo'})})
  await adapter.synthesize(provider,{key:'secret'},{text:'嗯',mood:'joy',params:presetParams('minimax',{voice:'v',emotion:'sad'})})
  const [, turbo, explicit] = calls.map(c => JSON.parse(c.options.body))
  assert.equal(turbo.model,'speech-02-turbo'); assert.equal(turbo.voice_setting.emotion,'neutral')
  assert.equal(explicit.voice_setting.emotion,'sad')
  // A service saved before the model moved to the figure: a source without its own model speaks the saved one (read old, write new).
  await adapter.synthesize({...provider,config:{...provider.config,model:'speech-01-hd'}},{key:'secret'},{text:'嗯',params:presetParams('minimax',{voice:'v'})})
  assert.equal(JSON.parse(calls.at(-1).options.body).model,'speech-01-hd')
})

test('minimax failures come back as readable Chinese messages with stable codes', async () => {
  const cases = [
    [reply({base_resp:{status_code:1004,status_msg:'auth failed'}}),'MINIMAX_AUTH_FAILED'],
    [reply({base_resp:{status_code:1008}}),'MINIMAX_BALANCE_REQUIRED'],
    [reply({base_resp:{status_code:1002}}),'MINIMAX_RATE_LIMITED'],
    [new Response('{}',{status:401}),'MINIMAX_AUTH_FAILED'],
    [reply({base_resp:{status_code:0},data:{}}),'MINIMAX_INVALID_AUDIO'],
  ]
  for (const [response, code] of cases) {
    const adapter = createMinimaxAdapter({fetch:async () => response})
    await assert.rejects(adapter.synthesize(provider,{key:'k'},{text:'x',params:{voice:'v'}}),error => error.code === code && /[\u3400-\u9fff]/.test(error.message) && !error.message.includes('auth failed'))
  }
  const offline = createMinimaxAdapter({fetch:async () => { throw new Error('ECONNREFUSED https://api.minimaxi.com') }})
  await assert.rejects(offline.synthesize(provider,{key:'k'},{text:'x',params:{voice:'v'}}),error => error.code === 'MINIMAX_CONNECTION_FAILED' && !error.message.includes('ECONNREFUSED'))
})

test('minimax is a paid service kind with a key credential; 测试连接 and the figure voice list read the same account voices', async () => {
  const kind = PROVIDER_KINDS.find(k => k.kind === 'minimax')
  assert.equal(kind.paid,true); assert.ok(kind.fields.some(f => f.key === 'key' && f.secret))
  assert.equal(credentialRef('minimax','key'),'DSH_TAVERN_TTS_MINIMAX_KEY')
  assert.deepEqual(providerConfig('minimax',{}),{url:'https://api.minimaxi.com'},'the model belongs to the figure, not the connection')
  assert.deepEqual(providerConfig('minimax',{model:'speech-02-hd'}),{url:'https://api.minimaxi.com'})
  assert.deepEqual(kind.voice,['model','voice'])
  assert.throws(() => providerConfig('minimax',{url:'https://u:p@api.minimaxi.com'}))
  const calls = [], registered = []
  // 300+ in a real account; the older Chinese voices carry no language prefix, the newer ones name it.
  const voices = [{voice_id:'female-shaonv',voice_name:'少女'},{voice_id:'Japanese_IntellectualSenior',voice_name:'Intellectual Senior'},{voice_id:'Chinese (Mandarin)_News_Anchor',voice_name:'新闻女声',description:['一位专业、播音腔的中年女性新闻主播，标准普通话。']},
    ...Array.from({length:300},(_, i) => ({voice_id:'English_voice_' + i,voice_name:'Voice ' + i}))]
  const settings = {enabled:true,providers:[provider],voices:[]}
  const services = createServiceSettings({get:() => settings,replace:async () => {},credentials:() => ({resolve:async () => ({value:'k'}),describe:async () => ({configured:true})}),
    fetch:async (url, options) => { calls.push({url,body:JSON.parse(options.body)}); return reply({base_resp:{status_code:0},system_voice:voices,voice_cloning:[{voice_id:'my-clone-1',description:[]}]}) },
    tts:{registerProvider:(_owner, port) => { registered.push(port); return () => {} },registerVoiceSource:() => ({replace() {},dispose() {}}),providerVoiceSources:async () => []}})
  const result = await services.test({id:'minimax'})
  assert.equal(result.ok,true); assert.equal(result.voiceCount > 0,true)
  assert.equal(result.voiceCount,304)
  assert.deepEqual(calls.map(c => [new URL(c.url).pathname,c.body]),[['/v1/get_voice',{voice_type:'all'}]])
  services.sync()
  assert.equal(registered[0].kind,'minimax'); assert.equal(registered[0].capabilities.billing,'paid'); assert.equal(registered[0].capabilities.paid,true)
  // The picker answers at once and reads the account's list in the background (refreshing until it lands).
  const first = await services.listOnlinePresetVoices({provider:'minimax'})
  assert.equal(first.refreshing,true); assert.deepEqual(first.models.map(m => m.id).slice(0,1),['speech-02-hd'])
  let listing = first
  for (let i = 0; i < 50 && listing.refreshing; i++) { await new Promise(r => setTimeout(r,5)); listing = await services.listOnlinePresetVoices({provider:'minimax'}) }
  assert.equal(listing.voices.length,result.voiceCount,'the figure picker lists what 测试连接 counted')
  assert.deepEqual(listing.voices.slice(0,3).map(v => [v.id,v.label,v.languages]),[['female-shaonv','少女',['zh']],['Japanese_IntellectualSenior','Intellectual Senior',['ja']],['Chinese (Mandarin)_News_Anchor','新闻女声',['zh']]])
  assert.equal(listing.voices[2].description,'一位专业、播音腔的中年女性新闻主播，标准普通话。','MiniMax own description is kept (searched and shown); an empty one is left out')
  assert.deepEqual(listing.voices.at(-1),{id:'my-clone-1',label:'my-clone-1',languages:[],mine:true},'the account clones are listed too, marked as the account own and tied to no language')
  assert.equal(presetParams('minimax',{voice:'Chinese (Mandarin)_News_Anchor'}).voice,'Chinese (Mandarin)_News_Anchor')
  const catalog = await services.voiceServices()
  assert.deepEqual(catalog.services.find(s => s.id === 'minimax').models.map(m => m.id),listing.models.map(m => m.id))
  services.dispose()
})

test('a pasted voice id goes to T2A as it is (an unknown one says so when spoken); a read that fails says why instead of listing nothing quietly', async () => {
  let reply2 = () => reply({base_resp:{status_code:0},system_voice:[{voice_id:'female-shaonv',voice_name:'少女'}],voice_cloning:[{voice_id:'my-clone-1'}],voice_generation:[{voice_id:'designed-7',voice_name:'设计音色'}]})
  const settings = {enabled:true,providers:[provider],voices:[]}
  const services = createServiceSettings({get:() => settings,replace:async () => {},credentials:() => ({resolve:async () => ({value:'k'}),describe:async () => ({configured:true})}),
    fetch:async () => reply2(),
    tts:{registerProvider:() => () => {},registerVoiceSource:() => ({replace() {},dispose() {}}),providerVoiceSources:async () => []}})
  // the saved voice goes to T2A as the request's voice_id
  const bodies = [], adapter = createMinimaxAdapter({fetch:async (_url, options) => { bodies.push(JSON.parse(options.body)); return reply({data:{audio:pcm},base_resp:{status_code:0}}) }})
  await adapter.synthesize(provider,{key:'k'},{text:'x',params:presetParams('minimax',{voice:'my-clone-1'})})
  assert.equal(bodies[0].voice_setting.voice_id,'my-clone-1')
  // MiniMax: 2054 voice_id 不存在, 2042 not this account's voice.
  for (const status of [2054, 2042]) await assert.rejects(createMinimaxAdapter({fetch:async () => reply({base_resp:{status_code:status}})}).synthesize(provider,{key:'k'},{text:'x',params:{voice:'nope'}}),error => error.code === 'MINIMAX_VOICE_NOT_FOUND' && /[\u3400-\u9fff]/.test(error.message))
  // a failed read: no key voices, the message names the cause, and the next open asks again
  reply2 = () => reply({base_resp:{status_code:1004,status_msg:'auth failed'}})
  const settle = async () => { let r; for (let i = 0; i < 50; i++) { r = await services.listOnlinePresetVoices({provider:'minimax'}); if (!r.refreshing) return r; await new Promise(x => setTimeout(x,5)) } return r }
  await settle()
  const failed = await settle()
  assert.deepEqual(failed.voices,[]); assert.match(failed.message,/API Key 无效/); assert.doesNotMatch(failed.message,/已保留可选/)
  reply2 = () => reply({base_resp:{status_code:0},system_voice:[{voice_id:'female-shaonv',voice_name:'少女'}]})
  const now = Date.now; Date.now = () => now() + 4000
  try { assert.equal((await settle()).voices.length,1) } finally { Date.now = now }
  services.dispose()
})