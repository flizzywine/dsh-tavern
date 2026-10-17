import { createPromptTemplateGlobalVariables } from '../tavern-plugin/lib/domain/prompt-template-global-variables.js'
import { createNativeTemplateConnection } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/native-connection.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createTavernExtensionSettings } from '../tavern-plugin/lib/domain/tavern-extension-settings.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'full-template-native-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const open=()=>createChatPersistence({store:createChatJournalStore({dataRoot:root})})
  const persistence=open()
  await persistence.write({id:'chat',sessionId:'session',cardPath:'cards/test.json',mode:'story',mvu:{enabled:true},
    tavernHelperLifecycleRevision:1,variables:{local:1},messages:[{role:'assistant',text:'正文',sourceText:'正文',turn:1,
      variables:[{hp:10}],tavernPluginData:{unrelated:{keep:true}}}],tavernPluginMetadata:{other:true}})
  const adapter=createTavernScriptHostAdapter({resolveChatSlice:(_id,indices)=>persistence.readSlice('chat',indices),resolveChangedChatSlice:(_id,revision)=>persistence.readChangedSlice('chat',revision),patchChat:persistence.patch,resolveChat:()=>persistence.read('chat'),writeChat:persistence.write,
    updateChat:persistence.update,readChatRevision:persistence.readRevision,readCard:async()=>({name:'角色'}),
    worldBooks:{bound:async()=>null},scriptDispatch:{},isPlayChat:()=>true,
    globalVariables:createPromptTemplateGlobalVariables(createProfileDataStore({dataRoot:root})),
    fullExtensionSettings:createTavernExtensionSettings(createProfileDataStore({dataRoot:root}))})
  return {persistence,adapter,open}
}

test('模板保存保留并发的其他变量；同一变量冲突时拒绝整次写入',async t=>{
  const {adapter,persistence}=await fixture(t)
  const {state}=await adapter.readFullPromptTemplateState('session')
  await persistence.update('chat',chat=>{chat.variables.other=7;chat.messages[0].variables[0].other=8;return chat})
  state.chat_metadata.variables.local=2;state.chat[0].variables[0].hp=11
  await adapter.saveFullPromptTemplateState('session',state)
  const saved=await persistence.read('chat')
  assert.deepEqual(saved.variables,{local:2,other:7})
  assert.deepEqual(saved.messages[0].variables[0],{hp:11,other:8})
  state.chat[0].variables[0].hp=12
  const before=await persistence.read('chat')
  await assert.rejects(adapter.saveFullPromptTemplateState('session',state),error=>error.code==='PROMPT_TEMPLATE_STATE_CONFLICT')
  assert.deepEqual(await persistence.read('chat'),before)
})

test('官方模板永久改写正文与变量原子保存',async t=>{
  const {adapter,persistence}=await fixture(t)
  const {state}=await adapter.readFullPromptTemplateState('session')
  state.chat[0].variables[0].hp=99;state.chat[0].mes='模板改写正文'
  const result=await adapter.saveFullPromptTemplateState('session',state)
  assert.equal(result.state.chat[0].mes,'模板改写正文')
  assert.equal(result.state.chat[0].variables[0].hp,99)
  const saved=await persistence.read('chat')
  assert.equal(saved.messages[0].sourceText,'模板改写正文')
})

test('生成中的玩家模板变量保存到待提交输入，不覆盖上一条回复或增加历史楼层',async t=>{
  const {adapter,persistence}=await fixture(t)
  await persistence.update('chat', chat => {
    chat.promptTemplateInput={turn:2,source:'原始输入',message:{role:'user',text:'已渲染输入',variables:[{hp:7}],swipes:['已渲染输入'],swipeId:0}}
    return chat
  })
  const {state}=await adapter.readFullPromptTemplateState('session')
  assert.equal(state.chat.length,2)
  state.chat[1].variables[0].hp=8
  await adapter.saveFullPromptTemplateState('session',state)
  const chat=await persistence.read('chat')
  assert.equal(chat.messages.length,1)
  assert.equal(chat.promptTemplateInput.message.variables[0].hp,8)
  assert.notEqual(chat.messages[0].variables[0].hp,8)
})

test('增量同步经过原生 journal：追加、变量写入、回退、全局配置及过期游标恢复',async t=>{
  const {adapter,persistence}=await fixture(t)
  const responses=[]
  const connection=await createNativeTemplateConnection({sessionId:'session',rpc:async(method,args)=>{
    if(method==='getFullPromptTemplateState') {const result=await adapter.readFullPromptTemplateState(args.sessionId,args.cursor);responses.push(structuredClone(result));return result}
    if(method==='saveFullPromptTemplateGlobals') return adapter.saveFullPromptTemplateGlobals(args.sessionId,args.variables,args.expectedVariables)
    if(method==='saveFullPromptTemplateState') return adapter.saveFullPromptTemplateState(args.sessionId,args.state)
    throw new Error(method)
  }})
  const first=structuredClone(connection.snapshot.chat[0])
  await connection.refresh()
  assert.deepEqual(responses.at(-1).delta.chat.set,[])
  await persistence.update('chat',chat=>{chat.messages.push({role:'user',text:'新动作',variables:[{hp:10}]});return chat})
  await connection.refresh()
  assert.deepEqual(responses.at(-1).delta.chat.set.map(([i])=>i),[1])
  assert.deepEqual(connection.snapshot.chat[0],first)
  connection.snapshot.chat[1].variables[0].hp=13
  await connection.callbacks.saveChatConditional(connection.snapshot)
  await connection.refresh()
  assert.equal(connection.snapshot.chat[1].variables[0].hp,13)
  const before=await adapter.readFullPromptTemplateState('session')
  await adapter.saveFullPromptTemplateGlobals('session',{live:9},before.environment.extension_settings.variables.global)
  await connection.refresh()
  assert.equal(connection.snapshot.extension_settings.variables.global.live,9)
  assert.deepEqual(responses.at(-1).delta.chat.set,[])
  await persistence.update('chat',chat=>{chat.messages.length=1;chat.tavernHelperLifecycleRevision++;return chat})
  await connection.refresh()
  assert.equal(connection.snapshot.chat.length,1)
  assert.deepEqual(connection.snapshot.chat[0],first)
  // Other readers can evict our fingerprint; recovery must still be exact.
  for(let i=0;i<33;i++)await adapter.readFullPromptTemplateState('session')
  await connection.refresh()
  assert.ok(responses.at(-1).state)
  assert.deepEqual(connection.snapshot.chat[0],first)
})

test('修改单个变量仅传局部写入与回执，并保留并发的无关变量',async t=>{
  const {adapter,persistence}=await fixture(t)
  await persistence.update('chat',chat=>{chat.messages[0].text='长正文'.repeat(10000);return chat})
  let request,receipt
  const connection=await createNativeTemplateConnection({sessionId:'session',rpc:async(method,args)=>{
    if(method==='getFullPromptTemplateState')return adapter.readFullPromptTemplateState(args.sessionId,args.cursor)
    if(method==='saveFullPromptTemplateState'){
      request=structuredClone(args.state)
      await persistence.update('chat',chat=>{chat.variables.unrelated=9;return chat})
      receipt=await adapter.saveFullPromptTemplateState(args.sessionId,args.state);return receipt
    }
    throw new Error(method)
  }})
  connection.snapshot.chat[0].variables[0].hp=11
  await connection.callbacks.saveChatConditional(connection.snapshot)
  assert.ok(Array.isArray(request.changes))
  assert.equal(request.chat,undefined)
  assert.ok(JSON.stringify(request).length<1000)
  assert.ok(JSON.stringify(receipt).length<1000)
  assert.equal(connection.snapshot.chat_metadata.variables.unrelated,9)
  assert.equal((await persistence.read('chat')).messages[0].variables[0].hp,11)
})

test('局部模板写入不能绕过身份、楼层与回退校验',async t=>{
  const {adapter,persistence}=await fixture(t)
  const {state}=await adapter.readFullPromptTemplateState('session')
  const {chat,chat_metadata,...header}=state
  for(const changes of [
    [{op:'set',path:['sessionId'],value:'other'}],
    [{op:'set',path:['chat',0,'is_user'],value:true}],
    [{op:'splice',path:['chat'],index:1,deleteCount:0,items:[chat[0]]}],
    [{op:'set',path:['chat_metadata','__proto__'],value:{bad:true}}]
  ]) await assert.rejects(adapter.saveFullPromptTemplateState('session',{...header,changes}))
  assert.equal((await persistence.read('chat'))._storageRevision,state.stateRevision)
  await persistence.update('chat',c=>{c.tavernHelperLifecycleRevision++;return c})
  await assert.rejects(adapter.saveFullPromptTemplateState('session',{...header,changes:[{op:'set',path:['chat',0,'variables',0,'hp'],value:99}]}),/过期|切换/)
  assert.equal((await persistence.read('chat')).messages[0].variables[0].hp,10)
})

test('局部保存回执不覆盖等待期间的后续编辑，下一次保存仍能提交',async t=>{
  const {adapter,persistence}=await fixture(t)
  let started,release
  const entered=new Promise(r=>{started=r}),gate=new Promise(r=>{release=r})
  let writes=0
  const connection=await createNativeTemplateConnection({sessionId:'session',rpc:async(method,args)=>{
    if(method==='getFullPromptTemplateState')return adapter.readFullPromptTemplateState(args.sessionId,args.cursor)
    if(method==='saveFullPromptTemplateState'){if(++writes===1){started();await gate}return adapter.saveFullPromptTemplateState(args.sessionId,args.state)}
    throw Error(method)
  }})
  connection.snapshot.chat[0].variables[0].hp=11
  const saving=connection.callbacks.saveChatConditional(connection.snapshot)
  await entered
  connection.snapshot.chat[0].variables[0].hp=12
  release();await saving
  assert.equal(connection.snapshot.chat[0].variables[0].hp,12)
  await connection.callbacks.saveChatConditional(connection.snapshot)
  assert.equal((await persistence.read('chat')).messages[0].variables[0].hp,12)
})

test('concurrent unchanged readers recover when the same cursor is consumed',async t=>{
 const {persistence}=await fixture(t)
 let blocked=false,waiting=[]
 const adapter=createTavernScriptHostAdapter({
  resolveChat:()=>persistence.read('chat'),resolveChatSlice:(_id,indices)=>persistence.readSlice('chat',indices),
  writeChat:persistence.write,readCard:async()=>{
   if(blocked)await new Promise(resolve=>{waiting.push(resolve);if(waiting.length===2){blocked=false;waiting.forEach(r=>r())}})
   return {name:'角色'}
  },worldBooks:{bound:async()=>null},scriptDispatch:{}
 })
 const first=await adapter.readFullPromptTemplateState('session')
 blocked=true
 const results=await Promise.all([adapter.readFullPromptTemplateState('session',first.cursor),adapter.readFullPromptTemplateState('session',first.cursor)])
 assert.equal(results.filter(r=>r.delta).length,1)
 assert.equal(results.filter(r=>Array.isArray(r.state?.chat)).length,1)
})

test('changed-floor synchronization equals full projection through append, variables, pending input and rollback',async t=>{
 const {adapter,persistence,open}=await fixture(t)
 const {applyTemplateSync}=await import('../tavern-plugin/lib/vendor/st-prompt-template/host-build/native-connection.js')
 let received=await adapter.readFullPromptTemplateState('session')
 for(const mutate of [
  c=>{c.messages.push({role:'assistant',text:'新增',variables:[{hp:9}]})},
  c=>{c.messages[0].variables[0].hp=3;c.variables.local=4},
  c=>{c.promptTemplateInput={message:{role:'user',text:'尚未提交',variables:[{input:1}]}}},
  c=>{c.messages.push({role:'user',text:'已提交'});delete c.promptTemplateInput},
  c=>{c.messages.splice(0,1);c.messages[0].text='回退后改写'},
  c=>{c.messages.length=0},
  c=>{c.messages.push({role:'assistant',text:'重新开始'})}
 ]) {
  await persistence.update('chat',c=>{mutate(c);return c})
  const delta=await adapter.readFullPromptTemplateState('session',received.cursor)
  received=applyTemplateSync(received,delta)
  const full=await adapter.readFullPromptTemplateState('session')
  assert.deepEqual(received.state,full.state)
 }
 await open().update('chat',c=>{c.messages[0].text='外部修改';return c})
 received=applyTemplateSync(received,await adapter.readFullPromptTemplateState('session',received.cursor))
 assert.deepEqual(received.state,(await adapter.readFullPromptTemplateState('session')).state)
})

import { readRowsAt } from '../tavern-plugin/lib/domain/bounded-history.js'
import { applyTemplateStateChanges } from '../tavern-plugin/lib/domain/template-state-patch.js'

// Same native save, with and without the bounded stale-reader merge.
async function nativeFixture(t, bounded) {
  const root=await mkdtemp(join(tmpdir(),'template-stale-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const persistence=createChatPersistence({store:createChatJournalStore({dataRoot:root,newConversations:true})})
  const messages=Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',text:'楼层'+i,sourceText:'楼层'+i,turn:Math.floor(i/2)+1,
    variables:[{hp:i,mp:i}],tavernPluginData:{keep:i}}))
  await persistence.write({id:'chat',sessionId:'session',cardPath:'cards/test.json',mode:'story',mvu:{enabled:true},backgroundConfigVersion:1,conversationFeaturesVersion:1,
    tavernHelperLifecycleRevision:1,variables:{local:1},messages,tavernPluginMetadata:{other:true}})
  const full=[]
  const adapter=createTavernScriptHostAdapter({resolveChatSlice:async(_id,indices)=>persistence.readSlice('chat',indices),patchChat:persistence.patch,
    resolveChat:async()=>{full.push('read');return persistence.read('chat')},writeChat:persistence.write,
    updateChat:async(...args)=>{full.push('update');return persistence.update(...args)},readChatRevision:async(...args)=>{full.push('revision');return persistence.readRevision(...args)},
    ...(bounded?{resolveChatSliceAt:async(_id,revision,indices)=>readRowsAt(persistence.readWindow,'chat',revision,indices),
      resolveChangedIndices:async(_id,revision)=>persistence.readChangedIndices('chat',revision)}:{}),
    readCard:async()=>({name:'角色'}),worldBooks:{bound:async()=>null},scriptDispatch:{},isPlayChat:()=>true,
    globalVariables:createPromptTemplateGlobalVariables(createProfileDataStore({dataRoot:root})),
    fullExtensionSettings:createTavernExtensionSettings(createProfileDataStore({dataRoot:root}))})
  return {persistence,adapter,full}
}

test('过期读者的局部模板保存：只合并相关楼层，回执与完整合并相同', async t => {
  const results=[]
  for(const bounded of [true,false]){
    const h=await nativeFixture(t,bounded)
    const {state}=await h.adapter.readFullPromptTemplateState('session')
    const {chat:_chat,chat_metadata:_metadata,...header}=state
    // Concurrent writes after the template read: another floor, another variable
    // on the edited floor, and a chat variable.
    await h.persistence.update('chat',chat=>{chat.messages[3].variables[0].hp=300;chat.messages[7].variables[0].mp=700;chat.variables.other=2;chat.timeline={schemaVersion:1};return chat})
    const request={...header,changes:[{op:'set',path:['chat',7,'variables',0,'hp'],value:77},{op:'set',path:['chat',9,'template_rendered'],value:{hash:'x'}}]}
    const receipt=await h.adapter.saveFullPromptTemplateState('session',structuredClone(request))
    const stored=await h.persistence.read('chat')
    const worker=applyTemplateStateChanges(applyTemplateStateChanges(state,request.changes),receipt.statePatch)
    const {state:authoritative}=await h.adapter.readFullPromptTemplateState('session')
    assert.deepEqual(worker,authoritative)
    results.push({stored:{...stored,updatedAt:0},full:h.full})
  }
  // Template reads in this fixture have no cursor; only the save path is compared.
  assert.deepEqual(results[0].full.filter(call=>call!=='read'),[])
  assert.ok(results[1].full.includes('update'))
  assert.deepEqual(results[0].stored,results[1].stored)
  assert.equal(results[0].stored.messages[7].variables[0].hp,77)
  assert.equal(results[0].stored.messages[7].variables[0].mp,700)
  assert.equal(results[0].stored.messages[3].variables[0].hp,300)
})

test('过期读者与并发写入改了同一变量：局部与完整合并都拒绝', async t => {
  for(const bounded of [true,false]){
    const h=await nativeFixture(t,bounded)
    const {state}=await h.adapter.readFullPromptTemplateState('session')
    const {chat:_chat,chat_metadata:_metadata,...header}=state
    await h.persistence.update('chat',chat=>{chat.messages[7].variables[0].hp=700;return chat})
    await assert.rejects(h.adapter.saveFullPromptTemplateState('session',{...header,changes:[{op:'set',path:['chat',7,'variables',0,'hp'],value:77}]}),/已被其他操作修改/)
    assert.equal((await h.persistence.read('chat')).messages[7].variables[0].hp,700)
  }
})

test('过期读者遇到楼层数变化：局部与完整合并同样拒绝，局部路径不整读', async t => {
  for(const bounded of [true,false]){
    const h=await nativeFixture(t,bounded)
    const {state}=await h.adapter.readFullPromptTemplateState('session')
    const {chat:_chat,chat_metadata:_metadata,...header}=state
    await h.persistence.update('chat',chat=>{chat.messages.splice(-2,2);return chat})
    h.full.length=0
    await assert.rejects(h.adapter.saveFullPromptTemplateState('session',{...header,changes:[{op:'set',path:['chat',7,'variables',0,'hp'],value:77}]}),/楼层已变化/)
    if(bounded)assert.deepEqual(h.full,[])
  }
})
