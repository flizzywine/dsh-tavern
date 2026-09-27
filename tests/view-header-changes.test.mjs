import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'

test('view delta retains exact header field names through compacted change history',async t=>{
 const root=await mkdtemp(join(tmpdir(),'view-headers-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot:root})
 let chat=await store.update('c',()=>({id:'c',_storageRevision:1,messages:[{role:'user',text:'old'}],runtimeInputs:{'2':{source:'old'}}}))
 const base=chat._storageRevision
 for(let i=0;i<40;i++){
  chat=await store.patch('c',chat._storageRevision,[{op:'set',path:i%2?['posture']:['runtimeInputs','2','source'],value:String(i)},{op:'set',path:['_storageRevision'],value:chat._storageRevision+1}])
 }
 const delta=await store.readViewDelta('c',base)
 assert.deepEqual(new Set(delta.changedHeaderFields),new Set(['posture','runtimeInputs','_storageRevision']))
 assert.deepEqual(delta.indices,[])
 assert.deepEqual(delta.runtimeInputChanges,[{key:'2',present:true,value:{source:'38'}}])
 delta.runtimeInputChanges[0].value.source='mutated'
 assert.equal((await store.read('c')).runtimeInputs['2'].source,'38')
 const before=chat._storageRevision
 chat=await store.patch('c',before,[{op:'set',path:['messages',0,'text'],value:'new'},{op:'set',path:['_storageRevision'],value:before+1}])
 const messageOnly=await store.readViewDelta('c',before)
 assert.deepEqual(messageOnly.changedHeaderFields,['_storageRevision']);assert.deepEqual(messageOnly.indices,[0])
 assert.equal((await store.readViewDelta('c',base)).chat.messages[0].text,'new')
 assert.equal(await createChatJournalStore({dataRoot:root}).readViewDelta('c',base),undefined,'missing trusted history falls back after restart')
 const prior=chat._storageRevision
 const complete=await store.read('c')
 await store.patch('c',prior,[{op:'set',path:[],value:{...complete,_storageRevision:prior+1,posture:'root replacement'}}])
 assert.equal((await store.readViewDelta('c',prior)).changedHeaderFields,null,'root replacement has no safe narrow header declaration')
 assert.equal((await store.readViewDelta('c',prior)).runtimeInputChanges,null)
})
