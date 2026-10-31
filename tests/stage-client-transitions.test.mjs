import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageTransitions} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/transitions.cjs')

test('transition durations preserve authored timing and reduced-motion policy', () => {
  let reduced = false
  const view = createStageTransitions({window:{matchMedia:() => ({matches:reduced})}})
  const skin = {transitions:{menu:{leave:{ms:400,delay:80}}}}
  assert.equal(view.leaveMs(skin,'menu',false),480)
  reduced = true
  assert.equal(view.leaveMs(skin,'menu',false),150)
  assert.equal(view.leaveMs(skin,'menu',true),0)
  assert.equal(view.leaveMs(skin,'config',false),0)
})

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

test('part animations replace old poses and all cancel even when one cancellation fails', () => {
  const played = []
  const part = {getClientRects:() => [1],animate:(frames,timing) => {
    const animation = {frames,timing,cancelled:0,cancel() {this.cancelled++; if (this.fail) throw new Error('cancel failed')}}
    played.push(animation)
    return animation
  }}
  const view = createStageTransitions({getComputedStyle:() => ({display:'block'}),ease:value => value})
  const surface = {children:[part]}, spec = {ms:200,delay:20,slide:true,pose:{dx:5},ease:'linear'}
  view.playParts(surface,spec,'enter')
  assert.equal(played.length,2)
  assert.equal(played[0].timing.fill,'backwards')
  view.playParts(surface,spec,'leave')
  assert.deepEqual(played.slice(0,2).map(x => x.cancelled),[1,1])
  assert.equal(played[2].timing.fill,'forwards')
  played[2].fail = true
  assert.throws(() => view.dispose(),/Stage transition cleanup failed/)
  assert.deepEqual(played.map(x => x.cancelled),[1,1,1,1])
  view.dispose()
  view.playParts(surface,spec,'enter')
  assert.equal(played.length,4)
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
