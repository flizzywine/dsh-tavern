import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createImportContextPreparation } from '../tavern-plugin/lib/domain/import-context-preparation.js'
import { buildImportedConversation, appendImportedEvents } from '../tavern-plugin/lib/domain/chat-history-session.js'
import { parseChatHistory } from '../tavern-plugin/lib/domain/chat-history-import.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createHistoryRecall } from '../tavern-plugin/lib/domain/history-recall.js'

import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
const estimateMessage = message => message.content.reduce((n,b)=>n+(b.text?.length||0),0)+8
async function fixture() {
  const session=Session.create('context-test')
  session.append('user/message',{id:'tavern-session-prefix:context-test',role:'user',content:[{type:'text',text:'Fixed setting'}],source:{kind:'plugin',plugin:'dsh-tavern',form:'snapshot'}},{surfaceOp:'append'})
  const rows=[{chat_metadata:{}},{is_user:false,mes:'Original opening'}]
  for(let n=0;n<12;n++)rows.push({is_user:true,mes:'action '+n},{is_user:false,mes:'Secret-'+n+' '+(n===11?'RevokedOnlyQuartz ':'')+'.'.repeat(200)})
  let chat=createStoryTimeline().apply({chat:{id:'chat',sessionId:session.id,mode:'story',messages:[],scriptState:null},intent:{kind:'ensure'}}).chat
  const plan=await buildImportedConversation(chat,parseChatHistory(rows.map(JSON.stringify).join('\n')),{operationId:'import-context-test',framePlan:{text:'Rules',sections:[{kind:'base',required:true,text:'Rules'}]}})
  await appendImportedEvents(session,plan,async()=>{})
  session.append('user/message',{id:'new-input',role:'user',content:[{type:'text',text:'Continue'}],source:{kind:'user'}},{surfaceOp:'append'})
  const request={sessionId:session.id,provider:'fixture',model:'small',system:'System rules',messages:session.deriveMessages(),maxTokens:200}
  let capacity=1200,failSave=false,modelCalls=0,flushes=0
  const options={readChat:async()=>structuredClone(chat),updateChat:async(id,fn)=>{if(failSave){failSave=false;throw Error('save failed')}chat=fn(structuredClone(chat))},getSession:()=>session,
    flush:async()=>{flushes++},modelInfo:async()=>{modelCalls++;return {context:{contextWindow:capacity}}},estimateMessage}
  return {session,request,options,get chat(){return chat},get flushes(){return flushes},get modelCalls(){return modelCalls},failSave:()=>{failSave=true},capacity:n=>{capacity=n}}
}

test('retry after publication failure reuses the durable replacement rather than trimming again',async()=>{
  const h=await fixture();h.failSave()
  await assert.rejects(createImportContextPreparation(h.options).prepare(h.request),/save failed/)
  const count=sessionEvents(h.session).length
  await createImportContextPreparation(h.options).prepare(h.request)
  assert.equal(sessionEvents(h.session).length,count)
  assert.equal(h.chat.importHistory.contextPreparation.status,'trimmed')
  assert.equal(h.modelCalls,1)
})
test('capacity exclusion stays recallable, but a native story rollback removes the revoked round from recall',async()=>{
  const h=await fixture()
  await createImportContextPreparation(h.options).prepare(h.request)
  await h.options.updateChat(h.chat.id,chat=>{
    const checkpoint=chat.timeline.checkpoints.at(-1)
    checkpoint.before={...checkpoint.importBefore,messages:structuredClone(chat.messages.slice(0,checkpoint.importMessageCount))}
    return createStoryTimeline().apply({chat,intent:{kind:'turn.rollback',turn:checkpoint.turn}}).chat
  })
  const recall=createHistoryRecall()
  assert.equal(recall.recall({chat:h.chat,query:'Secret-0'}).found,true,'capacity-excluded history still happened')
  assert.equal(recall.recall({chat:h.chat,query:'RevokedOnlyQuartz'}).found,false,'rolled-back history was revoked')
  assert.equal(recall.recall({chat:h.chat,turn:13,radius:0}).found,false)
})
test('unknown model capacity and an oversized mandatory tail fail before touching the Surface',async()=>{
  for(const capacity of [undefined,200]){
    const h=await fixture();h.capacity(capacity)
    const before=sessionEvents(h.session).length
    await assert.rejects(createImportContextPreparation(h.options).prepare(h.request),/模型|容量/)
    assert.equal(sessionEvents(h.session).length,before)
  }
})
test('ordinary and already-checked chats are decided from the header without a full read',async()=>{
  const h=await fixture()
  let fullReads=0
  const options={...h.options,readChat:async()=>{fullReads++;return h.options.readChat()}}
  for(const header of [{id:'chat'},{id:'chat',importHistory:{operationId:'x',contextPreparation:{status:'unchanged'}}}]){
    const request=await createImportContextPreparation({...options,readHeader:async()=>header}).prepare(h.request)
    assert.equal(request,h.request)
  }
  assert.equal(fullReads,0)
  await createImportContextPreparation({...options,readHeader:async()=>({id:'chat',importHistory:h.chat.importHistory})}).prepare(h.request)
  assert.equal(fullReads,1)
  assert.equal(h.chat.importHistory.contextPreparation.status,'trimmed')
})
