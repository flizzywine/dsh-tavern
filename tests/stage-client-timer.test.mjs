import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageTimer} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/timer.cjs')
test('timer disposal closes its lease once and ignores pending events and fallback offers', async () => {
  const effects = [], intervals = new Set(), listeners = new Map(), requests = [], updates = [], events = []
  let resolveOpen
  const timer = createStageTimer({
    React:{useState:value => [value,next => updates.push(next)],useRef:current => ({current}),useEffect:fn => effects.push(fn)},
    rpc:(_,args) => {requests.push(args);return args.action === 'open' ? new Promise(resolve => {resolveOpen=resolve}) : Promise.resolve({})},
    window:{addEventListener:(name,fn) => listeners.set(name,fn),removeEventListener:name => listeners.delete(name)},
    crypto:{randomUUID:() => 'lease'},performance:{now:() => 0},
    setInterval:fn => {intervals.add(fn);return fn},clearInterval:fn => intervals.delete(fn),
  })
  timer.useTimer({sessionId:'s',mode:'live',view:{},onEvent:event => events.push(event),onFallback:event => events.push(event)})
  const stops = effects.map(fn => fn()).filter(Boolean)
  assert.equal(intervals.size,1)
  timer.dispose();timer.dispose()
  stops.forEach(stop => stop())
  assert.equal(intervals.size,0)
  assert.equal(listeners.size,0)
  assert.deepEqual(requests.map(request => request.action),['open','close'])
  assert.equal(requests[1].lease,'lease')
  resolveOpen({now:1,event:{id:'late'},fallbackAction:'reply'})
  await Promise.resolve();await Promise.resolve()
  assert.deepEqual(events,[])
  assert.deepEqual(updates,[])
})
test('timer view preserves countdown labels and player pause control', () => {
  let paused = 0, stopped = 0
  const timer = createStageTimer({
    React:{useRef:current => ({current}),useLayoutEffect(){},createElement:(type,props,...children) => ({type,props,children})},
  })
  const result = timer.Component({
    state:{timer:{mode:'reply'},remaining:65000,status:'running',live:true,ticking:true,togglePause:() => paused++},
    look:{kind:'pill',format:'mm:ss',pause:true,icon:'icon.png'},
  })
  const plate = result.children[0]
  assert.equal(plate.props.role,'timer')
  assert.match(plate.props['aria-label'],/回应时限/)
  assert.match(plate.props['aria-label'],/1:05/)
  const button = plate.children.at(-1)
  assert.equal(button.props['aria-label'],'暂停计时')
  button.props.onClick({stopPropagation:() => stopped++})
  assert.equal(paused,1)
  assert.equal(stopped,1)
})
test('timer layout observers and queued frame are removed immediately on plugin disposal', () => {
  const effects = [], frames = new Map(), observers = []
  const stage = {querySelectorAll:() => []}
  const root = {closest:() => stage,querySelector:() => null}
  const observer = class {
    constructor(fn) {this.fn=fn;observers.push(this)}
    observe() {}
    disconnect() {this.stopped=true}
  }
  const timer = createStageTimer({
    React:{useRef:() => ({current:root}),useLayoutEffect:fn => effects.push(fn),createElement:()=>{}},
    ResizeObserver:observer,MutationObserver:observer,
    foreground:{requestAnimationFrame:fn => {frames.set(1,fn);return 1},cancelAnimationFrame:id => frames.delete(id)},
  })
  timer.Component({state:{timer:null},look:null})
  const stop = effects[0]()
  observers[0].fn()
  assert.equal(frames.size,1)
  timer.dispose();stop()
  assert.equal(frames.size,0)
  assert.equal(observers.every(item => item.stopped),true)
  observers[0].fn()
  assert.equal(frames.size,0)
})
test('page disposal during reaction preparation releases late resources without creating a layer', async () => {
  let finish, preparing, released = 0, layers = 0
  const started = new Promise(resolve => {preparing=resolve})
  const timer = createStageTimer({
    rpc:async () => ({status:'ready',performance:{}}),
    getResourceOwner:() => ({prepare:() => {preparing();return new Promise(resolve => {finish=resolve})}}),
    resourceAuthority:value => value,createKeyframeLayer:() => {layers++},
  })
  const page = timer.createReactionScope()
  const pending = page.play({root:{isConnected:true},event:{id:'e'}})
  await started
  page.dispose()
  finish({release:() => released++})
  await pending
  assert.equal(released,1)
  assert.equal(layers,0)
  timer.dispose()
})
test('reaction startup failure and plugin disposal both release layer, layout and pins', async () => {
  for (const fail of [false,true]) {
    const released = [], timers = new Set()
    const timer = createStageTimer({
      rpc:async () => ({status:'ready',performance:{}}),
      getResourceOwner:() => ({prepare:async () => ({value:{dependencies:[]},pins:[],release:() => released.push('pins')})}),
      resourceAuthority:value => value,
      createRects:() => ({dispose:() => released.push('rects')}),
      createKeyframeLayer:() => ({apply:() => {if(fail) throw new Error('apply failed')},dispose:() => released.push('layer')}),
      foreground:{setTimeout:fn => {timers.add(fn);return fn},clearTimeout:fn => timers.delete(fn)},
    })
    const pending = timer.createReactionScope().play({root:{isConnected:true},event:{id:'e'}})
    if (fail) await assert.rejects(pending,/apply failed/)
    else {await pending;assert.equal(timers.size,1)}
    timer.dispose();timer.dispose()
    assert.deepEqual(released,['layer','rects','pins'])
    assert.equal(timers.size,0)
  }
})
