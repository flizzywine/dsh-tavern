import test from 'node:test'
import assert from 'node:assert/strict'
import { createMvuWorkingCopy } from '../tavern-plugin/lib/domain/mvu-working-copy.js'
import { createMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'

for (const count of [20, 400, 10000]) test(`fixed MVU edit visits bounded history at ${count} floors`, () => {
  let reads = 0
  const source = Array.from({length:count}, () => ({swipeId:0,variables:[{stat_data:{hp:10}}]}))
  const messages = new Proxy(source, {get(target,key,receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++
    return Reflect.get(target,key,receiver)
  }})
  const base = {id:'c',messages}
  const work = createMvuWorkingCopy(base,'e')
  work.touch(count-1).variables[0].stat_data.hp = 9
  const effect = createMvuSettlementEffect({operationId:'o',before:base,after:work.chat,messageIndices:work.dirty})
  assert.deepEqual(effect.changes,[{op:'set',path:['messages',count-1,'variables',0,'stat_data','hp'],value:9}])
  assert.ok(reads <= 8, `one changed floor read ${reads} historical rows`)
  assert.equal(source.at(-1).variables[0].stat_data.hp,10)
})

import { applyMvuSettlementEffect, diffMvuChanges } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

for (const count of [20, 400, 10000]) test(`scoped timeline completion visits only selected floors at ${count}`, () => {
  let reads=0
  const source=[]; source.length=count; source[count-1]={swipeId:0,variables:[{hp:10}]}
  const messages=new Proxy(source,{get(target,key,receiver){
    if(typeof key==='string' && /^\d+$/.test(key)) reads++
    return Reflect.get(target,key,receiver)
  }})
  const before={id:'c',sessionId:'s',messages,timeline:{schemaVersion:1,branchId:'b',revision:1,checkpoints:[],participants:{},operations:{o:{id:'o',kind:'agent',role:'settlement',status:'running',basedOn:{branchId:'b',revision:1}}}}}
  const effect={version:1,operationId:'o',chatId:'c',sessionId:'s',branchId:'b',basedOnRevision:1,expectedLifecycleRevision:0,messageId:count-1,swipeId:0,changes:[{op:'set',path:['messages',count-1,'variables',0,'hp'],value:9}]}
  const scope={messageIndices:[count-1]}
  const completed=createStoryTimeline().complete({chat:before,...scope,operationId:'o',basedOn:{branchId:'b',revision:1},outcome:{status:'success'},apply:chat=>applyMvuSettlementEffect(chat,effect,scope)})
  const changes=diffMvuChanges(before,completed.chat,scope.messageIndices)
  assert.equal(completed.value.status,'committed')
  assert.equal(completed.chat.messages[count-1].variables[0].hp,9)
  assert.equal(before.messages[count-1].variables[0].hp,10)
  assert.ok(changes.some(c=>c.path.join('.')===`messages.${count-1}.variables.0.hp`))
  assert.ok(reads <= 4, `completion read ${reads} rows`)
})

test('overlay materializes full legacy projections without leaking draft writes',()=>{
  const base={messages:[{text:'a'},{text:'b'},{text:'c'}]}
  const work=createMvuWorkingCopy(base,'e')
  work.touch(1).text='changed'
  assert.deepEqual(work.chat.messages.map(m=>m.text),['a','changed','c'])
  assert.deepEqual(JSON.parse(JSON.stringify(work.chat)).messages,[{text:'a'},{text:'changed'},{text:'c'}])
  assert.equal(base.messages[1].text,'b')
})

test('scoped effects reject undeclared floors before publishing partial changes',()=>{
  const chat={id:'c',sessionId:'s',messages:[{swipeId:0,variables:[{hp:10}]},{swipeId:0,variables:[{hp:20}]}]}
  const before=structuredClone(chat)
  const effect={version:1,operationId:'o',chatId:'c',sessionId:'s',expectedLifecycleRevision:0,messageId:0,swipeId:0,changes:[
    {op:'set',path:['messages',0,'variables',0,'hp'],value:9},
    {op:'set',path:['messages',1,'variables',0,'hp'],value:19}
  ]}
  assert.throws(()=>applyMvuSettlementEffect(chat,effect,{messageIndices:[0]}),/undeclared/)
  assert.deepEqual(chat,before)
  effect.changes[1]={op:'set',path:['messages',0,'missing','hp'],value:19}
  assert.throws(()=>applyMvuSettlementEffect(chat,effect,{messageIndices:[0]}),/Missing/)
  assert.deepEqual(chat,before)
})
