import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageHints} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/hints.cjs')
test('unloading stage hints removes the click interceptor and ignores late storage loading', async () => {
  const events=new Map(), clicks=new Set(), timers=new Set(), effects=[]
  let resolveLoad, updates=0
  const React={useState:value=>[value,()=>updates++],useSyncExternalStore:(_,get)=>get(),useEffect:fn=>effects.push(fn),useRef:value=>({current:value}),useCallback:fn=>fn,useMemo:fn=>fn()}
  const hints=createStageHints({React,
    window:{addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type)},
    document:{addEventListener:(_,fn)=>clicks.add(fn),removeEventListener:(_,fn)=>clicks.delete(fn)},
    storage:{load:()=>new Promise(resolve=>{resolveLoad=resolve}),loaded:()=>true,seen:()=>false},
    music:{subscribeBlocked(){},blocked:()=>true},
    setTimeout:fn=>{timers.add(fn);return fn},clearTimeout:fn=>timers.delete(fn),
  })
  hints.useHints(true,{current:{contains:()=>true}},0)
  const cleanup=effects.map(fn=>fn())
  events.get('pointerdown')({type:'pointerdown',target:{closest:()=>false}})
  assert.equal(clicks.size,1)
  assert.equal(timers.size,1)
  hints.dispose();hints.dispose()
  const before=updates
  resolveLoad();await Promise.resolve();await Promise.resolve()
  assert.equal(updates,before)
  assert.equal(clicks.size,0)
  assert.equal(timers.size,0)
  assert.equal(events.size,0)
  cleanup.forEach(fn=>fn?.())
})
