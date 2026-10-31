import test from 'node:test'
import assert from 'node:assert/strict'
import {createManagedModHost} from '../tavern-plugin/lib/domain/mod-system-host.js'
import {createTavernPluginApi} from '../tavern-plugin/lib/plugin-api.js'
import {emptyCardMods,emptyGlobalMods} from '../tavern-plugin/lib/domain/mod-system-contract.js'
import * as timer from '../tavern-plugin/mods/timer/plugin.mjs'
import * as performance from '../tavern-plugin/mods/performance/plugin.mjs'
import * as danmaku from '../tavern-plugin/mods/danmaku/plugin.mjs'

function harness() {
  const host=createManagedModHost({authorized:['dsh.timer','dsh.performance','dsh.danmaku']}),api=createTavernPluginApi({modHost:host}),disposers={}
  for(const plugin of [timer,performance,danmaku]) {
    const ctx={fiber:{name:plugin.name},effect(fn){disposers[plugin.name]=fn();return disposers[plugin.name]}}
    ctx.tavern=Object.assign(Object.create(api.service),{ctx});plugin.apply(ctx)
  }
  const card=emptyCardMods(),global=emptyGlobalMods();for(const m of host.manifests())card.mods[m.id]='on'
  host.queueChoices({global,card});const session=host.beginSession(),snapshot=host.beginRequest(session)
  let state={}
  const command=(instanceId,operation,input={},extra={})=>host.execute({state,snapshot,modId:'dsh.performance',instanceId,operation,input,boundary:{sourceKey:'source',turn:1,page:1},...extra})
  return {host,session,snapshot,card,global,disposers,command,get state(){return state},set state(value){state=value}}
}
const start=(clock='alpha',topic='evidence')=>({topic,ref:{packId:'performances',kind:'performances',assetId:'debate'},clock:{instanceId:clock},sec:100})
const clock=(h,id)=>h.state.modState['dsh.timer'].instances[id]
function tick(h,id,elapsedMs,activity={}) {h.state=h.host.advance({state:h.state,snapshot:h.snapshot,provider:'dsh.timer',instanceId:id,elapsedMs,activity:{live:true,visible:true,...activity}})}
function ok(h,instance,op,input,extra) {const result=h.command(instance,op,input,extra);assert.equal(result.ok,true,JSON.stringify(result.error));h.state=result.state;if(op==='off' && (!extra?.mode || extra.mode==='live')){const exit=h.command(instance,'exited',{},extra);assert.equal(exit.ok,true);h.state=exit.state}return result}

test('real plugins register through the upstream owned API; package identity and grammar are bound',()=>{
  const h=harness();assert.equal(h.host.manifests().length,3);assert.ok(h.session.grammar.some(c=>c.dsl.verb==='timer'));assert.ok(h.session.grammar.some(c=>c.dsl.verb==='performance-set'))
  const before=JSON.stringify(h.session.grammar)
  h.card.mods['dsh.performance']='off';h.host.queueChoices({card:h.card,global:h.global})
  assert.equal(h.command('a','start',start()).ok,true,'in-flight snapshot does not change')
  const next=h.host.beginRequest(h.session);assert.equal(h.command('b','start',start('b'),{snapshot:next}).error.code,'MOD_DISABLED')
  assert.equal(JSON.stringify(h.session.grammar),before)
  h.disposers[performance.name]();assert.throws(()=>h.host.beginRequest(h.session),{code:'MOD_SESSION_REQUIRED'})
  assert.equal(h.command('a','start',start()).error.code,'MOD_DISABLED')
})
test('bound configuration captures one source frame and queue changes apply to the following request',async()=>{
  const h=harness();h.card.config['dsh.timer']={version:1,values:{defaultSeconds:{ref:{source:'mvu',path:'/seconds'}}}};h.host.queueChoices({global:h.global,card:h.card})
  let reads=0,finish;const gate=new Promise(resolve=>{finish=resolve}),sources={snapshot:async()=>{reads++;await gate;return {mvu:{available:true,value:{seconds:75}}}},declaration:()=>null}
  const pending=h.host.beginConfiguredRequest(h.session,{sources});await Promise.resolve()
  h.card.config['dsh.timer'].values.defaultSeconds={fixed:15};h.host.queueChoices({global:h.global,card:h.card});finish()
  const snapshot=await pending;assert.equal(snapshot.config['dsh.timer'].values.defaultSeconds,75);assert.equal(reads,1)
  assert.equal(h.host.beginRequest(h.session).config['dsh.timer'].values.defaultSeconds,15)
})
test('registration alone does not approve executable capabilities',()=>{
  const host=createManagedModHost();timer.apply({tavern:{registerMod(manifest,implementation){host.register(timer.name,manifest,implementation)}}})
  const card=emptyCardMods();card.mods['dsh.timer']='on';host.queueChoices({global:emptyGlobalMods(),card})
  assert.deepEqual(host.beginRequest(host.beginSession()).resolution.enabled,[])
})

test('two performances concurrently own different clocks; same-clock contention is friendly and atomic',()=>{
  const h=harness();ok(h,'first','start',start());ok(h,'second','start',start('beta'))
  const before=structuredClone(h.state),busy=h.command('third','start',start())
  assert.equal(busy.ok,false);assert.equal(busy.error.code,'MOD_RESOURCE_BUSY');assert.match(busy.error.message,/another instance/);assert.deepEqual(busy.state,before);assert.deepEqual(h.state,before)
  ok(h,'first','phase',{phase:'rest'});tick(h,'alpha',32000);tick(h,'beta',10000)
  assert.equal(clock(h,'alpha').checkpoint.remainingMs,68000);assert.equal(clock(h,'beta').checkpoint.remainingMs,90000,'entry animation never pauses beta')
  ok(h,'second','phase',{phase:'rest'});tick(h,'beta',10000);assert.equal(clock(h,'beta').checkpoint.remainingMs,80000)
  ok(h,'first','off');assert.equal(Object.keys(h.state.stageControls).length,1);assert.equal(clock(h,'alpha').timer.remainingMs,68000)
  ok(h,'third','resume',start());assert.equal(clock(h,'alpha').checkpoint.remainingMs,68000)
  assert.equal(clock(h,'beta').checkpoint.remainingMs,80000)
})
test('per-topic continuation across turns/refresh is exact; release stop and replay cannot restart',()=>{
  const h=harness();ok(h,'first','start',start());ok(h,'first','phase',{phase:'rest'});tick(h,'alpha',17000)
  const saved=structuredClone(h.state),projection=h.host.project(saved);assert.deepEqual(saved,projection)
  ok(h,'first','off');ok(h,'first','start',start('alpha','other-topic'));ok(h,'first','off')
  ok(h,'first','resume',start(),{boundary:{sourceKey:'next-source',turn:2,page:1}})
  assert.equal(clock(h,'alpha').checkpoint.remainingMs,83000)
  const before=structuredClone(h.state)
  ok(h,'first','off',{}, {mode:'clip'});assert.deepEqual(h.state,before)
  tick(h,'alpha',1000,{menuOpen:true});assert.equal(clock(h,'alpha').checkpoint.remainingMs,82000)
})
test('revoke immediately blocks stale execution; safe-boundary disable releases without deleting budgets',()=>{
  const h=harness();ok(h,'first','start',start());ok(h,'first','phase',{phase:'rest'});tick(h,'alpha',1000)
  h.host.revoke('dsh.performance');assert.equal(h.command('first','off').error.code,'MOD_DISABLED')
  h.state=h.host.releaseUnavailable(h.state,h.snapshot)
  assert.equal(Object.keys(h.state.stageControls).length,0);assert.equal(clock(h,'alpha').timer.remainingMs,99000)
  assert.equal(clock(h,'alpha').timer.suspended,true)
})
test('director cannot modify a held clock, but a different instance remains usable',()=>{
  const h=harness();ok(h,'first','start',start())
  const args={state:h.state,snapshot:h.snapshot,provider:'dsh.timer',operation:'start',input:{budgetKey:'director',params:{sec:10}},boundary:{turn:1}}
  assert.equal(h.host.direct({...args,instanceId:'alpha'}).error.code,'MOD_RESOURCE_BUSY')
  const result=h.host.direct({...args,instanceId:'other'});assert.equal(result.ok,true);assert.equal(result.state.modState['dsh.timer'].instances.other.timer.remainingMs,10000)
})
test('lifecycle property: 625 four-step sequences never override a controller or publish failed parent changes',()=>{
  const ops=['startA','startB','offA','offB','tick'];let sequences=0
  for(let n=0;n<625;n++) {
    const h=harness();let code=n
    for(let i=0;i<4;i++) {
      const op=ops[code%5];code=Math.floor(code/5);const before=structuredClone(h.state)
      if(op==='tick') {if(h.state.modState?.['dsh.timer'])tick(h,'alpha',1);continue}
      const instance=op.endsWith('A')?'a':'b',result=h.command(instance,op.startsWith('start')?'start':'off',start())
      if(result.ok)h.state=result.state
      else assert.deepEqual(h.state,before)
      assert.ok(Object.keys(h.state.stageControls || {}).length<=1)
      const held=Object.values(h.state.stageControls || {})[0]
      if(held)assert.ok(h.state.modState['dsh.performance'].instances[JSON.parse(held.controller)[1]])
    }
    for(const dispose of Object.values(h.disposers))dispose();sequences++
  }
  assert.equal(sequences,625)
})
test('off retains the lease through exit; duplicate start is idempotent and provider configuration supplies defaults',()=>{
  const h=harness();h.card.config['dsh.timer']={version:1,values:{defaultSeconds:{fixed:120}}};h.host.queueChoices({card:h.card,global:h.global})
  const snapshot=h.host.beginRequest(h.session),input=start();delete input.sec
  ok(h,'a','start',input,{snapshot});const before=structuredClone(h.state)
  ok(h,'a','start',input,{snapshot});assert.deepEqual(h.state,before)
  assert.equal(clock(h,'alpha').timer.durationMs,120000)
  const off=h.command('a','off',{}, {snapshot});assert.equal(off.ok,true);h.state=off.state;assert.equal(Object.keys(h.state.stageControls).length,1)
  assert.equal(h.command('b','start',start(),{snapshot}).error.code,'MOD_RESOURCE_BUSY')
  ok(h,'a','exited',{}, {snapshot});assert.equal(Object.keys(h.state.stageControls).length,0)
  assert.equal(h.command('__proto__','start',start(),{snapshot}).error.code,'MOD_INVALID')
})

test('generic danmaku subscription uses the real runtime; disposal does not call a paid model',async()=>{
  const h=harness();let modelCalls=0
  const facade={model:{call(){modelCalls++;throw new Error('No paid model in tests')}},state:{read:async()=>null,write:async()=>{}},presentation:{emit:async()=>{}},config:{}}
  await h.host.event(h.snapshot,'dsh.danmaku',{event:'session.disposed',context:{sessionId:'isolated'},payload:{}},facade)
  assert.equal(modelCalls,0)
})

test('public plugin API follows optional managed host removal and reinstallation',()=>{
  let host
  const api=createTavernPluginApi({get modHost(){return host}})
  assert.equal(api.service.modHostApi,null)
  assert.throws(()=>api.service.registerMod({},{}),/not enabled/)
  const stops=[]
  const ctx={fiber:{name:timer.name},effect(fn){const stop=fn();stops.push(stop);return stop}}
  ctx.tavern=Object.assign(Object.create(api.service),{ctx})
  host=createManagedModHost();timer.apply(ctx)
  assert.equal(host.manifests().length,1);assert.equal(api.service.modHostApi,host.apiVersion)
  host.dispose();host=undefined
  assert.equal(api.service.modHostApi,null)
  assert.throws(()=>timer.apply(ctx),/not enabled/)
  host=createManagedModHost();timer.apply(ctx)
  assert.equal(host.manifests().length,1)
  for(const stop of stops)stop()
  assert.equal(host.manifests().length,0);host.dispose()
})
