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
