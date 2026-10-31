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

test('CG effect replay creates a fresh player and fences receipts from the previous mount',async()=>{
  const effects=[],players=[],writes=[]
  let reject
  const token={source:{sessionId:'s',turn:1},visitId:'v',anchor:{para:1}}
  const state={source:token.source,cursor:{visitId:'v',anchor:token.anchor},accepted:{provenanceByChannel:{cg:{token}}}}
  const cg=createStageCg({
    React:{useRef:value=>({current:value}),useState:value=>[value,next=>writes.push(next)],useMemo:fn=>fn(),useLayoutEffect:fn=>effects.push(fn),useCallback:fn=>fn,createElement:()=>null},
    window:{},ResizeObserver:class {disconnect(){}},policy:()=>({}),
    consumer:callbacks=>{const p={callbacks,presented:0,policy(){},present(){this.presented++},dispose(){this.dead=true}};players.push(p);return p},
    rpc:()=>new Promise((_,fail)=>reject=fail),
  })
  const view=cg.useStage('s',{getSnapshot:()=>state},{forward:true})
  assert.equal(players.length,0,'render itself must not allocate a player')
  const first=effects.map(fn=>fn())
  players[0].callbacks.onPlayed({receipt:'old'},token)
  first.forEach(fn=>fn())
  const second=effects.map(fn=>fn())
  assert.equal(players.length,2)
  assert.equal(players[0].dead,true)
  await view.accept({type:'release-presentation'})
  assert.equal(players[1].presented,1)
  reject(new Error('old receipt'))
  await Promise.resolve();await Promise.resolve()
  assert.deepEqual(writes,[])
  second.forEach(fn=>fn());cg.dispose()
  assert.equal(players[1].dead,true)
})
