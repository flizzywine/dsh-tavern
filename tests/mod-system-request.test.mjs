import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
// cordis is the DSH host's: load it from the runtime the test runner names (DSH_BOOT_MODULE), else beside the plugin.
const hostRequire=createRequire(process.env.DSH_BOOT_MODULE ? pathToFileURL(process.env.DSH_BOOT_MODULE) : new URL('../tavern-plugin/package.json',import.meta.url))
const {Context}=await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
import {createTavernPluginApi} from '../tavern-plugin/lib/plugin-api.js'
import {createManagedModHost} from '../tavern-plugin/lib/domain/mod-system-host.js'
import {emptyCardMods,emptyGlobalMods} from '../tavern-plugin/lib/domain/mod-system-contract.js'

const id='example.counter',packageName='example-counter'
function manifest() {
  return {format:'dsh-mod',schemaVersion:4,performances:[],id,name:'Counter',packageName,version:'1.0.0',hostApi:'^1.0.0',entry:'plugin.mjs',dependencies:[],
    config:{version:1,schema:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false},defaults:{count:1}},
    preferences:{schema:{type:'object',properties:{},additionalProperties:false},defaults:{}},dataVersion:1,coreAssets:[],permissions:['stage.state'],
    api:{operations:['add'],resource:'instance-exclusive'}}
}
function choices(count) {
  const card=emptyCardMods();card.mods[id]='on';card.config[id]={version:1,values:{count}}
  return {global:emptyGlobalMods(),card}
}
const implementation={api:(state,action,boundary)=>({count:(state.count || 0)+boundary.config.count})}
function setup() {
  const host=createManagedModHost({authorized:[id]}),dispose=host.register(packageName,manifest(),implementation),session=host.beginSession()
  return {host,dispose,session}
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}

test('concurrent cards resolve their own choices and source frames without the pending queue',async()=>{
  const {host,session}=setup(),gate=deferred(),started=deferred();let reads=0
  const a=choices({ref:{source:'mvu',path:'/count'}})
  const first=host.beginConfiguredRequest(session,{choices:a,sources:{declaration:()=>null,snapshot:async()=>{reads++;started.resolve();await gate.promise;return {mvu:{available:true,value:{count:12}}}}}})
  await started.promise
  const second=await host.beginConfiguredRequest(session,{choices:choices({fixed:7}),sources:{declaration:()=>null,snapshot:async()=>({})}})
  a.card.mods[id]='off';host.queueChoices(choices({fixed:99}));gate.resolve()
  const snapshot=await first
  assert.equal(snapshot.config[id].values.count,12);assert.equal(second.config[id].values.count,7);assert.equal(reads,1)
  assert.equal(snapshot.card.mods[id],'on');assert.equal(host.beginRequest(session).config[id].values.count,99)
})

test('cancelled source resolution and stale write-owner guard cannot publish a prepared draft',async()=>{
  const {host,session}=setup(),gate=deferred(),started=deferred(),controller=new AbortController()
  const preparing=host.beginConfiguredRequest(session,{choices:choices({ref:{source:'mvu',path:'/count'}}),signal:controller.signal,
    sources:{declaration:()=>null,snapshot:async()=>{started.resolve();await gate.promise;return {mvu:{available:true,value:{count:12}}}}}})
  await started.promise;controller.abort();gate.resolve()
  await assert.rejects(preparing,{code:'MOD_REQUEST_STALE'})
  let revision=1,state={}
  const snapshot=host.beginRequest(session,{choices:choices({fixed:4}),isCurrent:()=>revision===1})
  const result=host.direct({state,snapshot,provider:id,instanceId:'one',operation:'add'})
  assert.equal(result.ok,true);revision++
  assert.throws(()=>{host.assertCurrent(snapshot,id);state=result.state},{code:'MOD_REQUEST_STALE'})
  assert.deepEqual(state,{})
  assert.equal(host.direct({state,snapshot,provider:id,instanceId:'one',operation:'add'}).error.code,'MOD_REQUEST_STALE')
})

test('actual Cordis unload aborts event lifetime and rejects retained facade writes',async()=>{
  const root=new Context(),host=createManagedModHost({authorized:[id]}),gate=deferred(),started=deferred()
  let writes=0,signal,retained,hostFiber,fiber
  try {
    hostFiber=await root.plugin({name:'request-test-host',apply(ctx){ctx.provide('tavernManagedModules',host);ctx.provide('tavern',createTavernPluginApi({ctx,modHost:host}).service)}})
    fiber=await root.plugin({name:packageName,inject:['tavern'],apply(ctx){ctx.tavern.registerMod(manifest(),{...implementation,
      async event(message,facade){signal=facade.signal;retained=facade.state.write;started.resolve();await gate.promise;await retained(message)}})}})
    const snapshot=host.beginRequest(host.beginSession(),{choices:choices({fixed:1})})
    const event=host.event(snapshot,id,{value:1},{state:{write:async()=>{writes++}}})
    await started.promise;await fiber.dispose();assert.equal(signal.aborted,true);gate.resolve()
    await assert.rejects(event,{code:'MOD_DISABLED'});assert.equal(writes,0)
    assert.throws(()=>retained({value:2}),{code:'MOD_DISABLED'})
  }finally {gate.resolve();await fiber?.dispose();await hostFiber?.dispose()}
})

test('request abort blocks retained facade calls even while the module stays installed',async()=>{
  const host=createManagedModHost({authorized:[id]}),gate=deferred(),started=deferred(),controller=new AbortController();let calls=0
  host.register(packageName,manifest(),{...implementation,async event(message,facade){started.resolve();await gate.promise;return facade.presentation.emit(message)}})
  const snapshot=host.beginRequest(host.beginSession(),{choices:choices({fixed:1}),signal:controller.signal})
  const task=host.event(snapshot,id,{value:1},{presentation:{emit:()=>{calls++}}})
  await started.promise;controller.abort();gate.resolve();await assert.rejects(task,{code:'MOD_REQUEST_STALE'});assert.equal(calls,0)
})

test('registration owns immutable grammar and an old disposer cannot unload its replacement',()=>{
  const host=createManagedModHost({authorized:[id]}),commands=[{op:'counter.add'}]
  let disposed=0
  const release=host.register(packageName,manifest(),{...implementation,commands,dispose:()=>disposed++})
  commands[0].op='mutated'
  assert.equal(host.beginSession().grammar[0].op,'counter.add')
  release();release();assert.equal(disposed,1)
  host.register(packageName,manifest(),{...implementation,dispose:()=>disposed++});release()
  assert.equal(host.manifests().length,1);host.dispose();host.dispose();assert.equal(disposed,2)
})

test('registration rejects a required cycle before publishing the second member',()=>{
  const host=createManagedModHost(),first=manifest(),second={...manifest(),id:'example.other',packageName:'example-other'}
  first.dependencies=[{id:second.id,range:'^1.0.0'}];second.dependencies=[{id:first.id,range:'^1.0.0'}]
  host.register(packageName,first,implementation)
  assert.throws(()=>host.register(second.packageName,second,implementation),error=>error.code==='MOD_DEPENDENCY_CYCLE' && error.details.ids.includes(id) && error.details.ids.includes(second.id))
  assert.equal(host.manifests().length,1)
})
