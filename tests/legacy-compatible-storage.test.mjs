import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createLegacyCompatibleStorage } from '../tavern-plugin/lib/domain/legacy-compatible-storage.js'
import { createNativeConversationStorage } from '../tavern-plugin/lib/domain/native-conversation-storage.js'

function sample(){return {id:'old',sessionId:'session',_storageRevision:1,
 messages:[{role:'user',text:'hello',turn:1},{role:'assistant',text:'reply',turn:1,swipeId:1,swipes:['a','reply'],
  variables:[{stat_data:{gold:5}},{stat_data:{gold:10},schema:{gold:'number'},display_data:{gold:'10'},delta_data:{gold:5}}],
  mvuBaseline:{variables:{stat_data:{gold:5}}},mvu:{pending:true,pendingSubmission:{operations:[{op:'delta',path:'/stat_data/gold',value:1}]},delivery:{prepared:true,effect:{gold:11}}},
  tavernPluginData:{template_rendered:{hash:'keep'}},custom:{empty:[],nullable:null}}],
 variables:{scope:'chat'},tavernHelperScriptVariables:{script:{count:3}},posture:{name:'standing'},settleStatus:'pending',
 timeline:{branchId:'branch',revision:1,checkpoints:[{beforeRevision:1}],operations:{job:{status:'running'}}},nativeCommits:{1:{requestId:'native'}},unknown:{preserve:true}}}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'compatible-chat-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(join(root,'chats'),{recursive:true})
 const source=sample()
 await writeFile(join(root,'chats','old.json'),JSON.stringify(source))
 return {root,source,store:createChatJournalStore({dataRoot:root,logger:{warn(){}}})}
}
async function compatibleFixture(root,store){
 const current=await store.read('old')
 return createLegacyCompatibleStorage({dataRoot:root}).migrate('old',current,'compatible-fixture',async()=>{})
}
async function capture(root){
 const result=new Map()
 async function visit(directory,prefix=''){for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=join(directory,entry.name),key=prefix+entry.name
  if(entry.isDirectory())await visit(file,key+'/');else result.set(key,await readFile(file))
 }}
 await visit(root);return result
}

test('compatible source keeps every revision and projection after one-way native cutover',async t=>{
 const {root,store,source}=await fixture(t)
 await store.update('old',chat=>{chat.variables.fromJournal=true;chat._storageRevision=2;return chat})
 const before=await store.read('old')
 await compatibleFixture(root,store)
 await store.patch('old',2,[{op:'set',path:['_storageRevision'],value:3},{op:'set',path:['variables','hp'],value:8}])
 const current=await store.read('old')
 const readers=[s=>s.readSessionState('old'),s=>s.readSceneImageState('old'),s=>s.readBackgroundConfig('old'),s=>s.readDisplayRuntimeState('old',1),s=>s.readSlice('old',[1]),s=>s.readSettlementCheckpoint('old',1,'job')]
 const projected=await Promise.all(readers.map(fn=>fn(store)))
 const originals=await capture(root)
 assert.equal((await store.upgradeStorage('old')).status,'native')
 const reopened=createChatJournalStore({dataRoot:root}),native=createNativeConversationStorage({dataRoot:root})
 assert.deepEqual(await Promise.all(readers.map(fn=>fn(reopened))),projected)
 assert.deepEqual(await reopened.read('old'),current)
 assert.deepEqual((await native.read('old',1)).chat,source)
 assert.deepEqual((await native.read('old',2)).chat,before)
 assert.deepEqual((await native.read('old',3)).chat,current)
 for(const [file,bytes] of originals)assert.deepEqual(await readFile(join(root,file)),bytes,file)
 const persistence=createChatPersistence({store:reopened})
 await persistence.update('old',chat=>{chat.messages[1].variables[1].stat_data.gold=11;chat.messages[1].mvu.pending=false;return chat})
 assert.equal((await native.read('old',4)).chat.messages[1].variables[1].stat_data.gold,11)
})

test('active compatible corruption is never hidden by a stale legacy backup',async t=>{
 const {root,store}=await fixture(t)
 await compatibleFixture(root,store)
 const marker=JSON.parse(await readFile(join(root,'chats','old','storage-format.json'),'utf8'))
 await rm(join(root,'compatible-conversations','old',marker.target,'head.json'))
 await assert.rejects(store.read('old'),/missing|corrupt/)
 await assert.rejects(store.upgradeStorage('old'),/missing|corrupt/)
})

test('migration CLI executes one-way native conversion with machine-readable outcomes',async t=>{
 const {root,source}=await fixture(t)
 async function run(extra=[]){
  const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/migrate-conversation-storage.mjs',import.meta.url)),'--data',root,'--chat','old',...extra],{stdio:['ignore','pipe','pipe']})
  let output='',errors='';child.stdout.on('data',v=>{output+=v});child.stderr.on('data',v=>{errors+=v})
  const [code]=await once(child,'close');assert.equal(code,0,errors)
  return JSON.parse(output)
 }
 assert.equal((await run()).status,'native')
 assert.equal((await run(['--native'])).alreadyActive,true)
 assert.deepEqual(await createChatJournalStore({dataRoot:root}).read('old'),source)
})
