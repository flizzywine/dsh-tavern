import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStagePortraits} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/portraits.cjs')
test('side portrait unmount cancels observers and cannot schedule a late decoded entrance', async () => {
  let resolveDecode, ref = 0, state = 0, frames = 0, disconnected = 0
  const effects = [], timers = new Set(), listeners = new Set()
  const img = {tagName:'IMG',complete:true,naturalWidth:10,style:{},classList:{contains:() => false},decode:() => new Promise(resolve => {resolveDecode=resolve})}
  const root = {querySelectorAll:() => [img],addEventListener:(_,fn) => listeners.add(fn),removeEventListener:(_,fn) => listeners.delete(fn)}
  const React = {
    createElement:(type,props,...children) => ({type,props,children}),
    useRef:value => ({current:++ref === 3 ? root : value}),
    useState:value => [++state === 1 ? [{id:1,key:'a',src:'a.png',enter:'slide',out:''}] : value,() => {}],
    useLayoutEffect:fn => effects.push(fn),
  }
  const views = createStagePortraits({React,
    foreground:{setTimeout:fn => {timers.add(fn);return fn},clearTimeout:fn => timers.delete(fn),requestAnimationFrame:() => ++frames,cancelAnimationFrame(){}},
    MutationObserver:class {observe(){} disconnect(){disconnected++}},
  })
  views.Side({face:{key:'a',src:'a.png'}})
  const cleanup = effects.map(fn => fn())
  assert.equal(typeof resolveDecode,'function')
  cleanup.forEach(fn => fn?.())
  resolveDecode()
  await Promise.resolve();await Promise.resolve()
  assert.equal(frames,0)
  assert.equal(timers.size,0)
  assert.equal(listeners.size,0)
  assert.equal(disconnected,1)
})
test('face column stays fixed during a page and forgets learned faces across sessions', () => {
  const refs=[],React={useRef:value=>{const index=React.at++;return refs[index] ||= {current:value}}}
  const views=createStagePortraits({React})
  const read=(session,page,portraits)=>{React.at=0;return views.useFaceColumn(session,page,'alice',portraits,[],true,false)}
  assert.equal(read('one',1,new Map()),false)
  assert.equal(read('one',1,new Map([['alice',{}]])),false)
  assert.equal(read('one',2,new Map()),true)
  assert.equal(read('two',1,new Map()),false)
})
test('face handoff timer cannot release a superseded page or update after unmount', () => {
  let effect,callback,updates=0
  const ref={current:null}
  const views=createStagePortraits({React:{useRef:()=>ref,useState:()=>[0,()=>updates++],useEffect:fn=>{effect=fn}},
    foreground:{setTimeout:fn=>{callback=fn;return 1},clearTimeout(){}}})
  views.useFaceHandoff('spoken',{facing:true,shown:true,moves:true})
  const held=views.useFaceHandoff('narration',{facing:false,shown:false,moves:true})
  assert.equal(held.holding,true)
  assert.equal(held.heldMs,152)
  const cleanup=effect(),late=callback
  views.useFaceHandoff('next',{facing:true,shown:true,moves:true})
  late()
  assert.equal(updates,0)
  cleanup();late()
  assert.equal(updates,0)
  assert.equal(views.handoffAutoDelay(100,152),0)
})
