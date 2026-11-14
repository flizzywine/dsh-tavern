import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { nativeSettingsProfile } from '../../../../tests/fixtures/native-settings-profile.mjs'
import * as ttsPlugin from '../src/index.js'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { registerRoutes } from '../src/routes.js'
import { createCache } from '../src/cache.js'
import { pcmWav } from '../src/providers/audio.js'
import { providerConfig } from '../src/providers/params.js'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const tick=() => new Promise(r => setTimeout(r,20))
async function until(predicate) {
  const deadline=Date.now()+3000
  while (!await predicate()) {
    if (Date.now()>=deadline) assert.fail('Native settings transition did not complete')
    await tick()
  }
}
async function profile(t, {legacy, dataDir, settings=true, setup, initialOverrides}={}) {
  const routes=new Map()
  const f=await nativeSettingsProfile(t,{ownerUrl:new URL('../src/index.js',import.meta.url).href,ownerId:'tts',ownerConfig:{profileId:'test',...(dataDir ? {dataDir}: {})},settings,legacy,initialOverrides,
    setup(ctx){ctx.provide('connection',{fetch:{register(route){routes.set(route.path,route);return () => routes.delete(route.path)}}});setup?.(ctx)}})
  if (settings) await until(() => f.ctx.get('settings').describe().filter(row => row.ns === 'tts').every(row => row.value.forkSettingsImported===1))
  await tick()
  return {...f,value:(id)=>f.value(id) ?? {enabled:true},routes,plugin:{dispose:()=>f.setEnabled('tts',false)}}
}
test('real Cordis mounts the tts service, settings and authenticated routes; unload removes them',async t => {
  const f=await profile(t),{ctx,routes}=f
  const a=f.plugin
  await tick()
  assert.equal(ctx.get('tts')?.apiVersion,1)
  assert.ok(routes.has('/api/dsh-tts/v1/control'))
  assert.equal(f.value('tts').enabled,true)
  assert.deepEqual(ctx.get('settings').describe().map(s => s.ns),['tts'])
  await f.update('tts',{enabled:false});await tick()
  assert.equal(ctx.get('tts'),undefined)
  await f.update('tts',{enabled:true});await tick()
  await a.dispose();await tick();assert.equal(routes.size,0);assert.equal(ctx.get('settings').describe().length,0)
  await ctx.fiber.dispose()
})
test('runtime Connection authentication delegates to browser auth and origin/host fence',async t => {
  const proto=HostConnectionService.prototype
  let allowed=false
  const ctx=new Context();t.after(()=>ctx.fiber.dispose())
  const connection=new HostConnectionService(ctx,[],{isAuthenticated:() => allowed,authenticateApi:()=>undefined})
  const request={headers:{host:'localhost:123',origin:'http://localhost:123','sec-fetch-site':'same-origin'}}
  assert.equal(proto.requestRejection.call(connection,request),401)
  allowed=true;assert.equal(proto.requestRejection.call(connection,request),undefined)
  assert.equal(proto.requestRejection.call(connection,{headers:{...request.headers,origin:'https://evil.test'}}),403)
})

test('native enabled setting withdraws and restores service; management and live stream remain available',async t => {
  const f=await profile(t),{ctx,routes,plugin}=f
  const control = async (method,args) => routes.get('/api/dsh-tts/v1/control').fetch(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({method,args})}))
  const stream = routes.get('/api/dsh-tts/v1/enabled')
  assert.equal((await stream.fetch(new Request('http://localhost/api/dsh-tts/v1/enabled',{headers:{Origin:'https://evil.test'}}))).status,403)
  const response = await stream.fetch(new Request('http://localhost/api/dsh-tts/v1/enabled',{headers:{Origin:'http://localhost'}}))
  const reader = response.body.getReader(), read = async () => new TextDecoder().decode((await reader.read()).value)
  assert.match(await read(),/"enabled":true/)
  const old = ctx.get('tts')
  assert.deepEqual(await (await control('getEnabled')).json(),{enabled:true})
  assert.equal((await control('setEnabled',{enabled:'false'})).status,400)
  assert.deepEqual(await (await control('setEnabled',{enabled:false})).json(),{enabled:false})
  assert.equal(ctx.get('tts'),undefined)
  assert.match(await read(),/"enabled":false/)
  await assert.rejects(old.synthesize({},{}),{code:'TTS_DISABLED'})
  assert.equal((await control('services')).status,200)
  assert.equal((await control('cache')).status,200)
  await reader.cancel()
  for (let i = 0; i < 3; i++) {
    await control('setEnabled',{enabled:true}); assert.equal(ctx.get('tts')?.apiVersion,1)
    await f.update('tts',{enabled:false}); await tick(); assert.equal(ctx.get('tts'),undefined)
  }
  const pendingStream = await stream.fetch(new Request('http://localhost/api/dsh-tts/v1/enabled',{headers:{Origin:'http://localhost'}}))
  const pendingReader = pendingStream.body.getReader();await pendingReader.read()
  await plugin.dispose(); await tick(); assert.equal(routes.size,0)
  assert.equal((await pendingReader.read()).done,true)
  await ctx.fiber.dispose()
})

test('saved enabled=false never exposes consumer service after activation',async t => {
  const f=await profile(t,{legacy:{tts:{enabled:false}}}),{ctx,plugin}=f
  await tick(); assert.equal(f.value('tts').enabled,false); assert.equal(ctx.get('tts'),undefined)
  await f.update('tts',{enabled:true}); await tick(); assert.equal(ctx.get('tts').apiVersion,1)
  await plugin.dispose(); await ctx.fiber.dispose()
})


test('native preset controls persist descriptors and expose imported ids through the host catalogue',async t => {
  const f=await profile(t),{ctx,routes,plugin}=f
  const control = async (method,args) => {
    const response = await routes.get('/api/dsh-tts/v1/control').fetch(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({method,args})}))
    assert.equal(response.status,200);return response.json()
  }
  try {
    const preset = {schemaVersion:1,id:'work/voice',label:'Voice',kind:'azure',enabled:true,languages:['en'],params:{voiceName:'en-US-AshleyNeural',pitch:25,rate:8}}
    const entry = await control('saveVoicePreset',{preset,expectedRevision:null})
    assert.deepEqual(await control('voicePresets'),[entry])
    assert.deepEqual(f.value('tts').voices,[preset])
    assert.ok((await ctx.get('tts').listServiceVoices()).some(v => v.id === preset.id))
    assert.deepEqual(await control('importVoicePresets',{presets:[preset]}),{added:[],unchanged:[preset.id],conflicts:[]})
    assert.deepEqual(await control('importVoicePresets',{presets:[{...preset,label:'Different'}]}),{added:[],unchanged:[],conflicts:[preset.id]})
    await control('setEnabled',{enabled:false});await control('setEnabled',{enabled:true})
    assert.ok((await ctx.get('tts').listServiceVoices()).some(v => v.id === preset.id))
    await control('deleteVoicePreset',{id:preset.id,expectedRevision:entry.revision})
    assert.deepEqual(await control('voicePresets'),[])
  } finally {await plugin.dispose();await ctx.fiber.dispose()}
})

// the old 字母词 rows move once into the active 发音字典 preset and the
// settings key is dropped; an empty row (a removed built-in) has nothing to move. Nothing else in settings changes.
test('old 字母词 settings rows move once into the active reading preset and the key is dropped',async t => {
  const dataDir = await mkdtemp(fileURLToPath(new URL('.cache-pron-',import.meta.url)))
  t.after(() => rm(dataDir,{recursive:true,force:true}))
  const f=await profile(t,{dataDir,legacy:{tts:{cacheMaxGB:2,pronunciationDictionary:[{term:'Aoi',spoken:'あおい'},{term:'AI',spoken:''},{term:'あおい',spoken:'円'}]}}}),{ctx,plugin}=f
  try {
    await until(() => !Object.hasOwn(f.value('tts'),'pronunciationDictionary'))
    const value = f.value('tts')
    assert.equal(Object.hasOwn(value,'pronunciationDictionary'),false); assert.equal(value.cacheMaxGB,2)
    assert.equal(Object.hasOwn((await f.overrides()).find(row=>row.id==='tts').config.tts,'pronunciationDictionary'),false)
    const preset = await ctx.get('ttsControl').call('readingPreset',{})
    assert.deepEqual(preset.entries.map(e => [e.forms,e.reading,e.language]),[[['Aoi'],'あおい','ja'],[['あおい'],'円','zh']])
    for (const method of ['pronunciationDictionary','savePronunciationDictionary']) await assert.rejects(ctx.get('ttsControl').call(method,{entries:[]}),{code:'UNKNOWN_METHOD'})
  } finally {await plugin.dispose();await ctx.fiber.dispose()}
})

test('native cache settings update the active cache and panel control persists only validated limits',async t => {
  const dataDir = await mkdtemp(fileURLToPath(new URL('.cache-native-',import.meta.url)))
  t.after(() => rm(dataDir,{recursive:true,force:true}))
  const key = 'a'.repeat(64), realNow = Date.now()
  const clock = t.mock.method(Date,'now',() => realNow - 2 * 86400000)
  await createCache({dataDir}).put(key,pcmWav(Buffer.alloc(100)),[])
  clock.mock.restore()
  const f=await profile(t,{dataDir}),{ctx,routes,plugin}=f
  const control = async args => routes.get('/api/dsh-tts/v1/control').fetch(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({method:'saveCacheSettings',args})}))
  try {
    assert.equal((await ctx.get('tts').cacheStats()).count,1)
    await f.update('tts',{cacheMaxAgeDays:1,cacheMaxGB:0.5}); await tick()
    const stats = await ctx.get('tts').cacheStats()
    assert.equal(stats.count,0); assert.equal(stats.maxAgeDays,1); assert.equal(stats.maxBytes,0.5 * 1024 ** 3)
    assert.deepEqual(await readdir(join(dataDir,'cache','audio-v2')),[])
    const response = await control({cacheMaxGB:0.1,cacheMaxAgeDays:7})
    assert.equal(response.status,200)
    assert.equal((await response.json()).maxBytes,0.1 * 1024 ** 3)
    assert.equal(f.value('tts').cacheMaxAgeDays,7)
    for (const args of [{cacheMaxGB:0,cacheMaxAgeDays:7},{cacheMaxGB:1,cacheMaxAgeDays:0},{cacheMaxGB:'1',cacheMaxAgeDays:30},{cacheMaxGB:1,cacheMaxAgeDays:1.5}]) {
      assert.equal((await control(args)).status,400)
      assert.equal(f.value('tts').cacheMaxGB,0.1)
    }
    await assert.rejects(f.update('tts',{cacheMaxGB:101}))
    await assert.rejects(f.update('tts',{cacheMaxAgeDays:3651}))
  } finally {await plugin.dispose();await ctx.fiber.dispose()}
})

test('saved native cache limits apply when loading existing audio',async t => {
  const dataDir = await mkdtemp(fileURLToPath(new URL('.cache-saved-',import.meta.url)))
  t.after(() => rm(dataDir,{recursive:true,force:true}))
  const realNow = Date.now(), clock = t.mock.method(Date,'now',() => realNow - 2 * 86400000)
  await createCache({dataDir}).put('a'.repeat(64),pcmWav(Buffer.alloc(100)),[])
  clock.mock.restore()
  const f=await profile(t,{dataDir,legacy:{tts:{cacheMaxGB:0.2,cacheMaxAgeDays:1}}}),{ctx,plugin}=f
  try {
    const stats = await ctx.get('tts').cacheStats()
    assert.equal(stats.count,0); assert.equal(stats.maxBytes,0.2 * 1024 ** 3); assert.equal(stats.maxAgeDays,1)
  } finally {await plugin.dispose();await ctx.fiber.dispose()}
})

// service/preset task-flow control methods.
test('control exposes provider kinds, external service status, base voices and key-less probes without network',async t => {
  const probes = []
  t.mock.method(globalThis,'fetch',async (url,options) => {probes.push({url,options}); return new Response('{}',{status:401})})
  const f=await profile(t),{ctx,routes,plugin}=f
  const raw = (method,args) => routes.get('/api/dsh-tts/v1/control').fetch(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({method,args})}))
  const control = async (method,args) => { const response = await raw(method,args); assert.equal(response.status,200); return response.json() }
  const fetch = globalThis.fetch; globalThis.fetch = async () => { throw Error('no network in this test') }
  const tts = ctx.get('tts'), voices = [{id:'cast/aoi',label:'Aoi',engine:'service-engine',revision:'v1',languages:['ja'],state:'ready'},{id:'cast/rin',label:'Rin',engine:'service-engine',revision:'v1',languages:['ja'],state:'loading'}]
  const offProviders = [
    tts.registerProvider('test',{id:'local-service',kind:'reference',revision:'1',capabilities:{serviceVoiceEngines:['service-engine']},health:async () => ({state:'ready',voices,error:''}),catalog:async () => voices,synthesize:async () => { throw Error('no synthesis') }}),
    tts.registerProvider('test',{id:'gone',kind:'reference',revision:'1',capabilities:{},health:async () => { throw Error('ECONNREFUSED') },catalog:async () => [],synthesize:async () => { throw Error('no synthesis') }}),
  ]
  try {
    const kinds = await control('providerKinds')
    assert.deepEqual(kinds.map(k => k.kind),['qwen','azure','fish-audio','volcengine','minimax','openai-compatible']) // add-flow order
    assert.deepEqual((await control('listModels',{serviceId:'local-service'})).models,[])
    assert.equal((await control('listVoices',{serviceId:'local-service'})).voices.length,2)
    assert.equal(kinds.find(k => k.kind === 'qwen').fields.find(f => f.secret).key,'key')
    const pending = await control('services')
    assert.equal(pending.running.find(s => s.id === 'local-service').status.state,'checking')
    await tick()
    const services = await control('services')
    assert.deepEqual(services.running.find(s => s.id === 'local-service').status,{state:'ready',voiceCount:1,voiceTotal:2})
    assert.deepEqual(services.running.find(s => s.id === 'gone').status,{state:'offline'})
    const listed = await control('providerVoices',{serviceId:'local-service'})
    assert.deepEqual(listed.voices.map(v => [v.id,v.engine,v.revision]),[['cast/aoi','service-engine','v1'],['cast/rin','service-engine','v1']])
    assert.equal((await raw('providerVoices',{serviceId:'missing'})).status,400)
    assert.equal((await raw('providerVoices',{serviceId:'../x'})).status,400)
    const probe = await control('probeService',{kind:'qwen',config:{region:'cn'}})
    assert.equal(probe.status,'error'); assert.match(probe.message,/API Key/)
    assert.equal(probes.length,1); assert.equal(probes[0].options.headers.Authorization,undefined)
    assert.equal((await control('probeService',{kind:'azure',config:{region:'Bad Region'}})).status,'invalid')
  } finally { globalThis.fetch = fetch; for (const off of offProviders) off(); await plugin.dispose(); await ctx.fiber.dispose() }
})


test('settings reads stay responsive while one shared catalogue probe is pending',async t => {
  const ctx = new Context(), plugin = ctx.plugin(ttsPlugin)
  await tick()
  let resolve, calls = 0
  const pending = new Promise(r => { resolve = r })
  t.after(async () => { resolve({state:'ready'}); await plugin.dispose(); await ctx.fiber.dispose() })
  const tts = ctx.get('tts'), control = ctx.get('ttsControl')
  tts.registerProvider('test',{id:'slow',kind:'fish-audio',revision:'one',capabilities:{},
    health:() => { calls++; return pending },synthesize:async () => { throw Error('no synthesis') }})
  assert.equal((await tts.listServices()).length,1)
  assert.equal(calls,0)
  const fast = Promise.all(['services','services','voicePresets','readingPresets','cache'].map(method => control.call(method)))
  let timer
  const values = await Promise.race([fast,new Promise((_,reject) => { timer = setTimeout(() => reject(Error('settings blocked on health')),300) })]).finally(() => clearTimeout(timer))
  assert.equal(values[0].running[0].status.state,'checking')
  assert.equal(values[1].running[0].status.state,'checking')
  assert.equal(calls,1)
  resolve({state:'ready'}); await tick()
  assert.equal((await control.call('services')).running[0].status.state,'ready')
  assert.equal(calls,1)
})

test('creator switch gates the shared control and leaves player voice untouched', async t => {
  let resolves = 0, paid = 0
  const previous = process.env.FISH_AUDIO_API_KEY
  delete process.env.FISH_AUDIO_API_KEY
  t.after(() => { if (previous === undefined) delete process.env.FISH_AUDIO_API_KEY; else process.env.FISH_AUDIO_API_KEY = previous })
  t.mock.method(globalThis,'fetch',async () => { paid++; assert.fail('must not call the provider') })
  const dataDir = await mkdtemp(fileURLToPath(new URL('.cache-creator-',import.meta.url)))
  t.after(() => rm(dataDir,{recursive:true,force:true}))
  const f = await profile(t,{dataDir,setup(ctx) { ctx.provide('credentials',{resolve:async () => { resolves++; return undefined },describe:async () => ({configured:false,writable:true})}) }})
  const control = f.ctx.get('ttsControl')
  assert.equal((await control.call('settings')).creator.enabled,false)
  assert.equal(f.value('tts').enabled,true)
  const input = {action:'design',serviceId:'fish-test',dryRun:true,plan:{language:'zh',maxCostUsd:0.5,characters:[{id:'sample',instruction:'温柔清晰的女声',reference_text:'这是一段中文试读。',n:1}]}}
  await assert.rejects(control.call('creator.voiceDesign',input),{code:'CREATOR_DISABLED'})
  await assert.rejects(control.call('voicePilot',input),{code:'UNKNOWN_METHOD'})
  assert.deepEqual(await control.call('setCreatorEnabled',{enabled:true}),{enabled:true})
  await f.update('tts',{providers:[{id:'fish-test',kind:'fish-audio',label:'Fish',config:providerConfig('fish-audio',{url:'https://api.fish.audio'})}]})
  assert.equal((await control.call('creator.voiceDesign',input)).dryRun,true)
  assert.equal(resolves,0)
  await assert.rejects(control.call('creator.voicePilot',input),{code:'INVALID_INPUT'})
  await assert.rejects(control.call('creator.voiceDesign',{...input,dryRun:false,confirm:true}),{code:'CREDENTIALS_REQUIRED'})
  assert.equal(resolves,1); assert.equal(paid,0)
  await control.call('setCreatorEnabled',{enabled:false})
  await assert.rejects(control.call('creator.voiceDesign',input),{code:'CREATOR_DISABLED'})
  assert.ok(f.ctx.get('tts')); assert.equal(f.value('tts').enabled,true)
})