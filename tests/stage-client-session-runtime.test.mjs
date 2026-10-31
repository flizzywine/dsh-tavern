import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSessionRuntime}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/session-runtime.cjs')
const {createStageRuntimeStoreModule:createStoreModule}=require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/runtime-store.cjs')
const {createStageSessionModule:createSessionModule}=require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/session.cjs')
const kernel=require('../tavern-plugin/src/client/stage-runtime.cjs')
test('plugin runtime owns session observers and disposes all owners despite a cleanup failure',()=>{
 const runtime=createStageSessionRuntime({kernel,createStoreModule,createSessionModule}),listeners=new Set();let stops=0
 const inputs=fail=>({sessions:{list:{getSnapshot:()=>({current:null,byId:{}}),subscribe(fn){listeners.add(fn);return ()=>{listeners.delete(fn);stops++;if(fail)throw Error('unsubscribe failed')}}}}})
 assert.equal(listeners.size,0)
 const first=runtime.createSessionOwner(inputs(true)),second=runtime.createSessionOwner(inputs(false))
 assert.equal(listeners.size,0,'construction alone does not observe host sessions')
 first.start();first.start();second.start();assert.equal(listeners.size,2)
 assert.throws(()=>runtime.dispose(),/cleanup failed/);assert.equal(listeners.size,0);assert.equal(stops,2)
 runtime.dispose();first.dispose();second.dispose();assert.equal(stops,2)
 assert.throws(()=>runtime.createSessionOwner(inputs(false)),/disposed/)
})
test('explicit session teardown leaves plugin teardown idempotent',()=>{
 const runtime=createStageSessionRuntime({kernel,createStoreModule,createSessionModule});let stopped=0
 const owner=runtime.createSessionOwner({sessions:{list:{getSnapshot:()=>({byId:{}}),subscribe:()=>()=>stopped++}}})
 owner.start();owner.dispose();runtime.dispose();assert.equal(stopped,1)
})

test('plugin disposal stops director IO and fences late watches, timers and new effects',async()=>{
 const {createStageDirectorModule:createDirectorModule}=require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/director-source.cjs')
 const runtime=createStageSessionRuntime({kernel,createStoreModule,createSessionModule,createDirectorModule,directorCommands:{}})
 let wake,timer,finish,signal,reads=0,cleared=0;const events=[]
 const director=runtime.createDirector({watch(source,fn){wake=fn;return ()=>{throw Error('watch cleanup failed')}},read(args,abort){reads++;signal=abort;return new Promise(resolve=>finish=resolve)},clock:{setTimeout(fn){timer=fn;return 1},clearTimeout(){cleared++}}})
 const source={sessionId:'s',turn:1},token={id:1,source},snapshot=()=>({text:{units:[],streaming:true},director:{}}),dispatch=event=>events.push(event)
 director.runEffect('s',{type:'watch-director',source},dispatch,snapshot)
 director.runEffect('s',{type:'schedule-read',token,delay:10},dispatch,snapshot)
 director.runEffect('s',{type:'read-director',token,sinceRevision:-1},dispatch,snapshot)
 await Promise.resolve();assert.equal(reads,1)
 assert.throws(()=>runtime.dispose(),/cleanup failed/);assert.equal(signal.aborted,true);assert.equal(cleared,1)
 wake();timer();finish({phase:'done'});await new Promise(resolve=>setImmediate(resolve))
 director.runEffect('s',{type:'read-director',token},dispatch,snapshot)
 assert.equal(reads,1);assert.deepEqual(events,[]);assert.equal(await runtime.projectDirection({phase:'done'},source),null)
})


test('plugin resource disposal cancels all sessions despite progress cleanup failure and rejects new work',async()=>{
 const {createStageResourceRunnerModule:createResourceModule}=require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/resource-runner.cjs')
 const runtime=createStageSessionRuntime({kernel,createStoreModule,createSessionModule,createResourceModule,resourceDependencies:{}})
 const pending=[],ended=[],events=[];let released=0,reads=0
 const resources=runtime.createResources({owner:{dispose(){released++}},read(){reads++;return new Promise(resolve=>pending.push(resolve))},progress:{begin(){},end(id){ended.push(id);throw Error('progress cleanup')}}})
 for(const id of ['a','b']){
  const source={sessionId:id,turn:1,authorityEpoch:1},token={id:1,source},direction={revision:1}
  resources.onEffect(id,{type:'project',token,carry:{source,token:direction},at:1},event=>events.push(event),()=>({cursor:{mode:'live'},projection:{token}}))
 }
 await Promise.resolve();assert.equal(reads,2)
 assert.throws(()=>runtime.dispose(),/cleanup failed/)
 assert.deepEqual(ended,['a','b']);assert.equal(released,1)
 for(const finish of pending)finish({status:'ready'})
 await new Promise(resolve=>setImmediate(resolve))
 resources.onEffect('c',{type:'project'},()=>assert.fail('late event'),()=>assert.fail('late state read'))
 await resources.prefetch({sessionId:'c'},{complete:true,token:{},through:1})
 resources.dispose();assert.equal(reads,2);assert.equal(released,1);assert.deepEqual(events,[])
 assert.throws(()=>runtime.createResources({}),/disposed/)
})


test('connection owns effect routing, history caching and reverse teardown with late entry fencing',async()=>{
 const calls=[];let input,releaseEntry,reads=0,prefetch=0
 const effect=()=>{},prime=()=>{},resources={onEffect:effect,invalidate:id=>calls.push('resources:'+id),prefetch:()=>prefetch++,dispose:()=>calls.push('resources')}
 const source={runEffect:effect,cached:()=>null,prime,invalidate:id=>calls.push('director:'+id),dispose:()=>calls.push('director')}
 const owner={get:()=>({id:'store'}),start:()=>calls.push('start'),dispose:()=>{calls.push('session');throw Error('session cleanup')}}
 const runtime=createStageSessionRuntime({createStoreModule:()=>({}),createSessionModule:()=>({createStageSessionOwner:options=>(input=options,owner)}),
  createResourceModule:()=>({createStageResourceRunner:()=>resources}),createDirectorModule:()=>({createStageDirectorSource:options=>{assert.equal(options.onEffect,effect);return source}})})
 const connection=runtime.createConnection({resources:{},direction:{read:()=>++reads},session:{},waitForEntry:store=>{assert.equal(store.id,'store');return new Promise(resolve=>releaseEntry=resolve)}})
 connection.start();assert.equal(input.runEffect,effect);assert.equal(input.primeHistory,prime)
 assert.equal(input.readHistory({}, {}, {}),1)
 input.invalidateHistory('a');assert.deepEqual(calls,['start','director:a','resources:a'])
 const pending=input.prefetchHistory({sessionId:'a'},{});
 assert.throws(()=>runtime.dispose(),/cleanup failed/)
 releaseEntry();await pending;assert.equal(prefetch,0)
 assert.deepEqual(calls.slice(-3),['session','director','resources'])
 assert.equal(input.readHistory({}, {}, {}),null);assert.equal(reads,1)
 connection.dispose();assert.throws(()=>connection.start(),/disposed/)
})
