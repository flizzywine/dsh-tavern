import {projectTavernHelperContext,hydrateTavernHelperMessages} from '../tavern-plugin/lib/domain/tavern-helper-context.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createStageReads} from '../tavern-plugin/lib/domain/stage-read-projection.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'
import {createConversationState} from '../tavern-plugin/lib/domain/conversation-state.js'
import { projectChatSessionState, projectChatBackgroundConfig } from '../tavern-plugin/lib/domain/chat-session-state.js'
import { mapRead } from '../tavern-plugin/lib/domain/native-conversation-storage.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'native-chat-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const io=[],store=createChatJournalStore({dataRoot:root,newConversations:true,onNativeIO:e=>io.push(e)})
 const persistence=createChatPersistence({store})
 const pages=createConversationPageStore({root:join(root,'chats')})
 return {root,store,persistence,pages,domain:createConversationState({store:pages}),io}
}
const row=gold=>({role:'assistant',text:'reward',variables:[{stat_data:{gold},schema:{}}]})

test('大量原生记录解码时主动让出事件循环并保持原索引顺序',async()=>{
 let ticked=false
 const tick=new Promise(resolve=>setImmediate(()=>{ticked=true;resolve()}))
 const values=Array.from({length:32},(_,index)=>index)
 const result=await mapRead(values,async value=>{
  const until=performance.now()+4
  while(performance.now()<until){}
  return value
 },true)
 const yieldedDuringRead=ticked
 await tick
 assert.equal(yieldedDuringRead,true)
 assert.deepEqual(result,values)
})

test('process death during a buffered flush cannot publish half a variable transaction',async t=>{
 const {root,persistence}=await fixture(t)
 const original=await persistence.write({id:'a',messages:[row(0)]})
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
  import {createChatJournalStore} from ${JSON.stringify(new URL('../tavern-plugin/lib/domain/chat-journal-store.js',import.meta.url).href)};
  import {createChatPersistence} from ${JSON.stringify(new URL('../tavern-plugin/lib/domain/chat-persistence.js',import.meta.url).href)};
  import {writeSync} from 'node:fs';
  let writes=0;
  const store=createChatJournalStore({dataRoot:${JSON.stringify(root)},onNativeIO:e=>{if(['write','link'].includes(e.kind)&&e.type==='record'&&++writes===2){writeSync(1,'fixture-kill');process.kill(process.pid,'SIGKILL')}}});
  await createChatPersistence({store}).patch('a',1,[{op:'set',path:['messages',0,'variables',0,'stat_data','gold'],value:10}]);
 `],{encoding:'utf8',timeout:15000})
 // Windows reports TerminateProcess as exit code 1, not a POSIX signal.
 assert.ifError(child.error)
 assert.equal(child.stdout,'fixture-kill','the child must reach the intended partial-flush crash point')
 if(process.platform==='win32')assert.equal(child.status,1,child.stderr)
 else assert.equal(child.signal,'SIGKILL',child.stderr)
 const restarted=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 assert.deepEqual(await restarted.read('a'),original)
 await restarted.patch('a',1,[{op:'set',path:['messages',0,'variables',0,'stat_data','gold'],value:10}])
 assert.equal((await restarted.read('a')).messages[0].variables[0].stat_data.gold,10)
})

test('cold stage projections use the native reader and preserve the requested floor',async t=>{
 const {root,persistence}=await fixture(t)
 const saved=await persistence.write({id:'stage',sessionId:'stage-session',messages:[{...row(1),turn:1,sourceText:'A quiet room.'}]})
 const cold=createChatJournalStore({dataRoot:root})
 // The stage reads a save on storage's pinned snapshots; storage itself knows no stage field.
 const stage=createStageReads({open:cold.openSnapshot,whole:cold.read})
 const view=await stage.readView('stage',{turn:1})
 assert.equal(view.id,'stage')
 assert.equal(view._storageRevision,saved._storageRevision)
 const floors=await stage.readFloors('stage',[0],{revision:saved._storageRevision,fields:['sourceText','turn']})
 assert.deepEqual(floors,[{sourceText:'A quiet room.',turn:1}])
})

test('cold selected reads skip historical variables and return the same session projection',async t=>{
 const {root,persistence}=await fixture(t)
 const historical=row(1)
 historical.variables[0].stat_data.archive='history-only'.repeat(15000)
 const chat=await persistence.write({id:'a',sessionId:'s',messages:[historical,...Array.from({length:128},()=>row(2)),{...row(3),mvu:{pending:true,pendingSubmission:{ops:[]}}}],
  timeline:{schemaVersion:1,operations:{},checkpoints:['large-checkpoint'.repeat(15000)],participants:{background:{status:'idle'}}},mode:'story'})
 let io=[]
 const fresh=createChatJournalStore({dataRoot:root,onNativeIO:e=>io.push(e)})
 const selected=await fresh.readSlice('a',[129],'settlement')
 assert.equal(selected.messageCount,130)
 assert.deepEqual(selected.chat.messages,[chat.messages[129]])
 assert.deepEqual(selected.chat.timeline.checkpoints,[])
 assert.ok(io.every(e=>e.bytes<65536),'selected reads must skip historical variables and checkpoints')
 assert.ok(io.filter(e=>e.type==='page').length<=3,'tail selection must not read every page')
 io=[]
 const tail=await fresh.readSlice('a',Array.from({length:100},(_,i)=>30+i),'settlement')
 assert.deepEqual(tail.chat.messages,chat.messages.slice(30))
 assert.ok(io.filter(e=>e.type==='page').length<=4,'adjacent row selections must share page reads')
 const duplicates=await fresh.readSlice('a',[129,30,129],['id','_storageRevision'])
 assert.deepEqual(duplicates.chat.messages,[chat.messages[129],chat.messages[30],chat.messages[129]])
 duplicates.chat.messages[0].text='changed'
 assert.notEqual(duplicates.chat.messages[2].text,'changed')
 io=[]
 assert.deepEqual(await fresh.readBackgroundConfig('a'),projectChatBackgroundConfig(chat))
 assert.ok(io.every(e=>e.bytes<65536))
 io=[]
 assert.deepEqual(await fresh.readSessionState('a'),projectChatSessionState(chat))
 // Session's public contract includes checkpoints, but never historical variables.
 const historyBytes=Buffer.byteLength(JSON.stringify({kind:'record',value:{type:'scalar',value:historical.variables[0].stat_data.archive}}))
 assert.ok(!io.some(e=>e.bytes===historyBytes),'session metadata must not hydrate history-only payload')
 const scoped=await fresh.readSessionState('a',{scoped:true})
 assert.deepEqual([...scoped.messages],projectChatSessionState(chat).messages)
 assert.deepEqual(scoped.pendingMvuSettlement,{hasSubmission:true,prepared:false})
 scoped.messages[0].role='changed'
 assert.equal((await fresh.readSessionState('a')).messages[0].role,'assistant')
 assert.deepEqual((await fresh.read('a')).messages,chat.messages,'full read still returns complete historical values')
})

test('旧前台正文的原生状态保留完整历史提示但不序列化内部标记',async t=>{
 const {persistence}=await fixture(t)
 await persistence.write({id:'a',sessionId:'s',mode:'story',messages:[row(0)],timeline:{schemaVersion:1,branchId:'b',revision:0,checkpoints:[],participants:{},operations:{old:{kind:'body',status:'foreground-completed'}}}})
 const state=await persistence.readSessionState('a')
 assert.equal(state._sessionStateHistoryComplete,true)
 assert.equal(state.messages[0].text,'reward')
 assert.equal(JSON.stringify(state).includes('_sessionStateHistoryComplete'),false)
})

test('内部共享解码不泄漏到完整读取、窗口、历史版本或放弃的回写',async t=>{
 const {persistence}=await fixture(t)
 await persistence.write({id:'a',sessionId:'s',mode:'story',messages:[row(0)]})
 const full=await persistence.read('a')
 full.messages[0].text='changed';full.messages[0].variables[0].stat_data.gold=99
 assert.equal((await persistence.read('a')).messages[0].text,'reward')
 assert.equal((await persistence.read('a')).messages[0].variables[0].stat_data.gold,0)
 const window=await persistence.readWindow('a',{limit:1})
 window.chat.messages[0].text='window changed'
 assert.equal((await persistence.readWindow('a',{limit:1})).chat.messages[0].text,'reward')
 const revision=await persistence.readRevision('a',1)
 revision.messages[0].text='revision changed'
 assert.equal((await persistence.read('a')).messages[0].text,'reward')
 await persistence.update('a',draft=>{draft.messages[0].text='aborted change';return undefined})
 assert.equal((await persistence.read('a')).messages[0].text,'reward')
})

test('fresh native gameplay writes pages, recovers variables and preserves historical revisions',async t=>{
 const {root,store,persistence,domain,pages}=await fixture(t)
 const chat=await persistence.write({id:'a',messages:[row(0)],posture:'standing'})
 const initial=structuredClone(chat)
 chat.messages.push({role:'user',text:'play'},row(10))
 const saved=await persistence.write(chat)
 const head=await domain.open('a')
 assert.equal(head.metadata.format,'conversation-state-v2')
 assert.equal(head.state.world.variables.stat_data.gold,10)
 assert.equal(head.state.worldMessage,2)
 assert.equal(head.state.worldMessageUid,saved.messages[2].messageUid)
 assert.equal(head.state.worldSwipe,0)
 assert.ok(saved.messages[2].messageUid)
 assert.equal((await store.readWindow('a',{limit:1})).worldMessageUid,saved.messages[2].messageUid)
 assert.equal(head.messageCount,3)
 assert.ok(head.messages.every(r=>r.message.runtimeRef&&!Object.hasOwn(r.message,'variables')))
 assert.deepEqual((await readdir(join(root,'chats/a'))).sort(),['blocks','head.json'])
 assert.deepEqual(await store.readRevision('a',initial._storageRevision),initial)
 const fresh=createChatJournalStore({dataRoot:root})
 assert.deepEqual(await fresh.read('a'),saved)
 const read=await fresh.read('a');read.messages[0].variables[0].stat_data.gold=999
 assert.equal((await fresh.read('a')).messages[0].variables[0].stat_data.gold,0)
 await persistence.patch('a',saved._storageRevision,[{op:'set',path:['messages',2,'variables',0,'stat_data','gold'],value:23}])
 assert.equal((await domain.readWorld('a')).variables.stat_data.gold,23)
 assert.equal((await fresh.read('a')).messages[2].variables[0].stat_data.gold,23)
 const before=await pages.openConversation('a')
 let checks=0
 await assert.rejects(persistence.patch('a',saved._storageRevision+1,[{op:'set',path:['posture'],value:'lost'}],{assertCurrent(){if(++checks===2)throw Error('cancelled')}}),/cancelled/)
 assert.equal(checks,2,'guard must be checked again immediately before head publication')
 assert.equal((await pages.openConversation('a')).revision,before.revision)
})

test('world source keeps its permanent message uid across swipe and body writes',async t=>{
 const {persistence,domain}=await fixture(t)
 const chat=await persistence.write({id:'source',messages:[{...row(1),messageUid:'message-A',swipes:['a','b'],swipeId:0,variables:[{gold:1},{gold:2}]}]})
 await persistence.patch(chat.id,chat._storageRevision,[{op:'set',path:['messages',0,'swipeId'],value:1}])
 let head=await domain.open(chat.id)
 assert.equal(head.state.worldMessageUid,'message-A')
 assert.equal(head.state.worldSwipe,1)
 assert.equal(head.state.world.variables.gold,2)
 await persistence.patch(chat.id,chat._storageRevision+1,[{op:'set',path:['messages',0,'text'],value:'edited'}])
 head=await domain.open(chat.id)
 assert.equal(head.state.worldMessageUid,'message-A')
 assert.equal(head.state.worldSwipe,1)
})

test('body-only writes keep the authoritative swipe when a legacy row disagrees with the head',async t=>{
 const {persistence,domain}=await fixture(t)
 const chat=await persistence.write({id:'swipe-head',messages:[{...row(0),messageUid:'message-A',swipeId:1,variables:[{gold:0},{gold:100}]}]})
 const divergent=await persistence.read(chat.id)
 divergent.messages[0].swipeId=0
 await persistence.write(divergent,{worldSelection:{preserveWorld:true,selected:{position:0,swipe:1,messageUid:'message-A',world:{variables:{gold:100}}}}})
 let head=await domain.open(chat.id)
 assert.equal(head.state.worldSwipe,1)
 assert.equal(head.state.world.variables.gold,100)
 await persistence.patch(chat.id,divergent._storageRevision,[{op:'set',path:['messages',0,'text'],value:'point-edited'}])
 head=await domain.open(chat.id)
 assert.equal(head.state.worldSwipe,1)
 assert.equal(head.state.world.variables.gold,100)
 const full=await persistence.read(chat.id)
 full.messages[0].text='full-edited'
 await persistence.write(full)
 head=await domain.open(chat.id)
 assert.equal(head.state.worldSwipe,1)
 assert.equal(head.state.world.variables.gold,100)
})

test('save import restores an authoritative detached world instead of reviving an older row',async t=>{
 const {persistence,domain}=await fixture(t)
 const selected={position:null,swipe:2,messageUid:'deleted-source',world:{variables:{stat_data:{gold:44}},posture:'kept'}}
 await persistence.write({id:'imported',sessionId:'s',mode:'story',_storageRevision:0,messages:[row(3)]},{worldSelection:{selected}})
 const head=await persistence.readWorldSnapshot('imported')
 assert.equal(head.position,null)
 assert.equal(head.swipe,2)
 assert.equal(head.messageUid,'deleted-source')
 assert.equal(head.world.variables.stat_data.gold,44)
 assert.equal(head.world.posture,'kept')
 assert.ok(head.chatRevision>0)
 assert.ok(Number.isSafeInteger(head.worldRevision))
 assert.equal((await domain.readWorld('imported')).variables.stat_data.gold,44)
})

test('legacy heads and restored rows heal the world source uid on their next story write',async t=>{
 const {root,persistence,pages,domain}=await fixture(t)
 const chat=await persistence.write({id:'legacy-source',messages:[{...row(7),messageUid:'legacy-stable-uid'}]})
 const view=await pages.openConversation(chat.id),legacyState={...view.state}
 delete legacyState.worldMessageUid
 await pages.commit(chat.id,{expectedRevision:view.revision,state:legacyState,edits:[],append:[],truncateTo:view.messageCount})
 const cold=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 await cold.patch(chat.id,chat._storageRevision,[{op:'set',path:['posture'],value:'after'}],{returnProjection:['id']})
 assert.equal((await domain.open(chat.id)).state.worldMessageUid,'legacy-stable-uid')
 const nullView=await pages.openConversation(chat.id)
 await pages.commit(chat.id,{expectedRevision:nullView.revision,state:{...nullView.state,worldMessageUid:null},edits:[],append:[],truncateTo:nullView.messageCount})
 const coldNull=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 await coldNull.patch(chat.id,chat._storageRevision+1,[{op:'set',path:['posture'],value:'null-healed'}])
 assert.equal((await domain.open(chat.id)).state.worldMessageUid,'legacy-stable-uid')
 const restored=await coldNull.read(chat.id)
 delete restored.messages[0].messageUid
 const healed=await coldNull.write(restored)
 assert.ok(healed.messages[0].messageUid)
 assert.equal(healed.messages[0].messageUid,'legacy-stable-uid','同一世界来源恢复缺 UID 行时沿用原身份')
 assert.equal((await domain.open(chat.id)).state.worldMessageUid,healed.messages[0].messageUid)
 assert.equal((await domain.readWorld(chat.id)).variables.stat_data.gold,7)
})

test('scalar variable writes do not read unrelated large values and corrupt heads never fall back',async t=>{
 const {root,persistence,io,domain}=await fixture(t)
 const message=row(0)
 message.variables[0].stat_data.archive='untouched'.repeat(20000)
 const chat=await persistence.write({id:'a',messages:[message]})
 io.length=0
 await persistence.patch('a',chat._storageRevision,[{op:'set',path:['messages',0,'variables',0,'stat_data','gold'],value:42}])
 assert.ok(io.every(event=>event.bytes<65536),'a scalar patch must not load or write the large sibling: '+JSON.stringify(io.filter(event=>event.bytes>=65536)))
 assert.equal((await domain.readWorld('a',{path:'/variables/stat_data/gold'})),42)
 const {writeFile}=await import('node:fs/promises')
 await writeFile(join(root,'chats/a/head.json'),'{broken')
 await assert.rejects(createChatJournalStore({dataRoot:root}).read('a'),SyntaxError)
})

test('rollback across page boundaries and undo keep old immutable snapshots readable',async t=>{
 const {persistence,store,pages,domain}=await fixture(t)
 const chat=await persistence.write({id:'a',messages:Array.from({length:140},(_,i)=>row(i))})
 const before=await pages.openConversation('a')
 const original=structuredClone(chat)
 chat.messages.splice(63)
 await persistence.write(chat)
 assert.equal((await domain.readWorld('a')).variables.stat_data.gold,62)
 chat.messages.push(row(900),row(901))
 await persistence.write(chat)
 assert.deepEqual((await store.read('a')).messages.slice(62).map(r=>r.variables[0].stat_data.gold),[62,900,901])
 assert.equal((await pages.readHistoryPage('a',{cursor:before.snapshotCursor,limit:1})).messageCount,140)
 chat.messages=original.messages
 await persistence.write(chat)
 assert.deepEqual((await store.read('a')).messages,original.messages)
 assert.equal((await domain.readWorld('a')).variables.stat_data.gold,139)
})

test('new-format option does not convert existing journals or card chats; stale merges remain isolated',async t=>{
 const {root,persistence,store}=await fixture(t)
 const legacy=createChatJournalStore({dataRoot:root})
 await legacy.update('old',()=>({id:'old',messages:[row(1)],_storageRevision:1}))
 await store.update('old',chat=>({...chat,_storageRevision:2,posture:'still legacy'}))
 assert.ok((await readdir(join(root,'chats/old'))).includes('snapshots'))
 await assert.rejects(readFile(join(root,'chats/old/head.json')),{code:'ENOENT'})
 await persistence.write({id:'card',mode:'card',messages:[]})
 await assert.rejects(readFile(join(root,'chats/card/head.json')),{code:'ENOENT'})
 await persistence.write({id:'a',messages:[row(1)],posture:'start'})
 const first=await persistence.read('a'),second=await persistence.read('a')
 first.posture='changed';await persistence.write(first)
 second.extra='independent';await persistence.write(second)
 assert.equal((await persistence.read('a')).posture,'changed')
 const third=await persistence.read('a'),fourth=await persistence.read('a')
 third.posture='third';await persistence.write(third)
 fourth.posture='fourth'
 await assert.rejects(persistence.write(fourth),{code:'DSH_TAVERN_CHAT_CONFLICT'})
})

test('legacy Helper reads keep the complete context and range fallback',async t=>{
 const {root}=await fixture(t)
 const p=createChatPersistence({store:createChatJournalStore({dataRoot:root,newConversations:false})})
 const chat=await p.write({id:'legacy-helper',messages:[row(1),row(2)],variables:{custom:true}})
 assert.deepEqual((await p.readHelperContext(chat.id)).context,projectTavernHelperContext(chat))
 const selected=await p.readHelperContext(chat.id,{from:1,to:1})
 assert.deepEqual({from:selected.from,to:selected.to,messages:selected.context.messages},hydrateTavernHelperMessages(chat,1,1))
})

test('a cold native point patch reads only its target and keeps current world and revisions atomic',async t=>{
 const {root,persistence,domain}=await fixture(t)
 const historical={...row(1),displayRuntime:{frames:['unrelated-history'.repeat(20000)]}}
 const chat=await persistence.write({id:'cold-patch',messages:[historical,row(2),{role:'user',text:'next'}],posture:'before'})
 const io=[]
 const cold=createChatPersistence({store:createChatJournalStore({dataRoot:root,cacheMaxBytes:1,onNativeIO:e=>io.push(e)})})
 assert.equal(await cold.patch(chat.id,0,[{op:'set',path:['posture'],value:'stale'}]),undefined)
 const saved=await cold.patch(chat.id,chat._storageRevision,[
  {op:'set',path:['messages',1,'variables',0,'stat_data','gold'],value:3},
  {op:'set',path:['posture'],value:'after'}])
 assert.equal(saved._storageRevision,2)
 assert.ok(io.every(e=>e.bytes<65536),'point patch must not read unrelated historical payloads')
 assert.deepEqual((await domain.readWorld(chat.id)),{variables:{stat_data:{gold:3},schema:{}},posture:'after'})
 const full=await cold.read(chat.id)
 assert.deepEqual(full.messages[0],historical)
 assert.deepEqual((await cold.readRevision(chat.id,1)).messages,chat.messages)
 await cold.patch(chat.id,2,[{op:'set',path:['messages',2,'variables'],value:[{stat_data:{gold:4}}]}])
 assert.equal((await domain.readWorld(chat.id)).variables.stat_data.gold,4)
 await cold.patch(chat.id,3,[{op:'delete',path:['messages',2,'variables']}])
 assert.equal((await domain.readWorld(chat.id)).variables.stat_data.gold,3,'removing current variables must reselect the earlier world')
})

test('cold native patches match warm JSON semantics and reject invalid or cancelled writes',async t=>{
 const {root,persistence}=await fixture(t)
 const initial={messages:[{...row(1),messageUid:'stable-world-source',swipes:['a','b'],swipeId:0,variables:[{gold:1},{gold:2}],tavernPluginData:{old:true}},{role:'user',text:'next',messageUid:'later-world-source'}],variables:{chat:true},tavernHelperScriptVariables:{a:{value:1}}}
 await persistence.write({id:'warm',...structuredClone(initial)})
 await persistence.write({id:'cold',...structuredClone(initial)})
 const cold=createChatPersistence({store:createChatJournalStore({dataRoot:root,cacheMaxBytes:1})})
 const frames=[
  [{op:'set',path:['messages',0,'swipeId'],value:1}],
  [{op:'set',path:['messages',0,'tavernPluginData','old'],value:undefined},{op:'set',path:['messages',0,'variables',0],value:undefined}],
  [{op:'splice',path:['messages',0,'swipes'],index:0,deleteCount:1,items:['c','d']}],
  [{op:'set',path:['messages',1,'variables'],value:[{gold:4}]}],
  [{op:'set',path:['messages',0,'variables',0],value:{gold:8}}],
  [{op:'set',path:['variables','chat'],value:false},{op:'set',path:['tavernHelperScriptVariables','a','value'],value:3}],
  [{op:'delete',path:['messages',1,'variables']}]
 ]
 for(let index=0;index<frames.length;index++){
  await persistence.patch('warm',index+1,frames[index],{touchUpdatedAt:false})
  await cold.patch('cold',index+1,frames[index],{touchUpdatedAt:false})
  const {id:a,updatedAt:b,...warm}=await persistence.read('warm')
  const {id:c,updatedAt:d,...actual}=await cold.read('cold')
  assert.deepEqual(actual,warm)
 }
 const before=await cold.read('cold'),revision=before._storageRevision
 await assert.rejects(cold.patch('cold',revision,[{op:'set',path:['messages',0,'text'],value:'late'}],{assertCurrent(){throw Error('cancelled')}}),/cancelled/)
 await assert.rejects(cold.patch('cold',revision,[{op:'set',path:['messages',0,'missing','child'],value:1}]),/Missing mutation parent/)
 assert.deepEqual(await cold.read('cold'),before)
 let guards=0
 await assert.rejects(cold.patch('cold',revision,[{op:'set',path:['messages',0,'text'],value:'prepared'}],{assertCurrent(){if(++guards===2)throw Error('cancelled before head')}}),/cancelled before head/)
 assert.equal(guards,2)
 assert.deepEqual(await cold.read('cold'),before)
})

test('Helper hydration is pinned to the view revision across concurrent edits and rollback',async t=>{
 const {root,persistence}=await fixture(t)
 const before=await persistence.write({id:'hydration',messages:[row(1),row(2)]})
 await persistence.patch(before.id,1,[{op:'set',path:['messages',0,'variables',0,'stat_data','gold'],value:99}])
 await persistence.patch(before.id,2,[{op:'splice',path:['messages'],index:1,deleteCount:1,items:[]}])
 const cold=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 const selected=await cold.readHelperContext(before.id,{from:0,to:1,revision:1})
 assert.equal(selected.chat._storageRevision,1)
 assert.deepEqual(selected.context.messages,projectTavernHelperContext(before).messages)
 assert.equal((await cold.readHelperContext(before.id)).context.messages.length,1)
 await assert.rejects(cold.readHelperContext(before.id,{revision:999}),{code:'DSH_TAVERN_REVISION_NOT_FOUND'})
})

test('scoped mailbox commit preserves story, world and historical revisions',async t=>{
 const {root,persistence,domain}=await fixture(t)
 const original=await persistence.write({id:'mailbox',cardSnapshot:{large:'card'.repeat(20000)},messages:[row(7)]})
 const cold=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 const saved=await cold.patch('mailbox',original._storageRevision,[{op:'set',path:['taskMailbox'],value:{version:1,tasks:{},latestByKind:{},optional:undefined}}],{returnProjection:['id','_storageRevision','taskMailbox']})
 assert.equal(saved.taskMailbox.version,1)
 assert.equal(saved.cardSnapshot,undefined)
 assert.deepEqual((await cold.read('mailbox')).messages,original.messages)
 assert.deepEqual((await cold.read('mailbox')).cardSnapshot,original.cardSnapshot)
 assert.deepEqual((await domain.readWorld('mailbox')).variables.stat_data,{gold:7})
 assert.deepEqual(await cold.readRevision('mailbox',original._storageRevision),original)
 assert.equal(await cold.patch('mailbox',original._storageRevision,[{op:'set',path:['taskMailbox'],value:{version:99}}],{returnProjection:['id']}),undefined)
})
