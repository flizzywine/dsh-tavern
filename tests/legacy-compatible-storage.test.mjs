import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises'

import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {migrateConversationStorage} from '../bin/migrate-conversation-storage.mjs'

function sample(){return {id:'old',sessionId:'session',_storageRevision:1,
 messages:[{role:'user',text:'hello',turn:1},{role:'assistant',text:'reply',turn:1,swipeId:1,swipes:['a','reply'],
  variables:[{stat_data:{gold:5}},{stat_data:{gold:10},schema:{gold:'number'},display_data:{gold:'10'},delta_data:{gold:5}}],
  mvuBaseline:{variables:{stat_data:{gold:5}}},mvu:{pending:true,pendingSubmission:{operations:[{op:'delta',path:'/stat_data/gold',value:1}]},delivery:{prepared:true,effect:{gold:11}}},
  tavernPluginData:{template_rendered:{hash:'keep'}},custom:{empty:[],nullable:null}}],
 variables:{scope:'chat'},tavernHelperScriptVariables:{script:{count:3}},posture:{name:'standing'},settleStatus:'pending',
 timeline:{branchId:'branch',revision:1,checkpoints:[{beforeRevision:1}],operations:{job:{status:'running'}}},nativeCommits:{1:{requestId:'native'}},unknown:{preserve:true}}}
async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'compatible-chat-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(join(root,'chats'),{recursive:true})
 const legacy=join(root,'chats','old.json'),source=sample(),bytes=JSON.stringify(source)
 await writeFile(legacy,bytes)
 return {root,legacy,source,bytes,store:createChatJournalStore({dataRoot:root,logger:{warn(){}},...options})}
}
async function marker(root){return JSON.parse(await readFile(join(root,'chats','old','storage-format.json'),'utf8'))}
async function bump(store,mutate){return store.update('old',chat=>{mutate(chat);chat._storageRevision++;return chat})}

test('existing persistence and projections survive journal migration, settlement patch, and rollback',async t=>{
 const {root,store}=await fixture(t)
 await bump(store,chat=>{chat.variables.fromJournal=true})
 const before=await store.read('old')
 const readers=[s=>s.readSessionState('old'),s=>s.readSceneImageState('old'),s=>s.readBackgroundConfig('old'),s=>s.readDisplayRuntimeState('old',1),s=>s.readSlice('old',[1]),s=>s.readSettlementCheckpoint('old',1,'job')]
 const projected=await Promise.all(readers.map(fn=>fn(store)))
 assert.equal((await store.migrateCompatibility('old')).status,'compatible')
 const restarted=createChatJournalStore({dataRoot:root})
 assert.deepEqual(await Promise.all(readers.map(fn=>fn(restarted))),projected)
 const persistence=createChatPersistence({store:restarted})
 await persistence.update('old',chat=>{chat.messages[1].variables[1].stat_data.gold=11;chat.messages[1].mvu.pending=false;return chat})
 const settled=await restarted.read('old')
 assert.equal(settled.messages[1].variables[1].stat_data.gold,11)
 assert.deepEqual(await restarted.readRevision('old',2),before)
 assert.equal((await restarted.readRevision('old',1)).variables.fromJournal,undefined)
 await restarted.patch('old',settled._storageRevision,[{op:'splice',path:['messages'],index:1,deleteCount:1,items:[]},{op:'set',path:['_storageRevision'],value:settled._storageRevision+1}])
 assert.equal((await createChatJournalStore({dataRoot:root}).read('old')).messages.length,1)
 assert.deepEqual((await restarted.readRevision('old',settled._storageRevision)).messages,settled.messages)
})

test('failed conversion falls back to the writable original without activating a partial target',async t=>{
 let fail=true
 const {root,legacy,bytes,store}=await fixture(t,{migrateLegacy:true,onCompatibilityIO:e=>{if(fail&&e.kind==='write'){fail=false;throw Error('disk failure')}}})
 assert.equal(JSON.stringify(await store.read('old')),bytes)
 await assert.rejects(access(join(root,'chats','old','storage-format.json')),{code:'ENOENT'})
 assert.equal(await readFile(legacy,'utf8'),bytes)
 await bump(store,chat=>{chat.unknown.progress='still playable'})
 const fresh=createChatJournalStore({dataRoot:root,migrateLegacy:true})
 assert.equal((await fresh.read('old')).unknown.progress,'still playable')
 assert.equal((await marker(root)).mode,'compatible')
})

test('active corruption is never disguised as a successful read of the stale migration backup',async t=>{
 const {root,store}=await fixture(t)
 await store.migrateCompatibility('old')
 await bump(store,chat=>{chat.unknown.progress='new progress'})
 const active=await marker(root)
 await rm(join(root,'compatible-conversations','old',active.target,'head.json'))
 await assert.rejects(createChatJournalStore({dataRoot:root}).read('old'),/missing|corrupt/)
 await assert.rejects(store.migrateCompatibility('old'),/missing|corrupt/)
})

test('restore includes post-migration progress and retains historical revisions across another migration',async t=>{
 const {root,store}=await fixture(t)
 await store.migrateCompatibility('old')
 const second=await bump(store,chat=>{chat.messages.push({role:'user',text:'new progress'})})
 const third=await bump(store,chat=>{chat.unknown.progress='third'})
 assert.equal((await migrateConversationStorage({dataRoot:root,chatId:'old',restoreLegacy:true})).revision,3)
 const oldReader=createChatJournalStore({dataRoot:root,compatibleStorage:false})
 assert.deepEqual(await oldReader.read('old'),third)
 assert.deepEqual(await oldReader.readRevision('old',2),second)
 const restored=createChatJournalStore({dataRoot:root,migrateLegacy:true})
 assert.deepEqual(await restored.read('old'),third)
 assert.equal((await marker(root)).mode,'legacy')
 assert.deepEqual(await restored.readRevision('old',2),second)
 await bump(restored,chat=>{chat.unknown.progress='fourth'})
 await restored.migrateCompatibility('old',{force:true})
 assert.equal((await marker(root)).mode,'compatible')
 assert.deepEqual(await restored.readRevision('old',2),second)
 assert.deepEqual(await restored.readRevision('old',3),third)
 assert.equal((await restored.read('old')).unknown.progress,'fourth')
})

test('process exit before cutover keeps old data and dead-lock recovery permits retry',async t=>{
 const {root,source}=await fixture(t)
 const moduleUrl=new URL('../tavern-plugin/lib/domain/chat-journal-store.js',import.meta.url).href
 const child=spawn(process.execPath,['--input-type=module','-e',`import {createChatJournalStore} from ${JSON.stringify(moduleUrl)};const store=createChatJournalStore({dataRoot:${JSON.stringify(root)},onCompatibilityIO:e=>{if(e.kind==='write'&&e.type==='head')process.exit(19)}});await store.migrateCompatibility('old');`],{stdio:'ignore'})
 const [code]=await once(child,'exit');assert.equal(code,19)
 const fresh=createChatJournalStore({dataRoot:root})
 assert.deepEqual(await fresh.read('old'),source)
 assert.equal((await fresh.migrateCompatibility('old')).status,'compatible')
 assert.deepEqual(await fresh.read('old'),source)
})

test('a late transaction guard failure and stale patches leave the committed revision intact',async t=>{
 const {root,store}=await fixture(t)
 await store.migrateCompatibility('old')
 const changes=[{op:'set',path:['unknown','value'],value:2},{op:'set',path:['_storageRevision'],value:2}]
 await assert.rejects(store.patch('old',1,changes,{assertCurrent(){throw Error('cancelled')}}),/cancelled/)
 assert.equal((await createChatJournalStore({dataRoot:root}).read('old'))._storageRevision,1)
 assert.equal(await store.patch('old',0,changes),undefined)
 await store.patch('old',1,changes)
 assert.equal((await store.read('old')).unknown.value,2)
})

test('auto migration does not reenter an updater lock and incompatible future markers fail closed',async t=>{
 const {root,source,store}=await fixture(t,{migrateLegacy:true})
 await store.update('old',async chat=>{assert.deepEqual(await store.read('old'),source);chat._storageRevision++;return chat})
 await store.read('old')
 await writeFile(join(root,'chats','old','storage-format.json'),JSON.stringify({version:999,mode:'future'}))
 await assert.rejects(createChatJournalStore({dataRoot:root}).read('old'),{code:'CHAT_STORAGE_FORMAT'})
})

test('interrupted reverse export resumes missing revisions before switching authority',async t=>{
 const {root,store}=await fixture(t)
 await store.migrateCompatibility('old')
 const second=await bump(store,chat=>{chat.unknown.progress=2})
 const third=await bump(store,chat=>{chat.unknown.progress=3})
 const moduleUrl=new URL('../tavern-plugin/lib/domain/chat-journal-store.js',import.meta.url).href
 const script=`import {createChatJournalStore} from ${JSON.stringify(moduleUrl)};
 import {readdirSync,readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';
 const root=${JSON.stringify(root)},journals=join(root,'chats','old','journals');
 const store=createChatJournalStore({dataRoot:root,onCompatibilityIO:e=>{
  if(e.kind==='read'&&e.type==='head'&&existsSync(journals)){
   for(const name of readdirSync(journals).filter(n=>n.endsWith('.jsonl'))){
    const rows=readFileSync(join(journals,name),'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
    if(rows.some(row=>row.revision===2))process.exit(23);
   }
  }
 }});await store.restoreLegacy('old');`
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:'ignore'})
 const [code]=await once(child,'exit');assert.equal(code,23)
 assert.equal((await marker(root)).mode,'compatible')
 const fresh=createChatJournalStore({dataRoot:root})
 assert.deepEqual(await fresh.read('old'),third)
 await fresh.restoreLegacy('old')
 const old=createChatJournalStore({dataRoot:root,compatibleStorage:false})
 assert.deepEqual(await old.read('old'),third)
 assert.deepEqual(await old.readRevision('old',2),second)
})

test('migration CLI executes conversion and restore with machine-readable outcomes',async t=>{
 const {root,source}=await fixture(t)
 async function run(extra=[]){
  const child=spawn(process.execPath,[new URL('../bin/migrate-conversation-storage.mjs',import.meta.url).pathname,'--data',root,'--chat','old',...extra],{stdio:['ignore','pipe','pipe']})
  let output='',errors='';child.stdout.on('data',v=>{output+=v});child.stderr.on('data',v=>{errors+=v})
  const [code]=await once(child,'close');assert.equal(code,0,errors)
  return JSON.parse(output)
 }
 assert.equal((await run()).status,'compatible')
 assert.equal((await run(['--restore-legacy'])).status,'legacy')
 assert.deepEqual(await createChatJournalStore({dataRoot:root,compatibleStorage:false}).read('old'),source)
})
