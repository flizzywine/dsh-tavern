import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageSwitch} from '../tavern-plugin/lib/stage-switch.js'
function fixture(saved) {
 let state='disabled',starts=0,stops=0
 const store={readJson:async()=>saved,writeJson:async(_path,next)=>{saved=next}}
 const runtime={status:()=>state,enable:async()=>{starts++;state='ready'},disable:async()=>{stops++;state='disabled'}}
 return {store,runtime,counts:()=>({starts,stops})}
}
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
