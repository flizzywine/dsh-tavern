import test from 'node:test'
import assert from 'node:assert/strict'
import {readSettlementInput} from '../tavern-plugin/lib/domain/settlement-input.js'
const window = () => ({from:9997,messageCount:10000,revision:8,chat:{id:'c',_storageRevision:8,
 backgroundConfigVersion:1,conversationFeaturesVersion:1,timeline:{schemaVersion:1,revision:3,checkpoints:[],operations:{}},
 preparedWorldBook:{revision:3},mvu:{enabled:true,owner:'official'},messages:[{role:'assistant',text:'prior'},
 {role:'tavern-helper',text:'helper'},{role:'assistant',turn:5000,mvu:{pending:true,variableRetry:true},variables:[{hp:8}]}]}})

for(const reason of ['depth','unreadable','target','legacy','boundary','format','revision'])test(`unsupported ${reason} input retains full read`,async()=>{
 const value=window()
 if(['depth','unreadable'].includes(reason))value.chat.preparedWorldBook.revision=2
 if(reason==='depth')value.depth=3
 if(reason==='unreadable')value.depth=Infinity
 if(reason==='target')delete value.chat.messages[2].mvu
 if(reason==='legacy')value.chat.timeline.operations.old={kind:'body',status:'foreground-completed'}
 if(reason==='boundary')value.chat.messages[0].role='user'
 if(reason==='format')value.chat.conversationFeaturesVersion=0
 if(reason==='revision')value.revision++
 let full=0
 const result=await readSettlementInput('c',{readWindow:async()=>value,readChat:async()=>{full++;return 'full'},scanDepth:async()=>value.depth??0})
 assert.equal(result,'full');assert.equal(full,1)
})

for(const [name,edit] of [['ordinary reply',value=>delete value.chat.messages[2].mvu.variableRetry],
  ['stale recall within the window',value=>{value.chat.preparedWorldBook.revision=2;value.depth=1}],
  ['stale recall over the whole history',value=>{value.chat.preparedWorldBook.revision=2;value.depth=50;value.from=0;value.messageCount=3}]])test(`bounded settlement input: ${name}`,async()=>{
 const value=window();edit(value)
 const result=await readSettlementInput('c',{readWindow:async()=>value,readChat:async()=>assert.fail('full read'),scanDepth:async()=>value.depth??0})
 assert.equal(result.messages.length,value.messageCount)
 assert.equal(result.messages[value.from+2].turn,5000)
 assert.equal(result.messages[value.from-1],undefined)
})

// A game without official MVU variables settles from the last reply and the row
// before it: the window is enough, and reading the whole save for one posture was
// the bulk of a plain settlement.
const plain = () => ({from:9997,messageCount:10000,revision:8,chat:{id:'c',_storageRevision:8,
 backgroundConfigVersion:1,conversationFeaturesVersion:1,timeline:{schemaVersion:1,revision:3,checkpoints:[],operations:{}},
 mvu:{enabled:false,owner:null},messages:[{role:'user',text:'问'},{role:'tavern-helper',text:'helper'},{role:'assistant',turn:5000,text:'答'}]}})

test('无 MVU 的卡：窗口覆盖最后两行时不做整份读',async()=>{
 let full=0
 const result=await readSettlementInput('c',{readWindow:async()=>plain(),readChat:async()=>{full++;return 'full'},scanDepth:async()=>2})
 assert.equal(full,0)
 assert.equal(result.messages[9999].text,'答')
 assert.equal(result.messages[9996],undefined)
})

for(const [name,edit] of [['窗口只剩最后一条',value=>{value.chat.messages=[{role:'assistant',turn:5000,text:'答'}]}],
 ['窗口里没有正文',value=>{value.chat.messages=[{role:'user',text:'问'}]}]])test(`无 MVU 的卡：${name}时保留整份读`,async()=>{
 const value=plain();edit(value)
 let full=0
 const result=await readSettlementInput('c',{readWindow:async()=>value,readChat:async()=>{full++;return 'full'},scanDepth:async()=>2})
 assert.equal(result,'full');assert.equal(full,1)
})
