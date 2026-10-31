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
