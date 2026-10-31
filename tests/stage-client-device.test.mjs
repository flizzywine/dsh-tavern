import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageDevice} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/device.cjs')
test('device projection changes close-up only on portrait phones without mutating accepted state', () => {
  let portrait=false,landscape=false
  const device=createStageDevice({matchMedia:query=>({matches:query.includes('max-height')?landscape:portrait})})
  const state={camera:{mode:'close',actor:'a'},cast:['a']}
  assert.equal(device.profile(),'desktop')
  assert.equal(device.state(state,'desktop'),state)
  portrait=true
  assert.equal(device.profile(),'mobile-portrait')
  assert.deepEqual(device.state(state,device.profile()).camera,{mode:'reset',actor:null})
  assert.equal(state.camera.mode,'close')
  landscape=true
  assert.equal(device.profile(),'mobile-landscape')
  assert.equal(device.state(state,device.profile()),state)
})
test('device disposal removes all listeners despite errors and ignores queued events', () => {
  let changes=0
  const lists=[]
  const device=createStageDevice({matchMedia:()=>{
    const row={addEventListener(_,fn){this.fn=fn},removeEventListener(){this.removed=true;if(lists[0]===this)throw new Error('remove failed')}}
    lists.push(row);return row
  }})
  const off=device.subscribe(()=>changes++)
  lists[0].fn()
  assert.equal(changes,1)
  assert.throws(()=>device.dispose(),/Stage device cleanup failed/)
  assert.ok(lists.every(row=>row.removed))
  lists.forEach(row=>row.fn())
  off();device.dispose();device.subscribe(()=>changes++)
  assert.equal(changes,1)
  assert.equal(lists.length,2)
})
test('partially failed device subscription rolls back listeners', () => {
  const lists=[]
  const device=createStageDevice({matchMedia:()=>{
    const row={addEventListener(){if(lists[1]===this)throw new Error('add failed')},removeEventListener(){this.removed=true}}
    lists.push(row);return row
  }})
  assert.throws(()=>device.subscribe(()=>{}),/add failed/)
  assert.ok(lists.every(row=>row.removed))
  device.dispose()
})
