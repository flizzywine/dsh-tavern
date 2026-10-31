import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageGallery} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/gallery.cjs')
function hooks(element=null) {
  const effects=[],writes=[]
  return {effects,writes,React:{
    useRef:value=>({current:value===null?element:value}),useState:value=>[value,next=>writes.push(next)],
    useEffect:fn=>effects.push(fn),useLayoutEffect(){},createElement:(type,props,...children)=>({type,props,children}),
  }}
}
test('gallery disposal removes keyboard listener and ignores late catalogue response', async () => {
  const h=hooks(),listeners=new Set()
  let resolve
  const gallery=createStageGallery({...h,window:{addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)},document:{},
    revision:()=>1,rpc:()=>new Promise(done=>resolve=done),
  })
  gallery.Gallery({sessionId:'s',store:{getSnapshot:()=>({source:{sessionId:'s',authorityEpoch:1}})}})
  const releases=h.effects.map(fn=>fn())
  const late=[...listeners][0]
  assert.equal(listeners.size,1)
  gallery.dispose()
  const count=h.writes.length
  resolve({items:[{label:'late'}],nextCursor:null})
  await Promise.resolve();await Promise.resolve()
  late({stopPropagation(){throw new Error('late key')}})
  assert.equal(h.writes.length,count)
  assert.equal(listeners.size,0)
  releases.forEach(fn=>fn?.())
})
test('gallery cancels image preparation and releases a late lease after disposal', async () => {
  const element={parentElement:{getBoundingClientRect:()=>({width:100,height:100})}}
  const h=hooks(element),observers=[]
  let resolve,signal,released=0,consumerDisposed=0
  class Observer {constructor(fn){this.fn=fn;observers.push(this)}observe(){}disconnect(){this.disconnected=true}}
  const gallery=createStageGallery({...h,window:{devicePixelRatio:1},ResizeObserver:Observer,AbortController,
    owner:()=>({prepare:(_,__,options)=>{signal=options.signal;return new Promise(done=>resolve=done)}}),
    consumer:()=>({policy(){},dispose(){consumerDisposed++},present(){throw new Error('late presentation')},redraw(){throw new Error('late resize')}}),
  })
  gallery.Image({image:{focus:{}},authority:'s'})
  const cleanup=h.effects[0]()
  gallery.dispose()
  assert.equal(signal.aborted,true)
  assert.equal(observers[0].disconnected,true)
  observers[0].fn()
  resolve({release(){released++},value:{}})
  await Promise.resolve();await Promise.resolve()
  assert.equal(released,1)
  assert.equal(consumerDisposed,1)
  cleanup();gallery.dispose()
  assert.equal(consumerDisposed,1)
})
