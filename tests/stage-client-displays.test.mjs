import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageDisplays}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/displays.cjs')
test('display replacement cancels old waits and old detach cannot remove the replacement',async()=>{
 const displays=createStageDisplays();let old
 old=displays.attach('s',{present:()=>old.waitPresented(1)})
 const pending=displays.present('s',{});const frame=old.waitPresented(2)
 let next;next=displays.attach('s',{present:()=>next.waitPresented(1)})
 assert.equal((await pending).status,'cancelled');assert.equal((await frame).reason,'replaced')
 old.detach();old.confirm(Infinity)
 const shown=displays.present('s',{});next.confirm(1);assert.equal((await shown).status,'presented')
 displays.dispose()
})
test('disable settles even a stalled media sink; late completion cannot revive it',async()=>{
 const displays=createStageDisplays();let finish,plays=0
 displays.attach('s',{present:()=>new Promise(resolve=>finish=resolve),play:()=>plays++})
 const pending=displays.present('s',{});displays.dispose();assert.deepEqual(await pending,{status:'cancelled',reason:'disabled'})
 finish();displays.play('s',{});assert.equal(plays,0);assert.equal((await displays.present('s',{})).reason,'absent')
 assert.throws(()=>displays.attach('s',{}),/disposed/)
})
test('failed sinks and revoked presentations have distinct terminal receipts',async()=>{
 const displays=createStageDisplays();let display
 display=displays.attach('s',{present:intent=>{if(intent.fail)throw Error('render');return intent.type?undefined:display.waitPresented(3)}})
 assert.equal((await displays.present('s',{fail:true})).status,'failed')
 const pending=displays.present('s',{})
 await displays.present('s',{type:'revoke-presentation'})
 assert.deepEqual(await pending,{status:'cancelled',reason:'revoke-presentation'})
 display.confirm(3);displays.dispose()
})
