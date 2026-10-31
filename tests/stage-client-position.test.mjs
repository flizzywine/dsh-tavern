import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStagePosition}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/position.cjs')
test('reading position retains old storage format and becomes terminal on plugin disposal',()=>{
 const data=new Map([['fork-stage-position:s',JSON.stringify({turn:3,page:2,textDigest:'old'})]])
 const timers=new Set();let writes=0
 const position=createStagePosition({setTimeout:fn=>{timers.add(fn);return fn},clearTimeout:fn=>timers.delete(fn)})
 const writer=position.writer('s',{getItem:key=>data.get(key),setItem:(key,value)=>{writes++;data.set(key,value)}})
 assert.equal(writer.saved.page,2)
 writer.write({turn:4,page:1,textDigest:'new'})
 const late=[...timers][0]
 position.dispose();position.dispose()
 assert.equal(JSON.parse(data.get('fork-stage-position:s')).turn,4)
 writer.write({turn:99});late()
 assert.equal(writes,1)
 assert.equal(timers.size,0)
})
test('bookmarks wait for complete matching text and restore paragraph anchors after pagination changes',()=>{
 const position=createStagePosition({})
 const parts=[{text:'abcdef'}],pages=[{para:1,text:'abc'},{para:1,text:'def'}]
 const digest=position.digest(parts),saved={turn:2,page:0,pageCount:1,textDigest:digest,anchor:{para:1,offset:4}}
 assert.equal(position.ready(saved,2,[{text:'abc',streaming:true}],pages),false)
 assert.equal(position.ready(saved,2,[{text:'other'}],pages),false)
 assert.equal(position.ready(saved,2,parts,pages),true)
 assert.equal(position.restore(saved,2,2,digest,pages).page,1)
 assert.equal(position.restore(saved,3,2,digest,pages).page,0)
 assert.equal(position.digest([{text:'abcdef',voices:['new voice']}]),digest)
})
test('position hook releases pagehide on plugin disposal and rejects callbacks from an unmounted session',()=>{
 for(const mode of ['unmount','plugin']) {
  const effects=[],listeners=new Set();let selected=0,navigated=0,dispatched=0
  const position=createStagePosition({React:{useMemo:fn=>fn(),useEffect:fn=>effects.push(fn)},
   window:{addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)},
   setTimeout:()=>1,clearTimeout(){},sameAnchor:(a,b)=>a===b,navigate:()=>navigated++})
  const anchor={para:1,offset:0},parts=[{text:'text'}],pages=[{text:'text',anchor}]
  const runtime={source:{turn:1},cursor:{mode:'live',anchor},text:{},store:{dispatch:()=>dispatched++}}
  const result=position.usePosition('s',runtime,parts,pages,{restored:true,onSelect:()=>selected++})
  const stops=effects.map(fn=>fn())
  assert.equal(listeners.size,1)
  if(mode==='unmount')stops.forEach(fn=>fn?.());else position.dispose()
  assert.equal(listeners.size,0)
  result[1](1);result[3]()
  assert.equal(selected,0);assert.equal(navigated,0);assert.equal(dispatched,0)
  stops.forEach(fn=>fn?.());position.dispose()
 }
})
