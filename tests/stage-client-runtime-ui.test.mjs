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
