import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageDevice} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/device.cjs')
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
