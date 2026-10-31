import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageRuntimeUi}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/runtime-ui.cjs')
const {createStageRuntimeStoreModule}=require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/runtime-store.cjs')
function hooks(){
 const cleanups=[],writes=[],reads=[]
 const React={useMemo:fn=>fn(),useEffect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup)},useState:value=>[value,next=>writes.push(next)],useSyncExternalStore:(subscribe,get)=>{cleanups.push(subscribe(()=>reads.push(get())));return get()}}
 return {React,writes,reads,unmount:()=>{for(const cleanup of cleanups)cleanup()}}
}
test('runtime UI selects the existing store and plugin disposal removes selectors before React unmount',()=>{
 const h=hooks(),kernel={createStageRuntimeState:()=>({count:0}),reduceStageRuntime:(state,event)=>({state:{count:state.count+1},effects:[]})}
 const store=createStageRuntimeStoreModule(kernel).createStageRuntimeStore()
 const ui=createStageRuntimeUi({React:h.React,sessions:{get:()=>store},kernel})
 assert.equal(ui.useSelector('s',state=>state.count),0)
 store.dispatch({type:'next'});assert.deepEqual(h.reads,[1])
 ui.dispose();store.dispatch({type:'next'});assert.deepEqual(h.reads,[1]);h.unmount();ui.dispose()
 assert.equal(ui.useSelector('s',state=>state.count),0,'disposed UI cannot attach to live session')
})
test('performance kinds populate the existing session once and late results cannot mutate a disposed UI',async()=>{
 for(const close of [false,true]){
  const h=hooks(),events=[];let finish
  const kinds=[{kind:'core.title',replay:{stage:true}},{kind:'other',replay:{none:'disabled'}}]
  const ui=createStageRuntimeUi({React:h.React,sessions:{},kernel:{},performances:{read:()=>new Promise(resolve=>finish=resolve),registry:()=>({list:()=>kinds}),core:[]}})
  assert.equal(ui.usePerformanceKinds('s',{dispatch:event=>events.push(event)}).settled,false)
  if(close)ui.dispose()
  finish({kinds:[]});await new Promise(resolve=>setImmediate(resolve))
  assert.equal(events.length,close?0:1);assert.equal(h.writes.length,close?0:1)
  if(!close){assert.equal(events[0].type,'SESSION_INPUTS');assert.deepEqual(h.writes[0].replayable,['core.title'])}
  ui.dispose();h.unmount()
 }
})
test('one failing selector cleanup does not prevent cleanup of remaining selectors',()=>{
 const h=hooks();let released=0
 const ui=createStageRuntimeUi({React:h.React,kernel:{},sessions:{get:()=>({select:()=>({getSnapshot:()=>1,subscribe:()=>()=>{},dispose(){released++;throw Error('selector failure')}})})}})
 ui.useSelector('a',x=>x);ui.useSelector('b',x=>x)
 assert.throws(()=>ui.dispose(),/cleanup failed/);assert.equal(released,2);h.unmount();ui.dispose()
})
