import test from 'node:test'
import assert from 'node:assert/strict'
import {projectChatSessionState} from '../tavern-plugin/lib/domain/chat-session-state.js'
import {createStoryTimeline} from '../tavern-plugin/lib/domain/story-timeline.js'

for(const count of [20,400,10000])test(`session activity ignores ${count} historical checkpoint rows`,()=>{
 let reads=0
 const history=Array.from({length:count},()=>({get text(){reads++;return 'historical body'}}))
 const source={id:'c',messages:[],timeline:{schemaVersion:1,branchId:'b',revision:1,participants:{},operations:{},checkpoints:[{id:'cp',before:{messages:history}}]}}
 const state=projectChatSessionState(source,{messages:[],pendingMvuSettlement:null})
 const view=createStoryTimeline().inspect({chat:state})
 assert.equal(view.checkpointCount,1)
 assert.equal(view.branchId,'b')
 assert.equal(reads,0,`read ${reads} unused historical rows`)
 // Lazy access is still detached and complete when explicitly requested.
 state.timeline.checkpoints[0].before.messages[0].text='changed'
 assert.equal(source.timeline.checkpoints[0].before.messages[0].text,'historical body')
 assert.equal(state.timeline.checkpoints[0].before.messages.length,count)
})

import {copyLazyHistoryHeader} from '../tavern-plugin/lib/domain/lazy-history-read.js'

test('display header checkpoint count is lazy and explicit reads stay complete',()=>{
 let reads=0
 const source={timeline:{checkpoints:[{id:'first',get before(){reads++;return {text:'body'}}}]}}
 const header=copyLazyHistoryHeader(source)
 assert.equal(header.timeline.checkpoints.length,1)
 assert.deepEqual(Object.keys(header.timeline.checkpoints),['0'])
 assert.equal(reads,0)
 assert.deepEqual(JSON.parse(JSON.stringify(header)),JSON.parse(JSON.stringify(source)))
 header.timeline.checkpoints[0].before.text='outside'
 assert.equal(source.timeline.checkpoints[0].before.text,'body')
 assert.equal(copyLazyHistoryHeader(source).timeline.checkpoints[0].before.text,'body')
})

test('rollback target reads normalized checkpoint metadata without cloning story rows',()=>{
 let reads=0
 const messages=Array.from({length:400},()=>({get text(){reads++;return 'body'}}))
 const timeline={schemaVersion:1,branchId:'b',revision:4,participants:{},operations:{},checkpoints:[{id:'cp',beforeRevision:3}]}
 const engine=createStoryTimeline()
 assert.deepEqual(engine.rollbackTarget({chat:{messages,timeline}}),{checkpointId:'cp',beforeRevision:3})
 assert.equal(reads,0,'rollback metadata must not serialize message history')
 assert.equal(engine.rollbackTarget({chat:{messages,timeline:{...timeline,schemaVersion:0}}}),null)
 assert.equal(reads,0,'legacy schema reset must not serialize message history either')
})

for(const checkpoints of [null,{},[],[{}]])test(`timeline inspection preserves normalized checkpoint count: ${JSON.stringify(checkpoints)}`,()=>{
 const engine=createStoryTimeline({id:()=> 'b',now:()=>1})
 for(const schemaVersion of [0,1]){
  const chat={timeline:{schemaVersion,branchId:'b',revision:1,checkpoints,operations:{},participants:{}}}
  assert.equal(engine.inspect({chat}).checkpointCount,schemaVersion===1 && Array.isArray(checkpoints) ? checkpoints.length : 0)
 }
})

for(const count of [20,400,10000])test(`large internal header records detach only accessed keys at ${count}`,()=>{
 let reads=0,enumerations=0
 const source=new Proxy(Object.fromEntries(Array.from({length:count},(_,id)=>[String(id),{value:id}])),{
  get(target,key,receiver){reads++;return Reflect.get(target,key,receiver)},
  ownKeys(target){enumerations++;return Reflect.ownKeys(target)}
 })
 const header=copyLazyHistoryHeader({regeneratedDshTurns:source,runtimeInputs:source})
 const spread={...header}
 assert.equal(reads,0);assert.equal(enumerations,0)
 assert.equal(spread.runtimeInputs['0'].value,0);assert.equal(reads,1)
 spread.runtimeInputs['0'].value=99
 assert.equal(header.regeneratedDshTurns['0'].value,0)
 spread.runtimeInputs.new={value:1};delete spread.runtimeInputs['1']
 assert.equal(Object.hasOwn(spread.runtimeInputs,'1'),false)
 assert.equal(copyLazyHistoryHeader({runtimeInputs:source}).runtimeInputs['0'].value,0)
 assert.equal(enumerations,0)
 const plain=JSON.parse(JSON.stringify(spread.runtimeInputs))
 assert.equal(plain['0'].value,99);assert.equal(Object.hasOwn(plain,'1'),false);assert.equal(plain.new.value,1)
 assert.equal(Object.keys(plain).length,count)
})
