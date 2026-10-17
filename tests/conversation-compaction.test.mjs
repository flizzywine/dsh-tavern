import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {retainedRevisions,forkRevisionsByChat} from '../tavern-plugin/lib/domain/conversation-retention.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'compact-chat-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot:root,newConversations:true})
 // A new process sees only disk; in-memory block caches may outlive a sweep.
 const reopen=()=>createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 return {store,persistence:createChatPersistence({store}),reopen}
}
const big=n=>'x'.repeat(4096)+n

test('compaction drops unretained revisions and keeps current and retained ones readable',async t=>{
 const {store,persistence,reopen}=await fixture(t)
 await persistence.write({id:'a',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=12;i++)await persistence.patch('a',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 const current=await persistence.read('a')
 assert.equal(current._storageRevision,13)
 const keep=await persistence.readRevision('a',5)
 const dry=await store.compact('a',{retain:r=>r===5,keepRecent:2,graceMs:0,dryRun:true})
 assert.ok(dry.removed>0)
 const result=await store.compact('a',{retain:r=>r===5,keepRecent:2,graceMs:0})
 // Index keys of dropped revisions go too, so their pointer blocks are freed as well.
 assert.ok(result.indexKeysRemoved>0)
 assert.ok(result.removed>=dry.removed)
 assert.ok(result.bytes>0)
 const fresh=reopen()
 assert.deepEqual(await fresh.read('a'),current)
 assert.deepEqual(await fresh.readRevision('a',5),keep)
 assert.equal((await fresh.readRevision('a',12)).messages[0].text,big(11))
 await assert.rejects(fresh.readRevision('a',3),{code:'DSH_TAVERN_REVISION_NOT_FOUND'})
 // The compacted save keeps accepting writes, and a second pass finds nothing new.
 await persistence.patch('a',13,[{op:'set',path:['messages',0,'text'],value:big(13)}])
 assert.equal((await persistence.read('a')).messages[0].text,big(13))
 await store.compact('a',{retain:r=>r===5,keepRecent:20,graceMs:0})
 const again=reopen()
 assert.equal((await again.read('a')).messages[0].text,big(13))
 assert.deepEqual(await again.readRevision('a',5),keep)
})

test('the grace period keeps freshly written blocks',async t=>{
 const {store,persistence}=await fixture(t)
 await persistence.write({id:'a',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=4;i++)await persistence.patch('a',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 assert.equal((await store.compact('a',{keepRecent:1})).removed,0)
})

test('retention follows checkpoints, undo, regeneration recovery and forks transitively',async()=>{
 const states={
  9:{id:'a',_storageRevision:9,timeline:{checkpoints:[{beforeRevision:4}]}},
  4:{id:'a',_storageRevision:4,timeline:{checkpoints:[{beforeRevision:2}]}},
  2:{id:'a',_storageRevision:2},
  7:{id:'a',_storageRevision:7},
  6:{id:'a',_storageRevision:6},
  11:{id:'a',_storageRevision:11,timeline:{checkpoints:[{beforeRevision:10}]}},
 }
 const read=async(id,revision)=>{
  if(!states[revision])throw Object.assign(Error('gone'),{code:'DSH_TAVERN_REVISION_NOT_FOUND'})
  return states[revision]
 }
 const chat={id:'a',_storageRevision:20,timeline:{checkpoints:[{beforeRevision:9}]},rollbackUndo:{beforeRevision:7},regenRecovery:{beforeRevision:6}}
 const forks=forkRevisionsByChat([{forkedFrom:{chatId:'a',storageRevision:11,stateChatId:'a',stateRevision:11}},{forkedFrom:{chatId:'b',storageRevision:3}}])
 assert.deepEqual([...forks.get('b')],[3])
 const retained=await retainedRevisions(chat,read,forks.get('a'))
 assert.deepEqual([...retained].sort((x,y)=>x-y),[2,4,6,7,9,10,11])
})

test('compaction rewrites record packs that hold swept records, keeping every live record readable', async t => {
 const {store,persistence,reopen}=await fixture(t)
 const rows=n=>Array.from({length:40},(_,i)=>({role:'assistant',text:'行'+i+'-'+n,variables:[{stat_data:{gold:n,note:'x'.repeat(200)+i}}]}))
 await persistence.write({id:'a',messages:rows(0)})
 for(let i=1;i<=6;i++)await persistence.patch('a',i,rows(i).map((row,index)=>({op:'set',path:['messages',index],value:row})))
 const current=await persistence.read('a')
 const result=await store.compact('a',{keepRecent:1,graceMs:0})
 assert.ok(result.repackedPacks>0)
 const fresh=reopen()
 assert.deepEqual(await fresh.read('a'),current)
})
