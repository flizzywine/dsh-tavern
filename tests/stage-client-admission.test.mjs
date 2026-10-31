import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageAdmission} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/admission.cjs')
test('admission disposal stops polling and resolves waiters even before React removes the stage', async () => {
  const effects = [], timers = new Map(), updates = []
  let count = 0
  const admission = createStageAdmission({
    React:{useState:value => [value,next => updates.push(next)],useRef:current => ({current}),
      useEffect:fn => effects.push(fn),useCallback:fn => fn},
    window:{},document:{querySelector:() => ({})},performance:{now:() => 0},
    setTimeout:fn => {timers.set(++count,fn);return count},clearTimeout:id => timers.delete(id),
  })
  const store = {getSnapshot:() => ({accepted:{presentationRevision:0},source:null,empty:false})}
  admission.useEntry(store,{current:null})
  const stop = effects[0]()
  const latePoll = [...timers.values()][0]
  let settled = false, ready = false
  const waits = [admission.shown.settled().then(() => {settled=true}),
    admission.shown.wait(store,() => true).then(() => {ready=true})]
  assert.equal(timers.size,1)
  admission.dispose();admission.dispose();stop()
  await Promise.all(waits)
  assert.equal(settled,true)
  assert.equal(ready,true)
  assert.equal(timers.size,0)
  const before = updates.length
  latePoll()
  assert.equal(updates.length,before)
})
test('an empty loaded stage becomes ready without waiting for nonexistent direction', () => {
  const effects = [], updates = []
  const admission = createStageAdmission({
    React:{useState:value => [value,next => updates.push(next)],useRef:current => ({current}),
      useEffect:fn => effects.push(fn),useCallback:fn => fn},
    window:{},document:{fonts:{status:'loaded'}},performance:{now:() => 0},
    setTimeout:() => {throw new Error('unexpected poll')},clearTimeout:()=>{},
  })
  const store = {getSnapshot:() => ({accepted:{presentationRevision:0},source:null,empty:true})}
  admission.useEntry(store,{current:{querySelectorAll:() => [],querySelector:() => ({})}})
  effects[0]()
  assert.deepEqual(updates,['ready'])
  assert.equal(admission.shown.get(),store)
  admission.dispose()
  assert.equal(admission.shown.get(),null)
})
