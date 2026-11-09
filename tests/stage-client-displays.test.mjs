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
