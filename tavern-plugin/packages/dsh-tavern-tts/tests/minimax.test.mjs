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
    await assert.rejects(adapter.synthesize(provider,{key:'k'},{text:'x',params:{voice:'v'}}),error => error.code === code && /MiniMax/.test(error.message) && /[\u3400-\u9fff]/.test(error.message) && !error.message.includes('auth failed'))
  }
  const offline = createMinimaxAdapter({fetch:async () => { throw new Error('ECONNREFUSED https://api.minimaxi.com') }})
  await assert.rejects(offline.synthesize(provider,{key:'k'},{text:'x',params:{voice:'v'}}),error => error.code === 'MINIMAX_CONNECTION_FAILED' && !error.message.includes('ECONNREFUSED'))
})

test('minimax is a paid service kind with a key credential, a free connection check and a builtin voice list', async () => {
  const kind = PROVIDER_KINDS.find(k => k.kind === 'minimax')
  assert.equal(kind.paid,true); assert.ok(kind.fields.some(f => f.key === 'key' && f.secret))
  assert.equal(credentialRef('minimax','key'),'DSH_TAVERN_TTS_MINIMAX_KEY')
  assert.deepEqual(providerConfig('minimax',{}),{url:'https://api.minimaxi.com',model:'speech-02-hd'})
  assert.throws(() => providerConfig('minimax',{url:'https://u:p@api.minimaxi.com'}))
  const calls = [], registered = []
  const settings = {enabled:true,defaultServiceId:'',providers:[provider],voices:[]}
  const services = createServiceSettings({get:() => settings,replace:async () => {},credentials:() => ({resolve:async () => ({value:'k'}),describe:async () => ({configured:true})}),
    fetch:async (url, options) => { calls.push({url,body:JSON.parse(options.body)}); return reply({base_resp:{status_code:0}}) },
    tts:{registerProvider:(_owner, port) => { registered.push(port); return () => {} },registerVoiceSource:() => ({replace() {},dispose() {}}),serviceDefaultsChanged() {}}})
  const result = await services.test({id:'minimax'})
  assert.equal(result.ok,true); assert.equal(result.voiceCount > 0,true)
  assert.deepEqual(calls.map(c => [new URL(c.url).pathname,c.body]),[['/v1/get_voice',{voice_type:'system'}]])
  services.sync()
  assert.equal(registered[0].kind,'minimax'); assert.equal(registered[0].capabilities.billing,'paid'); assert.equal(registered[0].capabilities.paid,true)
  assert.equal((await services.listOnlinePresetVoices({provider:'minimax'})).voices[0].id,'female-shaonv')
  services.dispose()
})
