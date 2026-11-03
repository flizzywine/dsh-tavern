import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const source = await readFile(new URL('../src/client.js',import.meta.url),'utf8')
async function mount(fetch, globals = {}) {
  const exports = {}, effects = [], provided = new Map()
  let events
  class EventSource { constructor() {events = this} close() {this.closed = true} }
  vm.runInNewContext(source,{exports,require:() => ({createElement:() => null}),fetch,EventSource,AbortController,Date,Set,setTimeout,clearTimeout,...globals})
  exports.apply({provide:(key,value) => {provided.set(key,value);return () => provided.delete(key)},effect:fn => effects.push(fn()),inject:() => {},slots:{inject:() => {}}})
  assert.equal(provided.has('ttsClient'),false)
  const enabled = async value => {events.onmessage({data:JSON.stringify({enabled:value})});await Promise.resolve()}
  await enabled(true)
  return {client:provided.get('ttsClient'),provided,enabled,events,dispose:() => effects.forEach(fn => fn())}
}
const response = body => ({ok:true,json:async () => body})
test('tts client submits scoped synthesis, polls and reads ticket audio only through dsh-tavern-tts', async () => {
  const calls = [], {client,dispose} = await mount(async (url,options) => {
    calls.push({url,options})
    if (url.endsWith('/synthesis')) return response({requestId:'request'})
    if (url.includes('/audio?')) return {ok:true,blob:async () => ({size:42})}
    return response({state:'ready',result:{key:'hash',ticket:'ticket'}})
  })
  const result = await client.synthesize({voice:{source:'pack-test',id:'voice'},text:'hello',language:'ja'},{scope:'session-test',priority:'call'})
  assert.equal(result.ticket,'ticket'); assert.equal((await client.audio(result.ticket)).size,42)
  assert.equal(JSON.parse(calls[0].options.body).scope,'session-test')
  assert.equal(JSON.parse(calls[0].options.body).priority,'call')
  assert.ok(calls.every(call => call.url.startsWith('/api/dsh-tts/v1/')))
  assert.ok(calls.every(call => call.options.credentials === 'same-origin'))
  assert.ok(calls.some(call => call.url.includes('/synthesis/status?') && call.url.endsWith('&wait=1') && call.options.method !== 'DELETE'))
  let stopped = false; client.subscribe(() => { stopped = true }); dispose()
  assert.equal(client.available(),false); assert.equal(stopped,true)
  await assert.rejects(client.audio('ticket'),{code:'PLUGIN_UNAVAILABLE'})
})
test('HTTP failure status survives job polling, submission and audio requests', async () => {
  for (const phase of ['poll','submit','audio']) {
    const {client,dispose}=await mount(async url=>{
      if (url.endsWith('/synthesis')) return phase==='submit' ? {ok:false,status:429,json:async()=>({error:'REQUEST_FAILED'})} : response({requestId:'request'})
      if (url.includes('/audio?')) return {ok:false,status:503}
      return response({state:'error',error:'PROVIDER_FAILURE',status:400})
    })
    try {
      await assert.rejects(phase==='audio' ? client.audio('ticket') : client.synthesize({text:'hello'}),{status:phase==='poll'?400:phase==='submit'?429:503})
    } finally {dispose()}
  }
})

test('abort or plugin disposal during late submission cancels the acknowledged job without audio', async () => {
  for (const disable of ['abort','dispose']) {
    let release; const requests = [], {client,dispose} = await mount((url,options) => {
      requests.push({url,options})
      if (url.endsWith('/synthesis')) return new Promise(resolve => { release = () => resolve(response({requestId:'late'})) })
      return Promise.resolve(response({cancelled:true}))
    })
    const abort = new AbortController(), pending = client.synthesize({voice:{source:'pack-test',id:'voice'},text:'hello'},{scope:'session-test',signal:abort.signal})
    if (disable === 'abort') abort.abort(); else dispose()
    release(); await assert.rejects(pending,{code:'ABORTED'})
    assert.ok(requests.some(r => r.options.method === 'DELETE' && r.url.endsWith('requestId=late')))
    assert.ok(!requests.some(r => r.url.includes('/audio?')))
    dispose()
  }
})

test('disabled clients are unprovided, stale requests reject, and re-enabling registers again', async () => {
  const fixture = await mount(async () => response({}))
  const events = []; fixture.client.subscribe(e => events.push(e.type))
  assert.equal('onEnabledChange' in fixture.client,false)
  assert.equal('enabled' in fixture.client,false)
  await fixture.enabled(false)
  assert.equal(fixture.provided.has('ttsClient'),false)
  assert.equal(fixture.client.available(),false)
  assert.deepEqual(events,['unavailable'])
  await assert.rejects(fixture.client.synthesize({}),{code:'TTS_DISABLED'})
  await assert.rejects(fixture.client.audio('old-ticket'),{code:'TTS_DISABLED'})
  await fixture.enabled(true)
  assert.equal(fixture.provided.get('ttsClient').available(),true)
  fixture.events.onerror()
  assert.equal(fixture.provided.has('ttsClient'),false)
  await fixture.enabled(true)
  fixture.dispose(); assert.equal(fixture.events.closed,true)
  assert.equal(fixture.provided.has('ttsClient'),false)
})

test('client keeps the normal pending job through the host-provided cold-start budget',async()=>{
  let now=0,polls=0
  const {client,dispose}=await mount(async(url,options)=>{
    if(url.endsWith('/synthesis'))return response({requestId:'cold',timeoutMs:245000})
    if(options.method==='DELETE')return response({cancelled:true})
    polls++;if(polls===1){now=130000;return response({state:'running'})}
    return response({state:'ready',result:{ticket:'warm-audio'}})
  },{Date:{now:()=>now},setTimeout:(fn,ms)=>ms===200?fn():setTimeout(fn,ms)})
  assert.equal((await client.synthesize({voice:{source:'fixture',id:'voice'},text:'hello'},{scope:'test'})).ticket,'warm-audio')
  assert.equal(polls,2);dispose()
})

test('stalled requests abort with a typed Chinese timeout and preserve server recovery messages',async()=>{
  const {client,dispose}=await mount(async(_url,{signal})=>({ok:true,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}),{setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,10))})
  try {await assert.rejects(client.synthesize({text:'hello'}),e=>e.code==='TIMEOUT'&&e.message.includes('重新载入'))} finally {dispose()}
  const failed=await mount(async()=>({ok:false,status:400,json:async()=>({error:'CREDENTIALS_REQUIRED',message:'请在设置中填写密钥。'})}))
  try {await assert.rejects(failed.client.synthesize({text:'hello'}),{code:'CREDENTIALS_REQUIRED',message:'请在设置中填写密钥。',status:400})} finally {failed.dispose()}
})
