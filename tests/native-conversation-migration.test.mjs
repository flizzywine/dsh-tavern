import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,readdir,writeFile,appendFile} from 'node:fs/promises'
import {writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createNativeConversationStorage} from '../tavern-plugin/lib/domain/native-conversation-storage.js'
import {createLegacyCompatibleStorage} from '../tavern-plugin/lib/domain/legacy-compatible-storage.js'
import {migrateConversationStorage} from '../bin/migrate-conversation-storage.mjs'

for(const source of ['journal','compatible','flat'])test(`${source}: verified native cutover preserves old revisions, opaque fields and later writes`,async t=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'native-migration-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot})
 const first={id:'old',sessionId:'session',_storageRevision:1,unknown:{extension:['keep',null]},tavernHelperScriptVariables:{script:{count:3}},timeline:{checkpoints:[{beforeRevision:1}]},messages:[{role:'assistant',turn:1,text:'old',swipeId:0,variables:[{stat_data:{gold:1}}],mvu:{receipt:{id:'receipt'},pendingSubmission:{operations:[{op:'delta',path:'/gold',value:1}]},delivery:{prepared:true}},mvuBaseline:{variables:{stat_data:{gold:0}}}}]}
 await store.update('old',()=>first)
 await store.patch('old',1,[{op:'set',path:['_storageRevision'],value:2},{op:'set',path:['messages',0,'variables',0,'stat_data','gold'],value:2}])
 if(source==='compatible'){
  const current=await store.read('old')
  await createLegacyCompatibleStorage({dataRoot}).migrate('old',current,'compatible-fixture',async()=>{})
  await store.patch('old',2,[{op:'set',path:['_storageRevision'],value:3},{op:'set',path:['unknown','new'],value:true}])
 }
 const before=await store.read('old'),revision=before._storageRevision
 if(source==='flat'){
  await rm(join(dataRoot,'chats','old'),{recursive:true,force:true})
  await writeFile(join(dataRoot,'chats','old.json'),JSON.stringify(before))
 }
 const preserved={}
 async function capture(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name),key=prefix+entry.name;if(entry.isDirectory())await capture(file,key+'/');else preserved[key]=await readFile(file)}}
 await capture(join(dataRoot,'chats'))
 const reopened=createChatJournalStore({dataRoot})
 const result=await migrateConversationStorage({dataRoot,chatId:'old',native:true})
 assert.equal(result.status,'native');assert.equal(result.sourceRevision,revision)
 for(const [file,bytes] of Object.entries(preserved))assert.deepEqual(await readFile(join(dataRoot,'chats',file)),bytes)
 assert.deepEqual(await reopened.read('old'),before)
 if(source!=='flat')assert.deepEqual(await reopened.readRevision('old',1),first)
 const native = createNativeConversationStorage({dataRoot})
 if(source!=='flat')assert.deepEqual((await native.read('old',1)).chat,first,'old revisions must be native, not legacy fallbacks')
 assert.equal((await native.readRetentionHeader('old')).legacyInitialRevision,undefined)
 assert.equal((await reopened.readWindow('old',{limit:1})).chat.messages.length,1)
 assert.equal((await reopened.readRecentSummaries('old',1,{revision})).revision,revision)
 await reopened.patch('old',revision,[{op:'set',path:['_storageRevision'],value:revision+1},{op:'set',path:['messages',0,'variables',0,'stat_data','gold'],value:9}])
 assert.equal((await createChatJournalStore({dataRoot}).read('old')).messages[0].variables[0].stat_data.gold,9)
 assert.equal((await reopened.readRecentSummaries('old',1,{revision})).revision,revision)
 assert.equal((await reopened.readRecentSummaries('old',1,{revision:revision+1})).revision,revision+1)
 assert.deepEqual(await reopened.readRevision('old',revision),before)
 if(source!=='flat')assert.deepEqual(await reopened.readRevision('old',1),first)
 assert.equal((await reopened.upgradeStorage('old')).alreadyActive,true)
 assert.ok((await readdir(join(dataRoot,'chats','old'))).includes('head.json'))
})

test('source mutation and disk failure during import leave the legacy authority writable',async t=>{
 for(const fault of ['source','disk']){
  const dataRoot=await mkdtemp(join(tmpdir(),'native-migration-race-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}))
  const old=createChatJournalStore({dataRoot}),chat={id:'old',_storageRevision:1,messages:[]}
  await old.update('old',()=>chat)
  const snapshot=join(dataRoot,'chats','old','snapshots','000000000001.json')
  let injected=false
  const store=createChatJournalStore({dataRoot,onNativeIO:event=>{
   if(injected||event.kind!=='write')return
   injected=true
   if(fault==='disk')throw Error('disk failure')
   writeFileSync(snapshot,JSON.stringify({...chat,external:'changed'}))
  }})
  await assert.rejects(store.upgradeStorage('old'),fault==='disk'?/disk failure/:/Source changed/)
  assert.equal(await createNativeConversationStorage({dataRoot}).version('old'),null)
  const current=await old.read('old')
  if(fault==='source')assert.equal(current.external,'changed')
  await old.update('old',value=>({...value,_storageRevision:2,afterFailure:true}))
  assert.equal((await old.upgradeStorage('old')).status,'native')
  assert.equal((await old.read('old')).afterFailure,true)
 }
})

for(const separate of [false,true])test(`online migration rejects busy games and protects concurrent writers (separate store: ${separate})`,async t=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'native-migration-online-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot}),writer=separate?createChatJournalStore({dataRoot}):store
 const chat={id:'old',_storageRevision:1,messages:[],variables:{gold:1}}
 await store.update('old',()=>chat)
 await writer.read('old') // A second client has the old representation cached.
 await assert.rejects(store.upgradeStorage('old',{assertCanMigrate:()=>{throw Error('busy')}}),/busy/)
 assert.equal(await createNativeConversationStorage({dataRoot}).version('old'),null)
 let write
 await store.upgradeStorage('old',{onProgress:stage=>{
  if(stage==='converting')write=writer.patch('old',1,[{op:'set',path:['variables','gold'],value:2},{op:'set',path:['_storageRevision'],value:2}]).then(()=>null,error=>error)
 }})
 const conflict=await write
 if(separate){
  assert.equal(conflict.code,'DSH_TAVERN_WRITE_CONFLICT')
  await writer.patch('old',1,[{op:'set',path:['variables','gold'],value:2},{op:'set',path:['_storageRevision'],value:2}])
 }else assert.equal(conflict,null)
 const reopened=createChatJournalStore({dataRoot})
 assert.equal((await reopened.read('old')).variables.gold,2)
 assert.deepEqual(await reopened.readRevision('old',1),chat)
 assert.ok((await reopened.version('old')).startsWith('native:'))
})

test('partial native cutover resumes old revisions after newer native writes',async t=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'native-migration-resume-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}))
 const legacy=createChatJournalStore({dataRoot})
 const first={id:'old',sessionId:'session',_storageRevision:1,messages:[{role:'assistant',turn:9,text:'first',nativeAnchor:{formatVersion:4,turn:20,input:1,reply:2}}]}
 await legacy.update('old',()=>first)
 await legacy.patch('old',1,[{op:'set',path:['_storageRevision'],value:2},{op:'set',path:['messages',0,'text'],value:'second'}])
 const second=await legacy.read('old')
 // Reproduce the previous release: only the current Chat became native.
 await createNativeConversationStorage({dataRoot}).create('old',second,undefined,{migration:true})
 const store=createChatJournalStore({dataRoot})
 await store.patch('old',2,[{op:'set',path:['_storageRevision'],value:3},{op:'set',path:['messages',0,'text'],value:'new native progress'}])
 const current=await store.read('old')
 const result=await store.upgradeStorage('old')
 assert.equal(result.alreadyActive,true)
 assert.equal(result.historyImported,1)
 const native=createNativeConversationStorage({dataRoot})
 assert.deepEqual((await native.read('old',1)).chat,first)
 assert.deepEqual((await native.read('old',2)).chat,second)
 assert.deepEqual((await native.read('old',3)).chat,current)
 assert.deepEqual(current.messages[0].nativeAnchor,second.messages[0].nativeAnchor,'storage migration keeps story/host turn coordinates opaque')
 assert.equal((await native.readRetentionHeader('old')).legacyInitialRevision,undefined)
 assert.equal((await store.upgradeStorage('old')).historyImported,0)
})

test('legacy writes newer than a partial native cutover are reported as divergent',async t=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'native-migration-diverged-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}))
 const legacy=createChatJournalStore({dataRoot}),first={id:'old',_storageRevision:1,messages:[{role:'assistant',text:'first'}]}
 await legacy.update('old',()=>first)
 await legacy.patch('old',1,[{op:'set',path:['_storageRevision'],value:2},{op:'set',path:['messages',0,'text'],value:'second'}])
 const current=await legacy.read('old'),native=createNativeConversationStorage({dataRoot})
 await native.create('old',current,undefined,{migration:true})
 const frame={schemaVersion:1,chatId:'old',baseRevision:2,revision:3,timestamp:Date.now(),source:'older-release',changes:[{op:'set',path:['_storageRevision'],value:3},{op:'set',path:['messages',0,'text'],value:'old branch progress'}]}
 await appendFile(join(dataRoot,'chats','old','journals','000000000002-open.jsonl'),JSON.stringify(frame)+'\n')
 await assert.rejects(legacy.upgradeStorage('old'),{code:'DSH_TAVERN_LEGACY_DIVERGED'})
 assert.equal((await native.migrationStatus('old')).status,'legacy-history')
 assert.deepEqual((await native.read('old',2)).chat,current)
 assert.equal(await native.read('old',1),null,'failed resume does not publish a partial history index')
})
