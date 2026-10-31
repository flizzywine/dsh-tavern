import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageSwitch} from '../tavern-plugin/lib/stage-switch.js'
function fixture(saved) {
 let state='disabled',starts=0,stops=0
 const store={readJson:async()=>saved,writeJson:async(_path,next)=>{saved=next}}
 const runtime={status:()=>state,enable:async()=>{starts++;state='ready'},disable:async()=>{stops++;state='disabled'}}
 return {store,runtime,counts:()=>({starts,stops})}
}
test('user disable persists across host restart without loading stage',async()=>{
 const f=fixture();const first=await createStageSwitch(f)
 await first.install(()=>{});assert.equal(first.read().status,'ready')
 await first.setEnabled(false);await first.uninstall()
 const second=await createStageSwitch(f);await second.install(()=>{})
 assert.deepEqual(second.read(),{status:'disabled',enabled:false,installed:true})
 assert.equal(f.counts().starts,1)
 await second.setEnabled(true);assert.equal(second.read().status,'ready')
})
test('absent package cannot be enabled and failed persistence leaves runtime unchanged',async()=>{
 const f=fixture();const control=await createStageSwitch(f)
 await assert.rejects(control.setEnabled(true),/未安装/)
 await control.install(()=>{})
 f.store.writeJson=async()=>{throw Error('disk failure')}
 await assert.rejects(control.setEnabled(false),/disk failure/)
 assert.equal(control.read().status,'ready');assert.equal(control.read().enabled,true)
 await control.uninstall();assert.equal(control.read().installed,false)
 await assert.rejects(control.setEnabled('false'),/布尔值/)
})
test('stop is not blocked by a pending stage activation',async()=>{
 const f=fixture();let finish
 f.runtime.enable=()=>new Promise(resolve=>{finish=resolve})
 const control=await createStageSwitch(f)
 const installing=control.install(()=>{})
 await control.setEnabled(false)
 assert.equal(f.counts().stops,1);assert.equal(control.read().enabled,false)
 finish();await installing
})
test('unreadable stage preferences do not fail host startup or activate stage',async()=>{
 const f=fixture();f.store.readJson=async()=>{throw Error('corrupt stage settings')}
 const control=await createStageSwitch({...f,warn(){}})
 await control.install(()=>{})
 assert.equal(control.read().enabled,false);assert.equal(f.counts().starts,0)
 await control.setEnabled(true);assert.equal(control.read().status,'ready')
})
test('user activation returns while loading so the same UI can stop it',async()=>{
 const f=fixture({enabled:false});let finish
 f.runtime.enable=()=>new Promise(resolve=>{finish=resolve})
 const control=await createStageSwitch(f);await control.install(()=>{})
 await control.setEnabled(true)
 await control.setEnabled(false)
 assert.equal(f.counts().stops,1);assert.equal(control.read().enabled,false)
 finish()
})
