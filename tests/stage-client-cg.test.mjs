import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageCg}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/cg.cjs')
for(const stop of ['unmount','dispose']) test(`stage CG ignores late callbacks and receipts after ${stop}`,async()=>{
  const effects=[],writes=[],listeners=new Set(),calls=[]
  let options,observer,reject
  const token={source:{sessionId:'s',turn:1},visitId:'visit',anchor:{para:1}}
  const state={source:token.source,cursor:{visitId:'visit',anchor:token.anchor},accepted:{provenanceByChannel:{cg:{token}}}}
  const player=createStageCg({
    React:{useRef:value=>({current:value}),useState:value=>[value,next=>writes.push(next)],useMemo:fn=>fn(),useLayoutEffect:fn=>effects.push(fn),useCallback:fn=>fn,createElement:()=>null},
    window:{matchMedia:()=>({addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)})},
    ResizeObserver:class {constructor(fn){observer=this;this.fn=fn}disconnect(){calls.push('disconnect')}},
    consumer:value=>{options=value;return {policy(){calls.push('policy')},redraw(){calls.push('redraw')},present(){calls.push('present')},dispose(){calls.push('dispose');value.onVisible(false)}}},
    policy:()=>({}),rpc:()=>new Promise((_,fail)=>reject=fail),paint:()=>true,
  })
  const view=player.useStage('s',{getSnapshot:()=>state},{forward:true})
  const cleanups=effects.map(fn=>fn()),late=[...listeners][0]
  options.onPlayed({receipt:'receipt'},token)
  if(stop==='unmount')cleanups.forEach(fn=>fn());else player.dispose()
  const count=writes.length,events=calls.length
  reject(new Error('late failure'))
  await Promise.resolve();await Promise.resolve()
  late();observer.fn();options.onVisible(true);options.onPlayed({receipt:'late'},token)
  await view.accept({type:'release-presentation'})
  assert.equal(writes.length,count)
  assert.equal(calls.length,events)
  assert.equal(listeners.size,0)
  assert.equal(calls.filter(x=>x==='dispose').length,1)
  cleanups.forEach(fn=>fn());player.dispose()
})
