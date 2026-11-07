import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createNativeConversationStorage} from '../tavern-plugin/lib/domain/native-conversation-storage.js'

async function fixture(t){
 const dataRoot=await mkdtemp(join(tmpdir(),'native-history-import-'))
 t.after(()=>rm(dataRoot,{recursive:true,force:true}))
 return {dataRoot,native:createNativeConversationStorage({dataRoot})}
}

// A Chat as the runtime materializes it: header fields plus the story rows.
function chat(id,revision,{text='story',turn=1,world={place:'garden'}}={}){
 return {
  id,sessionId:'session',mode:'story',_storageRevision:revision,
  messages:[
   {role:'user',turn:0,text:'ask '+revision,swipeId:0},
   {role:'assistant',turn,text,swipeId:0,variables:[{stat_data:{...world},schema:{}}]},
   {role:'assistant',turn:0,text:'ending '+revision,swipeId:0},
  ],
  timeline:{schemaVersion:1,branchId:'branch-'+id,operations:{},checkpoints:[]},
 }
}
const headFile=(dataRoot,id)=>readFile(join(dataRoot,'chats',id,'head.json'))

test('a full history import publishes one native head per old revision',async t=>{
 const {dataRoot,native}=await fixture(t)
 const history=[chat('full',0,{text:'first'}),chat('full',1,{text:'second'})]
 const current=chat('full',2,{text:'third',world:{place:'river'}})
 const saved=await native.create('full',current,undefined,{migration:true,history})
 assert.equal(saved.revision,2)
 // Every old revision is native now: no legacy marker survives the import.
 assert.equal((await native.readRetentionHeader('full')).legacyInitialRevision,undefined)
 // A cold instance reads them from the native pages alone; no legacy storage exists.
 const cold=createNativeConversationStorage({dataRoot})
 for(const expected of [history[0],history[1],current]){
  const restored=await cold.read('full',expected._storageRevision)
  assert.ok(restored,'revision '+expected._storageRevision)
  assert.equal(restored.revision,expected._storageRevision)
  assert.deepEqual(restored.chat,expected)
 }
 assert.equal((await cold.readRecentSummaries('full',1,{revision:1})).revision,1)
 const window=await cold.readWindow('full',{limit:1,revision:0})
 assert.equal(window.revision,0)
 assert.equal(window.messageCount,3)
 assert.deepEqual(window.chat.messages,[history[0].messages[2]])
 assert.deepEqual((await cold.read('full')).chat,current)
})

test('importHistory adds partial native revisions without touching the current head',async t=>{
 const {dataRoot,native}=await fixture(t)
 const current=chat('partial',2,{text:'current',world:{place:'river'}})
 await native.create('partial',current,undefined,{migration:true})
 assert.equal((await native.readRetentionHeader('partial')).legacyInitialRevision,2)
 assert.equal(await native.read('partial',0),null)
 assert.equal(await native.read('partial',1),null)
 const before={chat:(await native.read('partial')).chat,world:await native.readWorldSnapshot('partial')}
 const history=[chat('partial',0,{text:'old'}),chat('partial',1,{text:'older'})]
 const verified=[]
 const imported=await native.importHistory('partial',history,{verifyBeforePublish:(restored,chats)=>verified.push({restored,chats})})
 assert.deepEqual(imported.revisions,[0,1])
 assert.equal(imported.staged,2)
 // The hook reads the snapshot that is about to become the current head.
 assert.deepEqual(verified.map(entry=>entry.restored),[before.chat])
 assert.deepEqual(verified[0].chats,history)
 assert.equal((await native.readRetentionHeader('partial')).legacyInitialRevision,undefined)
 const cold=createNativeConversationStorage({dataRoot})
 assert.deepEqual((await cold.read('partial',0)).chat,history[0])
 assert.deepEqual((await cold.read('partial',1)).chat,history[1])
 const after={chat:(await native.read('partial')).chat,world:await native.readWorldSnapshot('partial')}
 assert.deepEqual(after.chat,before.chat)
 assert.deepEqual(after.world,before.world)
 assert.equal(after.chat._storageRevision,2)
})

test('repeated importHistory reuses published heads and leaves head.json identical',async t=>{
 const {dataRoot,native}=await fixture(t)
 await native.create('repeat',chat('repeat',2),undefined,{migration:true})
 const history=[chat('repeat',0),chat('repeat',1)]
 await native.importHistory('repeat',history)
 const published=await headFile(dataRoot,'repeat')
 const again=await createNativeConversationStorage({dataRoot}).importHistory('repeat',history)
 assert.deepEqual(again.revisions,[0,1])
 assert.equal(again.staged,0)
 assert.equal(again.reused,2)
 assert.deepEqual(await headFile(dataRoot,'repeat'),published)
 assert.deepEqual((await native.read('repeat',0)).chat,history[0])
 assert.deepEqual((await native.read('repeat',1)).chat,history[1])
})

test('revision 0 migration heads stay readable and a missing revision normalizes to 0',async t=>{
 const {native}=await fixture(t)
 const zero=chat('zero',0,{text:'opening'})
 await native.create('zero',zero,undefined,{migration:true})
 const restored=await native.read('zero',0)
 assert.equal(restored.revision,0)
 assert.deepEqual(restored.chat,zero)
 const missing=chat('missing',0,{text:'opening'})
 delete missing._storageRevision
 await native.create('missing',missing,undefined,{migration:true})
 const restoredMissing=await native.read('missing',0)
 assert.equal(restoredMissing.revision,0)
 assert.deepEqual(restoredMissing.chat,missing)
 // Ordinary new archives keep the positive revision contract.
 await assert.rejects(native.create('fresh',chat('fresh',0),undefined,{}),{code:'CONVERSATION_INPUT'})
 assert.equal(await native.version('fresh'),null)
})

test('empty history still clears the legacy marker',async t=>{
 const {native}=await fixture(t)
 await native.create('empty',chat('empty',1),undefined,{migration:true})
 assert.equal((await native.readRetentionHeader('empty')).legacyInitialRevision,1)
 const result=await native.importHistory('empty',[])
 assert.deepEqual(result.revisions,[])
 assert.equal((await native.readRetentionHeader('empty')).legacyInitialRevision,undefined)
 assert.deepEqual((await native.read('empty')).chat,chat('empty',1))
 await assert.rejects(native.read('empty',0),{code:'DSH_TAVERN_REVISION_NOT_FOUND'})
})

// A header value that changes between serializations cannot round-trip, so the
// per-revision read-back check is the only thing that can reject it.
function unstable(id,revision){
 let calls=0
 const message={role:'assistant',turn:1,swipeId:0}
 Object.defineProperty(message,'text',{enumerable:true,get:()=>'text-'+(++calls)})
 return {id,_storageRevision:revision,messages:[message]}
}

test('rejected history validation or verification never rewrites head.json',async t=>{
 const {dataRoot,native}=await fixture(t)
 const current=chat('atomic',3,{text:'current'})
 // Duplicate revisions are rejected before the current head exists.
 await assert.rejects(native.create('atomic',current,undefined,{migration:true,history:[chat('atomic',1),chat('atomic',1)]}),{code:'DSH_TAVERN_HISTORY_INVALID'})
 await assert.rejects(headFile(dataRoot,'atomic'),{code:'ENOENT'})
 assert.equal(await native.version('atomic'),null)
 // A history revision must precede the current one.
 await assert.rejects(native.create('atomic',current,undefined,{migration:true,history:[chat('atomic',3)]}),{code:'DSH_TAVERN_HISTORY_INVALID'})
 assert.equal(await native.version('atomic'),null)
 // The caller's own pre-publish check aborts the publication too.
 await assert.rejects(native.create('atomic',current,undefined,{migration:true,history:[chat('atomic',1)],verifyBeforePublish:()=>{throw Error('caller verify failed')}}),/caller verify failed/)
 assert.equal(await native.version('atomic'),null)
 // A staged revision that does not restore byte-compatibly is rejected.
 await assert.rejects(native.create('atomic',current,undefined,{migration:true,history:[unstable('atomic',1)]}),{code:'DSH_TAVERN_HISTORY_INVALID'})
 assert.equal(await native.version('atomic'),null)
 await native.create('atomic',current,undefined,{migration:true})
 const published=await headFile(dataRoot,'atomic')
 // importHistory rejects an already-native revision and keeps the head.
 await assert.rejects(native.importHistory('atomic',[chat('atomic',3)]),{code:'DSH_TAVERN_HISTORY_INVALID'})
 assert.deepEqual(await headFile(dataRoot,'atomic'),published)
 await assert.rejects(native.importHistory('atomic',[unstable('atomic',1)]),{code:'DSH_TAVERN_HISTORY_INVALID'})
 assert.deepEqual(await headFile(dataRoot,'atomic'),published)
 await assert.rejects(native.importHistory('atomic',[chat('atomic',1)],{verifyBeforePublish:()=>{throw Error('caller verify failed')}}),/caller verify failed/)
 assert.deepEqual(await headFile(dataRoot,'atomic'),published)
 assert.equal(await native.read('atomic',1),null)
 assert.deepEqual((await native.read('atomic')).chat,current)
})
