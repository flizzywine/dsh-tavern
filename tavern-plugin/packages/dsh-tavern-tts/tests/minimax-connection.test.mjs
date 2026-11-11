import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServiceSettings } from '../src/settings.js'
import { createMinimaxAdapter } from '../src/providers/minimax.js'

const invalid = 'API Key 无效：请确认是中国版（api.minimaxi.com）还是国际版（api.minimax.io）的 API Key，并填对 Base URL'
test('MiniMax connection uses live free listing, rejects HTTP 200 errors, and decodes synthesis hex', async t => {
  let body = {base_resp:{status_code:2049,status_msg:'invalid api key'}}, paths = []
  const server = createServer((req,res) => { paths.push(req.url); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(body)) })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const provider = {id:'mm',kind:'minimax',config:{url:`http://127.0.0.1:${server.address().port}`}}
  const services = createServiceSettings({get:()=>({enabled:true,providers:[provider],voices:[]}),replace:async()=>{},credentials:()=>({resolve:async()=>({value:'test-key'})}),tts:{}})
  t.after(()=>services.dispose())
  let result = await services.test({id:'mm'})
  assert.equal(result.ok,false)
  assert.equal(result.voiceCount,0)
  assert.equal(result.message,invalid)
  body = {base_resp:{status_code:0},system_voice:[{voice_id:'female-shaonv',voice_name:'少女'},{voice_id:'other',voice_name:'其他'}]}
  result = await services.test({id:'mm'})
  assert.equal(result.ok,true)
  assert.equal(result.voiceCount,2)
  assert.deepEqual(paths,['/v1/get_voice','/v1/get_voice'])
  body = {base_resp:{status_code:1234,status_msg:'service unavailable test-key'}}
  result = await services.test({id:'mm'})
  assert.equal(result.ok,false)
  assert.equal(result.message,'service unavailable [redacted]')
  const adapter = createMinimaxAdapter(), spec = {text:'你好',params:{voice:'female-shaonv'}}
  body = {base_resp:{status_code:1008,status_msg:'insufficient balance'}}
  await assert.rejects(adapter.synthesize(provider,{key:'test-key'},spec), {message:'账户余额不足'})
  body = {base_resp:{status_code:2049,status_msg:'invalid api key'}}
  await assert.rejects(adapter.synthesize(provider,{key:'test-key'},spec), {message:invalid})
  body = {base_resp:{status_code:0},data:{audio:'01000200'}}
  const audio = await adapter.synthesize(provider,{key:'test-key'},spec)
  assert.deepEqual(audio.subarray(44),Buffer.from('01000200','hex'))
})
