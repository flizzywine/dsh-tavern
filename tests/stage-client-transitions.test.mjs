import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageTransitions} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/transitions.cjs')

for (const stop of ['unmount','dispose']) test(`leave timeout ignores queued callback after ${stop}`, () => {
  const effects = [], pending = new Map(), writes = []
  const view = createStageTransitions({
    React:{useState:() => [{open:false,leaving:true},value => writes.push(value)],useEffect:fn => effects.push(fn)},
    window:{},setTimeout:fn => {pending.set(1,fn); return 1},clearTimeout:id => pending.delete(id),
  })
  assert.equal(view.useLeave(false,{transitions:{menu:{leave:{ms:100}}}},'menu',false),true)
  const cleanup = effects[0](), late = pending.get(1)
  if (stop === 'unmount') cleanup(); else view.dispose()
  assert.equal(pending.size,0)
  late()
  assert.deepEqual(writes,[])
  cleanup()
  view.dispose()
})

test('unmounting a transition surface cancels its animations before plugin disposal', () => {
  const effects = [], cancelled = []
  const part = {getClientRects:() => [1],animate:() => ({cancel:() => cancelled.push(true)})}
  const view = createStageTransitions({
    React:{useRef:value => ({current:value}),useLayoutEffect:fn => effects.push(fn)},window:{},
    getComputedStyle:() => ({display:'block'}),ease:() => 'linear',
  })
  view.useParts({current:{querySelector:() => ({children:[part]})}}, {transitions:{menu:{enter:{ms:200,slide:true}}}}, {menu:true}, false)
  const cleanup = effects[0]()
  effects[1]()
  assert.equal(cancelled.length,0)
  cleanup()
  assert.equal(cancelled.length,1)
  view.dispose()
  assert.equal(cancelled.length,1)
})
