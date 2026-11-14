// current reading dictionary fixtures.
import { normalizeReadingEntries } from '../src/reading-dictionary.js'
import { normalizeDashes } from '../src/pronunciation.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'
import { createTts } from '../src/service.js'
import { createCache } from '../src/cache.js'
import { lexicon, hash, portableVoice, describeTtsError } from '../src/core.js'
import { pcmWav } from '../src/providers/audio.js'
import ttsMessages from '../src/shared/tts-messages.cjs'
import { importProviders, createServiceSettings } from '../src/settings.js'
import { azureSsml } from '../src/providers/azure.js'
import { sameOrigin, handleControl, registerRoutes, CONTROL_BODY_LIMIT, CONTROL_METHODS } from '../src/routes.js'
const audio = pcmWav(Buffer.alloc(100,1))
const voice = {schemaVersion:1,id:'v',label:'Voice',enabled:true,kind:'azure',languages:['ja','en'],params:{voiceName:'ja-JP-NanamiNeural'}}
const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r}); return {promise,resolve} }
function fixture(options = {}) {
  const tts = createTts({profileId:'test',...options}), calls = []
  const register = synthesize => tts.registerProvider('test',{id:'p',kind:options.providerKind || 'azure',revision:'model-1',capabilities:{voiceKinds:['reference'],paid:false,referenceInput:['bytes-v1']},health:async () => ({state:'ready'}),catalog:async () => [],synthesize:async (input,opts) => {calls.push(input); return synthesize ? synthesize(input,opts) : audio}})
  const source = (v = voice) => tts.registerVoiceSource({owner:'consumer',sourceId:'card',revision:'one',voices:[v],bindings:{v:'p'},readReference:async () => audio})
  const input = {voice:{source:'card',id:'v'},mood:'joy',text:'abc',language:'ja'}
  const grant = () => tts.grantConsumer({source:'card',principal:'user',scope:'card'})
  const say = (g,i = input,signal) => tts.synthesize(i,{grant:g.grant,scope:'card',signal})
  return {tts,calls,register,source,input,grant,say}
}

// no built-in Latin-word readings; only the dash
// rules run after the 发音字典.
test('Latin words pass through; dashes inside Latin tokens become short pauses', () => {
  assert.equal(normalizeDashes('Wi-Fi WIFI AI ok GPT Claude'), 'Wi Fi WIFI AI ok GPT Claude')
  assert.equal(normalizeDashes('e-mail T-shirt COVID-19 Wi\u2011Fi 3-2 -19'), 'e mail T shirt COVID 19 Wi Fi 3到2 负19')
})
test('dash contexts distinguish prose ranges, math, negatives and untouched punctuation', () => {
  assert.equal(normalizeDashes('10-20人 2020-2024 3-5天 第1-3章'), '10到20人 2020到2024 3到5天 第1到3章')
  for (const op of ['=', '+', '×', '*', '/', '÷']) assert.equal(normalizeDashes(`3-2${op}1`), `3减2${op}1`)
  assert.equal(normalizeDashes('3 - 2 = 1；3 - 2； -5 (-3) （-4）'), '3 减 2 = 1；3 减 2； 负5 (负3) （负4）')
  assert.equal(normalizeDashes('甲—乙 foo—bar 3–5天'), '甲—乙 foo bar 3到5天')
})
test('synthesis and cache use the normalised text', async () => {
  const f = fixture(); f.register(); f.source()
  const grant = f.grant(), input = {...f.input,text:'Wi-Fi 3-5'}
  await f.say(grant,input)
  assert.equal(f.calls[0].text,'Wi Fi 3到5')
  assert.equal((await f.say(grant,input)).cacheHit,true); assert.equal(f.calls.length,1)
  await f.tts.dispose()
})

test('a cached line plays without waking or asking its service', async () => {
  const tts = createTts({profileId:'test'}), asked = []
  let offline = false
  tts.registerProvider('test',{id:'p',kind:'azure',revision:'model-1',capabilities:{paid:false},
    discover:async () => {asked.push('discover'); if (offline) throw Object.assign(Error('down'),{code:'SERVICE_OFFLINE'})},
    health:async () => ({state:'ready'}),catalog:async () => [],synthesize:async () => audio})
  tts.registerVoiceSource({owner:'consumer',sourceId:'card',revision:'one',voices:[voice],bindings:{v:'p'}})
  const {grant} = tts.grantConsumer({source:'card',principal:'user',scope:'card'}), input = {voice:{source:'card',id:'v'},text:'abc',language:'ja'}
  assert.equal((await tts.synthesize(input,{grant,scope:'card'})).cacheHit,false)
  asked.length = 0; offline = true
  assert.equal((await tts.synthesize(input,{grant,scope:'card'})).cacheHit,true)
  assert.deepEqual(asked,[])
  await assert.rejects(tts.synthesize({...input,text:'new line'},{grant,scope:'card'}),/down|SERVICE_OFFLINE/)
  await tts.dispose()
})
test('a line keeps its cache key across a service rename or move and a new figure source; its sound changes it', async () => {
  const key = async ({revision = 'one', sourceId = 'card', label = 'Voice', params = voice.params, text = 'abc'} = {}) => {
    const tts = createTts({profileId:'p'})
    tts.registerProvider('test',{id:'p',kind:'azure',revision,capabilities:{paid:false},synthesize:async () => Buffer.alloc(0)})
    tts.registerVoiceSource({owner:'consumer',sourceId,revision:'one',voices:[{...voice,label,params}],bindings:{v:'p'}})
    const {grant} = tts.grantConsumer({source:sourceId,principal:'user',scope:'card'})
    try { return (await tts.cacheIdentity({voice:{source:sourceId,id:'v'},text,language:'ja'},{grant,scope:'card'})).key } finally { await tts.dispose() }
  }
  const base = await key()
  // A renamed service, a service at a new address, a figure source re-registered after an expression edit, a renamed voice.
  for (const change of [{revision:'renamed-and-moved'},{sourceId:'card-after-edit'},{label:'Renamed voice'}]) assert.equal(await key(change),base)
  for (const change of [{params:{voiceName:'ja-JP-KeitaNeural'}},{text:'abd'}]) assert.notEqual(await key(change),base)
})
test('a reading dictionary edit re-keys only the lines whose spoken or reference prompt text it changes', async () => {
  const reference = {...voice,kind:'reference',params:{},references:[{sha256:hash(audio),transcript:'ref',language:'ja'}]}
  const key = async (entries, text) => {
    const tts = createTts({profileId:'p',globalReadings:() => normalizeReadingEntries(entries.map(([forms,reading]) => ({forms,reading,languageOverride:'ja'})))})
    tts.registerProvider('test',{id:'p',kind:'reference',revision:'one',capabilities:{paid:false,voiceKinds:['reference'],referenceInput:['bytes-v1']},synthesize:async () => Buffer.alloc(0)})
    tts.registerVoiceSource({owner:'consumer',sourceId:'card',revision:'one',voices:[reference],bindings:{v:'p'},readReference:async () => audio})
    const {grant} = tts.grantConsumer({source:'card',principal:'user',scope:'card'})
    try { return (await tts.cacheIdentity({voice:{source:'card',id:'v'},text,language:'ja'},{grant,scope:'card'})).key } finally { await tts.dispose() }
  }
  const before = [['abc','x']]
  assert.equal(await key([...before,['zzz','y']],'abc'),await key(before,'abc'))
  assert.notEqual(await key([['abc','w']],'abc'),await key(before,'abc'))
  assert.notEqual(await key([...before,['ref','r']],'abc'),await key(before,'abc'))
})
test('registry supports source before provider; duplicate rejected and removal goes offline',async () => {
  const f = fixture(); f.source(); assert.equal(f.tts.listVoices({source:'card'})[0].state,'offline')
  const off = f.register(); assert.throws(() => f.register(),{code:'REVISION_CONFLICT'})
  assert.equal((await f.tts.listServices()).length,1); const g = f.grant(); await f.say(g); off()
  await assert.rejects(f.say(g),{code:'SERVICE_OFFLINE'}); await f.tts.dispose()
})
test('provider before source, refcounted leases and CAS replacement',async () => {
  const f = fixture(); f.register(); const one=f.source(), two=f.source(); const g=f.grant()
  one.dispose(); await f.say(g); two.dispose(); await assert.rejects(f.say(g),{code:'FORBIDDEN'})
  await f.tts.dispose()
})
test('readings are one global list: longest first, alias canonical and single pass, empty valid; sources carry none',() => {
  const list=normalizeReadingEntries([{forms:'ab',reading:'a',languageOverride:'ja'},{forms:'abc',reading:'ab',languageOverride:'ja'},{forms:'a',reading:'x',languageOverride:'ja'}])
  assert.equal(lexicon(list).apply('abc ab a','all_ja'),'ab a x')
  assert.equal(lexicon().apply('abc','ja'),'abc')
  assert.equal(lexicon(list),lexicon(list)); assert.equal(lexicon(list).revision,lexicon(list.slice()).revision)
  assert.throws(() => normalizeReadingEntries([list[0],list[0]]),{code:'DUPLICATE_READING_FORM'})
  const tts=createTts({profileId:'test'})
  assert.throws(() => tts.registerVoiceSource({owner:'consumer',sourceId:'card',revision:'one',voices:[voice],bindings:{v:'p'},readings:{entries:[]}}),{code:'UNKNOWN_FIELD'})
})
test('first reference is stable and prepares prompt once without changing transcript',async () => {
  const f=fixture({providerKind:'reference',globalReadings:() => [normalizeReadingEntries([{forms:'abc',reading:'global',languageOverride:'ja'}])[0]]}); f.register()
  f.source({...voice,kind:'reference',params:{},references:[{sha256:hash(audio),transcript:'abc',language:'ja',file:'default.wav'}]})
  await f.say(f.grant()); assert.equal(f.calls[0].slot,undefined); assert.equal(f.calls[0].text,'global'); assert.equal(f.calls[0].reference.promptText,'global'); assert.equal(f.calls[0].reference.transcript,'abc')
  await f.tts.dispose()
})
test('single flight joins, cancelling one waiter does not cancel the other',async () => {
  const f=fixture(), pending=deferred(); f.register(() => pending.promise); f.source()
  const g=f.grant(), c=new AbortController(); const one=f.say(g,undefined,c.signal), two=f.say(g)
  await new Promise(r => setTimeout(r,5)); c.abort(); await assert.rejects(one,{code:'ABORTED'}); pending.resolve(audio)
  const result=await two; assert.equal(f.calls.length,1); assert.equal((await f.say(g)).key,result.key); assert.equal((await f.say(g)).cacheHit,true); await f.tts.dispose()
})
test('all waiters cancelled abort provider and cannot publish late audio',async () => {
  const f=fixture(), pending=deferred(); let signal; f.register((_,o) => {signal=o.signal;return pending.promise}); f.source()
  const c=new AbortController(), p=f.say(f.grant(),undefined,c.signal); await new Promise(r => setTimeout(r,5)); c.abort(); await assert.rejects(p,{code:'ABORTED'}); assert.equal(signal.aborted,true); pending.resolve(audio); await f.tts.dispose()
})
test('cache identity stable across activation and changes for voice parameters / readings',async () => {
  const dataDir=await mkdtemp(join(tmpdir(),'tts-cache-'))
  const a=fixture({dataDir}); a.register(); a.source(); const key=(await a.say(a.grant())).key; await a.tts.dispose()
  const b=fixture({dataDir}); b.register(); b.source(); const result=await b.say(b.grant()); assert.equal(result.key,key); assert.equal(result.cacheHit,true); assert.equal(b.calls.length,0); await b.tts.dispose()
  const c=fixture({dataDir}); c.register(); c.source({...voice,params:{...voice.params,pitch:2}}); assert.notEqual((await c.say(c.grant())).key,key); await c.tts.dispose()
})
test('clear fences inflight, grant/ticket cannot cross scopes or survive source disposal',async () => {
  let now=0; const f=fixture({now:() => now}); f.register(); const source=f.source(), g=f.grant(), result=await f.say(g)
  const ticket=await f.tts.createAudioTicket({key:result.key,grant:g.grant,ttlMs:10})
  assert.deepEqual(await f.tts.redeemAudioTicket(ticket),audio); now=11; await assert.rejects(f.tts.redeemAudioTicket(ticket),{code:'AUDIO_GONE'})
  await assert.rejects(f.tts.readAudio({key:result.key,grant:{}}),{code:'FORBIDDEN'}); source.dispose(); await assert.rejects(f.tts.readAudio({key:result.key,grant:g.grant}),{code:'FORBIDDEN'}); await f.tts.dispose()
  const p=fixture(), d=deferred(); p.register(() => d.promise); p.source(); const pending=p.say(p.grant()); await new Promise(r => setTimeout(r,5)); await p.tts.clearCache({all:true}); d.resolve(audio); await assert.rejects(pending); assert.equal((await p.tts.cacheStats()).count,0); await p.tts.dispose()
})
test('provider removal aborts running requests; no calls after disposal',async () => {
  const f=fixture(), d=deferred(), off=f.register(() => d.promise); f.source(); const pending=f.say(f.grant()); await new Promise(r => setTimeout(r,5)); off(); await assert.rejects(pending,{code:'ABORTED'}); d.resolve(audio); await f.tts.dispose(); assert.throws(() => f.register(),{code:'PLUGIN_UNAVAILABLE'})
})
test('pure import strips unknown secret fields; keeps credential scheme and original document',() => {
  const doc={version:1,providers:[{id:'azure',kind:'azure',label:'A',config:{region:'eastasia'},secrets:{key:'not copied'}}]}, before=structuredClone(doc)
  const value=importProviders(doc); assert.deepEqual(doc,before); assert.equal(JSON.stringify(value).includes('not copied'),false); assert.equal(value.providers[0].id,'azure'); assert.throws(() => importProviders({version:2}),{code:'API_INCOMPATIBLE'})
})
test('settings writes and credentials roll back together; test never synthesizes',async () => {
  const f=fixture(); let settings={providers:[]}, stored=new Map(), calls=0, reject=false
  const credentials={resolve:async ref => stored.has(ref)?{value:stored.get(ref),source:'file'}:undefined,describe:async ref => ({configured:stored.has(ref),writable:true}),set:async (ref,value) => stored.set(ref,value),unset:async ref => stored.delete(ref)}
  const service=createServiceSettings({tts:f.tts,get:() => settings,replace:async v => {if(reject)throw Error();settings=v},credentials:() => credentials,fetch:async () => {calls++;return Response.json([])}})
  await service.save({id:'azure',kind:'azure',config:{region:'eastasia'},secrets:{key:'private'}})
  assert.equal(stored.get('DSH_TAVERN_TTS_AZURE_KEY'),'private'); assert.equal(JSON.stringify(settings).includes('private'),false)
  const saved=(await service.list())[0]; reject=true
  await assert.rejects(service.save({id:'azure',kind:'azure',config:{region:'eastasia'},expectedRevision:saved.revision,secrets:{key:'changed'}}),{code:'SETTINGS_WRITE_FAILED'})
  assert.equal(stored.get('DSH_TAVERN_TTS_AZURE_KEY'),'private'); assert.equal((await service.test({id:'azure'})).synthesisTested,false); assert.equal(calls,1)
  // no usage source: the delete asks first (USAGE_UNKNOWN), then a confirmed force deletes.
  await assert.rejects(service.delete({id:'azure',expectedRevision:saved.revision}),{code:'USAGE_UNKNOWN'})
  assert.doesNotMatch(ttsMessages.describeTtsError('USAGE_UNKNOWN'),/配音请求失败/)
  reject=false
  assert.deepEqual(await service.delete({id:'azure',expectedRevision:saved.revision,force:true}),{deleted:true,credentialsRetained:true}); assert.deepEqual(settings.providers,[])
  service.dispose(); await f.tts.dispose()
})
test('Azure escapes prepared SSML and uses portable mood mapping',() => {
  const ssml=azureSsml({text:'<&',params:{...voice.params,styles:true},mood:'joy',moodStyles:{joy:'friendly'}})
  assert.match(ssml,/&lt;&amp;/); assert.match(ssml,/style="friendly"/)
})
test('route same-origin rejects cross-site markers and oversize bodies, admits the desktop forward',async () => {
  const req=(headers={},body='{"method":"status"}') => new Request('http://localhost:123/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',...headers},body})
  // Connection has authenticated the request; the desktop app forwards it without Origin or Sec-Fetch-Site.
  assert.equal(sameOrigin(req()),true); assert.equal(sameOrigin(req({origin:'dsh-app://app'})),true)
  assert.equal(sameOrigin(req({'sec-fetch-site':'none'})),true)
  assert.equal(sameOrigin(req({origin:'http://localhost:999'})),false)
  assert.equal(sameOrigin(req({'sec-fetch-site':'cross-site'})),false); assert.equal(sameOrigin(req({'sec-fetch-site':'same-site'})),false)
  assert.equal((await handleControl(req({origin:'http://localhost:123','sec-fetch-site':'cross-site'}),() => ({}))).status,403)
  assert.equal((await handleControl(req({origin:'http://localhost:123'}),() => ({ok:true}))).status,200)
  assert.equal((await handleControl(req({origin:'http://localhost:123'},'x'.repeat(65537)),() => ({}))).status,400)
  // a control body may carry a whole reading preset (≈200 KB for 5,000 rows); beyond the bound it is named.
  const big=JSON.stringify({method:'importReadingPreset',args:{document:{entries:'x'.repeat(300000)}}})
  assert.equal((await handleControl(req({origin:'http://localhost:123'},big),() => ({ok:true}))).status,200)
  const over=await handleControl(req({origin:'http://localhost:123'},'x'.repeat(CONTROL_BODY_LIMIT + 1)),() => ({}))
  assert.equal(over.status,400); assert.equal((await over.json()).error,'BODY_TOO_LARGE')
})
test('control failures log bounded identifiers only, never the request text or key',async () => {
  const logs=[], logger={warn:(...args) => logs.push(format(...args))}
  const req=body => new Request('http://localhost:123/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',origin:'http://localhost:123'},body})
  const secret='我的私密台词 sk-test-SECRET123456'
  const failed=await handleControl(req(JSON.stringify({method:'testService',args:{text:secret}})),() => { throw Object.assign(new Error('voice missing: '+secret),{code:'VOICE_NOT_FOUND'}) },logger)
  assert.equal(failed.status,400); assert.deepEqual(await failed.json(),{error:'VOICE_NOT_FOUND',message:describeTtsError('VOICE_NOT_FOUND')})
  let dispatched=false
  const torn=await handleControl(req(`{"method":"testService","args":{"text":"${secret}"`),() => { dispatched=true; return {} },logger)
  assert.equal(torn.status,400); assert.equal((await torn.json()).error,'REQUEST_FAILED'); assert.equal(dispatched,false)
  // a method the control path does not dispatch, and a pure alphanumeric key as the error name, are logged as '-'.
  const keyed='SECRETKEY123456'
  const unknown=await handleControl(req(JSON.stringify({method:keyed,args:{}})),() => { throw Object.assign(new Error('UNKNOWN_METHOD'),{code:'UNKNOWN_METHOD'}) },logger)
  assert.equal(unknown.status,400)
  const named=await handleControl(req(JSON.stringify({method:'testService',args:{}})),() => { throw Object.assign(new Error('x'),{code:'SERVICE_OFFLINE',name:keyed}) },logger)
  assert.equal(named.status,400)
  assert.equal(logs.length,4)
  assert.match(logs[0],/method=testService code=VOICE_NOT_FOUND name=Error/); assert.match(logs[1],/method=- code=REQUEST_FAILED name=SyntaxError/)
  assert.match(logs[2],/method=- code=UNKNOWN_METHOD name=Error/); assert.match(logs[3],/method=testService code=SERVICE_OFFLINE name=-/)
  for (const line of logs) { for (const leak of [secret,'sk-test-SECRET123456',keyed]) assert.equal(line.includes(leak),false) }
})
test('control log methods are exactly the methods the control dispatch switches on',async () => {
  const cases=[...(await readFile(new URL('../src/index.js',import.meta.url),'utf8')).matchAll(/case '([\w.]+)':/g)].map(m => m[1])
  assert.deepEqual([...CONTROL_METHODS].sort(),[...new Set(cases)].sort())
})
test('routes attach only to authenticated Connection and dispose all registrations',() => {
  const routes=[], cleanups=[]; const ctx={inject(names,fn){assert.deepEqual(names,['connection']);fn(this)},get(){return {fetch:{register(r){routes.push(r);return () => routes.splice(routes.indexOf(r),1)}}}},effect(fn){cleanups.push(fn())}}
  registerRoutes(ctx,'/api/dsh-tts/v1',() => ({}),() => audio); assert.equal(routes.length,2); for(const dispose of cleanups)dispose();assert.equal(routes.length,0)
})

test('HTTP jobs require host-issued browser grant, bind principal, expire and cancel',async () => {
  let now=0;const f=fixture({now:() => now});f.register();const source=f.source()
  assert.throws(() => f.tts.jobs.submit(f.input,{principal:'dsh-browser',scope:'card'}),{code:'FORBIDDEN'})
  f.tts.grantConsumer({source:'card',principal:'dsh-browser',scope:'card'})
  const {requestId}=f.tts.jobs.submit(f.input,{principal:'dsh-browser',scope:'card'})
  assert.equal((await f.tts.jobs.wait(requestId,'dsh-browser')).state,'ready')
  assert.throws(() => f.tts.jobs.poll(requestId,'other'),{code:'JOB_GONE'})
  now=300001;assert.throws(() => f.tts.jobs.poll(requestId,'dsh-browser'),{code:'JOB_GONE'})
  source.dispose();await f.tts.dispose()
})
test('a reference voice carries no model: the references are the voice', () => {
  const local = {...voice,kind:'reference',params:{},references:[{sha256:hash(audio),transcript:'prompt',language:'ja',file:'default.wav'}]}
  assert.equal(portableVoice(local).model, undefined)
  for (const extra of [{model:{id:'m'}}, {modelRequirements:[{id:'m'}]}]) assert.throws(() => portableVoice({...local,...extra}),{code:'INVALID_INPUT'})
})
test('reference capability is required; an unrelated provider never substitutes its own voice', async () => {
  const f=fixture();let calls=0
  f.tts.registerProvider('test',{id:'p',kind:'azure',revision:'one',capabilities:{},synthesize:async()=>{calls++;return audio}})
  f.source({...voice,kind:'reference',params:{},references:[{sha256:hash(audio),transcript:'prompt',language:'ja',file:'default.wav'}]})
  await assert.rejects(f.say(f.grant()),{code:'REFERENCE_UNSUPPORTED'})
  assert.equal(calls,0);await f.tts.dispose()
})

test('disabling rejects synthesis and revokes tickets without clearing reusable cache',async () => {
  const f = fixture(); f.register(); f.source(); const g = f.grant()
  const result = await f.say(g), ticket = await f.tts.createAudioTicket({key:result.key,grant:g.grant})
  f.tts.setEnabled(false)
  await assert.rejects(f.say(g),{code:'TTS_DISABLED'})
  assert.throws(() => f.tts.jobs.submit(f.input,{principal:'user',scope:'card'}),{code:'TTS_DISABLED'})
  await assert.rejects(f.tts.redeemAudioTicket(ticket),{code:'AUDIO_GONE'})
  await assert.rejects(f.tts.createAudioTicket({key:result.key,grant:g.grant}),{code:'TTS_DISABLED'})
  f.tts.setEnabled(true)
  assert.equal((await f.say(g)).cacheHit,true)
  await assert.rejects(f.tts.redeemAudioTicket(ticket),{code:'AUDIO_GONE'})
  await f.tts.dispose()
})
test('disabling aborts in-flight synthesis',async () => {
  const f = fixture(), pending = deferred(); f.register(() => pending.promise); f.source()
  const synthesis = f.say(f.grant()); await new Promise(r => setTimeout(r,5))
  f.tts.setEnabled(false); await assert.rejects(synthesis,{code:'ABORTED'})
  pending.resolve(audio); await f.tts.dispose()
})
test('ticket redemption already reading cache cannot return audio after a disable/re-enable',async () => {
  const cache = createCache(), pending = deferred(); let pause = false
  const f = fixture({cache:{...cache,async get(...args) {const value = await cache.get(...args);if (pause) await pending.promise;return value}}})
  f.register();f.source();const g = f.grant(), result = await f.say(g)
  const ticket = await f.tts.createAudioTicket({key:result.key,grant:g.grant})
  pause = true; const reading = f.tts.redeemAudioTicket(ticket)
  f.tts.setEnabled(false);f.tts.setEnabled(true);pending.resolve()
  await assert.rejects(reading,{code:'AUDIO_GONE'});await f.tts.dispose()
})


test('provider lifecycle error codes survive synthesis and job presentation without private messages',async () => {
  const f = fixture()
  f.register(async () => { throw Object.assign(Error('private install path and token'),{code:'INVALID_PATH'}) }); f.source()
  const grant = f.grant()
  await assert.rejects(f.say(grant),{code:'INVALID_PATH'})
  const submitted = f.tts.jobs.submit(f.input,{principal:'user',scope:'card'})
  let status
  for (let i=0;i<30;i++) { status = f.tts.jobs.poll(submitted.requestId,'user'); if (status.state !== 'running') break; await new Promise(setImmediate) }
  assert.equal(status.error,'INVALID_PATH'); assert.ok(status.message); assert.ok(!status.message.includes('private'))
  await f.tts.dispose()
})


function priorityFixture(factory = createTts) {
  const tts = factory(), order = [], gates = new Map(), entered = new Map()
  const started = text => { if (!entered.has(text)) entered.set(text, deferred()); return entered.get(text) }
  tts.registerProvider('test', {id:'p',kind:'azure',revision:'one',endpoint:'shared',capabilities:{concurrency:1,stream:{sampleRate:44100}},
    async synthesize(input, {onPcm}) {
      order.push(input.text); started(input.text).resolve()
      await gates.get(input.text)?.promise
      onPcm?.(Buffer.alloc(100,1))
      return audio
    }})
  tts.registerVoiceSource({owner:'test',sourceId:'card',revision:'one',voices:[voice],bindings:{v:'p'}})
  const grant = tts.grantConsumer({principal:'dsh-browser',source:'card',scope:'card'})
  return {tts,order,grant,started,
    block(text) {const gate=deferred(); gates.set(text,gate); return gate.resolve},
    say(text, options = {}) {return tts.synthesize({voice:{source:'card',id:'v'},text,language:'ja'}, {grant:grant.grant,scope:'card',...options})}}
}
const queued = () => new Promise(resolve => setImmediate(resolve))

test('call priority overtakes queued story at a job boundary and story resumes FIFO', async () => {
  const f=priorityFixture(), release=f.block('running')
  const running=f.say('running'); await f.started('running').promise
  const story=[f.say('storyA'),f.say('storyB')]; await queued()
  const call=f.say('call', {priority:'call'}); await queued()
  assert.deepEqual(f.order,['running'])
  release(); await Promise.all([running,...story,call])
  assert.deepEqual(f.order,['running','call','storyA','storyB']); await f.tts.dispose()
})

test('hang-up cancels queued call jobs without synthesis and story resumes', async () => {
  const f=priorityFixture(), release=f.block('running'), abort=new AbortController()
  const running=f.say('running'); await f.started('running').promise
  const story=f.say('story')
  const calls=['callA','callB'].map(text => assert.rejects(f.say(text,{priority:'call',signal:abort.signal}),{code:'ABORTED'}))
  await queued(); abort.abort(); await Promise.all(calls)
  release(); await Promise.all([running,story])
  assert.deepEqual(f.order,['running','story']); await f.tts.dispose()
})

test('sustained calls cannot starve story, and calls stay FIFO', async () => {
  const f=priorityFixture(), release=f.block('running')
  const running=f.say('running'); await f.started('running').promise
  const story=[f.say('storyA'),f.say('storyB')]
  const names=Array.from({length:10},(_,i) => 'call'+i), calls=names.map(text => f.say(text,{priority:'call'}))
  await queued(); release(); await Promise.all([running,...story,...calls])
  assert.deepEqual(f.order,['running',...names.slice(0,4),'storyA',...names.slice(4,8),'storyB',...names.slice(8)])
  await f.tts.dispose()
})

test('call joining a queued single flight promotes it; hang-up preserves its story waiter', async () => {
  for (const cancel of [false,true]) {
    const f=priorityFixture(), release=f.block('running'), abort=new AbortController()
    const running=f.say('running'); await f.started('running').promise
    const earlier=f.say('earlier'), shared=f.say('shared'); await queued()
    const call=f.say('shared',{priority:'call',signal:abort.signal})
    const result=cancel ? assert.rejects(call,{code:'ABORTED'}) : call
    await queued(); if (cancel) {abort.abort(); await result}
    release(); await Promise.all([running,earlier,shared,result])
    assert.deepEqual(f.order,cancel ? ['running','earlier','shared'] : ['running','shared','earlier'])
    await f.tts.dispose()
  }
})

test('story backlog first-voice measurement (synthetic provider, no playback)', async t => {
  const f=priorityFixture(), release=f.block('running')
  const running=f.say('running'); await f.started('running').promise
  const names=Array.from({length:8},(_,i) => 'story'+i)
  // Each story job occupies the provider for 25ms; the first in-flight job is held until the call queues.
  const releases=names.map(text => f.block(text))
  names.forEach((text,i) => {void f.started(text).promise.then(() => setTimeout(releases[i],25))})
  const story=names.map(text => f.say(text)); await queued()
  let firstVoiceMs
  const start=performance.now(), call=f.say('call',{priority:'call',onStream:() => {firstVoiceMs=performance.now()-start}})
  await queued(); release(); await Promise.all([running,...story,call])
  t.diagnostic(JSON.stringify({backlog:8,storyJobMs:25,firstVoiceMs,order:f.order}))
  assert.ok(Number.isFinite(firstVoiceMs))
  assert.equal(f.order.indexOf('call'),1)
  await f.tts.dispose()
})

// 语音后端 keeps only the connection: a Fish / MiniMax model still saved on a service is read once for the figures (the
// stage's migration) and then dropped; the other services and fields stay as they are.
test('a Fish or MiniMax service model saved before is listed once and dropped from the saved config',async()=>{
  const f=fixture(); let settings={enabled:true,providers:[{id:'fish',kind:'fish-audio',config:{url:'https://api.fish.audio',model:'drama-3'}},{id:'q',kind:'qwen',config:{region:'cn'}},{id:'mm',kind:'minimax',config:{url:'https://api.minimaxi.com',model:'speech-02-hd'}}],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const service=createServiceSettings({tts:f.tts,get:() => settings,replace:async v => {settings=v},credentials:() => undefined})
  assert.deepEqual(service.legacyServiceModels(),[{serviceId:'fish',kind:'fish-audio',model:'drama-3'},{serviceId:'mm',kind:'minimax',model:'speech-02-hd'}])
  assert.deepEqual(await service.dropLegacyServiceModels(),{dropped:2})
  assert.deepEqual(settings.providers,[{id:'fish',kind:'fish-audio',config:{url:'https://api.fish.audio'}},{id:'q',kind:'qwen',config:{region:'cn'}},{id:'mm',kind:'minimax',config:{url:'https://api.minimaxi.com'}}])
  assert.deepEqual(service.legacyServiceModels(),[])
  assert.deepEqual(await service.dropLegacyServiceModels(),{dropped:0},'nothing left: no write')
  service.dispose?.()
})
// The cache-first lookup asks no server: a line's spoken text, and so its key, is the same before the local server answers.
test('a local Drama 3 line keeps its voice directions before the server has been asked',async()=>{
  const tts=createTts({profileId:'p'}),settings={enabled:true,providers:[{id:'local',kind:'fish-audio',config:{url:'http://127.0.0.1:9'}}],voices:[],cacheMaxGB:1,cacheMaxAgeDays:30}
  const service=createServiceSettings({tts,get:() => settings,replace:async () => {},credentials:() => undefined,fetch:async () => {throw Error('not asked')},warn:() => {}})
  service.sync()
  tts.registerVoiceSource({owner:'consumer',sourceId:'card',revision:'one',voices:[{...voice,kind:'fish-audio',params:{referenceId:'r',model:'drama-3'}}],bindings:{v:'local'}})
  const {grant}=tts.grantConsumer({source:'card',principal:'user',scope:'card'})
  assert.equal((await tts.cacheIdentity({voice:{source:'card',id:'v'},text:'{calm}abc',language:'ja'},{grant,scope:'card'})).identity.text,'[calm]abc')
  service.dispose?.(); await tts.dispose()
})
