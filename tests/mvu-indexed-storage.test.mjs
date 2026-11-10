import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {readSettlementInput} from '../tavern-plugin/lib/domain/settlement-input.js'
import {collectMvuHelperContext,createMvuBackgroundTaskFrame,projectMvuBackgroundRequest} from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

for(const count of [20,400,10000]) test(`warm storage point patch and settlement input stay bounded at ${count}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'mvu-indexed-'));t.after(()=>rm(root,{recursive:true,force:true}))
 let visits=0
 const store=createChatJournalStore({dataRoot:root,frameLimit:1e6,byteLimit:1e9,onIndexedMessageVisit:()=>visits++})
 const db=createChatPersistence({store})
 await db.write({id:'c',sessionId:'s',messages:Array.from({length:count},(_,id)=>({role:'assistant',turn:id+1,variables:[{stat_data:{hp:10},schema:{}}]}))})
 const base=await db.readSettlementBase('c');const rev=base.chat._storageRevision
 visits=0
 await db.patch('c',rev,[{op:'set',path:['messages',count-1,'variables',0,'stat_data','hp'],value:9}],{returnProjection:'settlement'})
 const next=await db.readSettlementBase('c')
 assert.equal(next.previousMvu(count-1),count-2)
 assert.equal(next.chat.messages[count-1].variables[0].stat_data.hp,9)
 assert.equal(base.chat.messages[count-1].variables[0].stat_data.hp,10)
 assert.ok(visits<=128,`point update and scoped reads visited ${visits} nodes`)
 next.chat.messages[count-1].variables[0].stat_data.hp=100
 assert.equal((await db.readSlice('c',[count-1])).chat.messages[0].variables[0].stat_data.hp,9,'lazy rows must be detached')
 const reopened=createChatJournalStore({dataRoot:root})
 assert.equal((await reopened.read('c')).messages[count-1].variables[0].stat_data.hp,9)
})

test('settlement starts with a short tail on a 400-floor save and preserves the exact model request context',async t=>{
 const root=await mkdtemp(join(tmpdir(),'mvu-settlement-tail-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot:root,newConversations:true,frameLimit:1e6,byteLimit:1e9})
 const db=createChatPersistence({store})
 const messages=Array.from({length:400},(_,index)=>({role:index%2?'user':'assistant',turn:index+1,text:'history '+index,variables:[{stat_data:{hp:10},schema:{}}]}))
 messages[396]={role:'assistant',turn:199,text:'prior reply',variables:[{stat_data:{hp:10},schema:{}}]}
 messages[397]={role:'tavern-helper',text:'helper handoff'}
 messages[398]={role:'user',turn:200,text:'current input'}
 messages[399]={role:'assistant',turn:200,text:'current reply',mvu:{pending:true},variables:[{stat_data:{hp:10},schema:{}}]}
 const chat={id:'c',sessionId:'s',backgroundConfigVersion:1,conversationFeaturesVersion:1,
  timeline:{schemaVersion:1,revision:3,checkpoints:[],operations:{}},preparedWorldBook:{revision:3},
  mvu:{enabled:true,owner:'official'},messages}
 await db.write(chat)
 const coldStore=createChatJournalStore({dataRoot:root})
 const coldDb=createChatPersistence({store:coldStore})
 const requests=[]
 const actual=await readSettlementInput('c',{readWindow:async(id,options)=>{requests.push(options);return coldDb.readWindow(id,options)},readChat:async()=>assert.fail('short tail should be sufficient'),scanDepth:async()=>0})
 const former=await readSettlementInput('c',{readWindow:(id,options)=>coldDb.readWindow(id,{...options,limit:200}),readChat:async()=>assert.fail('former 200-row window should be sufficient'),scanDepth:async()=>0})
 assert.equal(actual.messages.length,400)
 assert.deepEqual(requests.map(item=>item.limit),[8])
 assert.equal(Object.keys(actual.messages).length,8,'only eight rows are owned by the scoped history')
 assert.equal(Object.keys(former.messages).length,200,'the former initial window materialized 200 floor records from the same 400-floor save')
 const targetId=399,fullContext=collectMvuHelperContext(messages,targetId),shortContext=collectMvuHelperContext(actual.messages,targetId)
 assert.deepEqual(shortContext,fullContext)
 assert.deepEqual(collectMvuHelperContext(former.messages,targetId),fullContext)
 const request=input=>projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({operationId:'op',chatId:'c',branchId:'main',basedOnRevision:1,
  messageId:targetId,swipeId:0,storyText:input.messages[targetId].text,currentVariables:input.messages[targetId].variables[0],
  variableSchema:input.messages[targetId].variables[0].schema,helperContext:collectMvuHelperContext(input.messages,targetId),
  updateRules:['rule'],backgroundTasks:{variables:true}}))
 assert.deepEqual(request(actual),request({messages}), 'the model-facing prompt projection must match the former 200-floor window')
 assert.deepEqual(request(actual),request(former), 'the model-facing prompt projection must match the actual former 200-floor storage read')
})

test('background rotation remains readable before and after independent snapshot publication',async t=>{
 const root=await mkdtemp(join(tmpdir(),'mvu-maintenance-'));const errors=[]
 const store=createChatJournalStore({dataRoot:root,frameLimit:1,backgroundSnapshots:true,logger:{warn:(...args)=>errors.push(args)}})
 t.after(async()=>{await store.flushMaintenance();await rm(root,{recursive:true,force:true})})
 const db=createChatPersistence({store})
 await db.write({id:'c',messages:[{text:'initial'}]})
 for(let revision=1;revision<=3;revision++) {
  const before=await db.readSlice('c',[0])
  await db.patch('c',before.chat._storageRevision,[{op:'set',path:['messages',0,'text'],value:String(revision)}])
  assert.equal((await createChatJournalStore({dataRoot:root}).read('c')).messages[0].text,String(revision),'journal alone is authoritative before maintenance')
 }
 await store.flushMaintenance();assert.deepEqual(errors,[])
 const files=await readdir(join(root,'chats/c/snapshots'));assert.ok(files.length>=2)
 assert.equal((await store.readRevision('c',1)).messages[0].text,'initial')
 assert.equal((await store.read('c')).messages[0].text,'3')
})
