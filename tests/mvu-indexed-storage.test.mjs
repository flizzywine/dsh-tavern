import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'

test('turn identity changes invalidate delta eligibility while variable edits preserve it',async t=>{
 const root=await mkdtemp(join(tmpdir(),'mvu-layout-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot:root,frameLimit:1e6,byteLimit:1e9})
 const db=createChatPersistence({store})
 await db.write({id:'c',messages:[{role:'assistant',turn:1,variables:[{stat_data:{hp:10},schema:{}}]}]})
 const revision=(await db.readSlice('c',[])).chat._storageRevision
 await db.patch('c',revision,[{op:'set',path:['messages',0,'variables',0,'stat_data','hp'],value:9}])
 assert.equal((await store.readChangedSlice('c',revision,'settlement')).layoutChanged,false)
 await db.patch('c',revision+1,[{op:'set',path:['messages',0,'turn'],value:2}])
 assert.equal((await store.readChangedSlice('c',revision,'settlement')).layoutChanged,true)
 assert.equal((await store.readChangedSlice('c',revision+1,'settlement')).layoutChanged,true)
})

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

test('snapshot maintenance failure does not revoke a durable variable patch',async t=>{
 const root=await mkdtemp(join(tmpdir(),'mvu-maintenance-fail-'));const errors=[]
 const store=createChatJournalStore({dataRoot:root,frameLimit:1,maxSnapshotBytes:512,backgroundSnapshots:true,logger:{warn:(...a)=>errors.push(a)}})
 t.after(async()=>{await store.flushMaintenance();await rm(root,{recursive:true,force:true})})
 const db=createChatPersistence({store});await db.write({id:'c',messages:[{text:'initial'}]})
 const before=await db.readSlice('c',[0])
 await db.patch('c',before.chat._storageRevision,[{op:'set',path:['messages',0,'text'],value:'x'.repeat(1000)}])
 await store.flushMaintenance();assert.equal(errors.length,1)
 assert.equal((await createChatJournalStore({dataRoot:root}).read('c')).messages[0].text.length,1000)
})
