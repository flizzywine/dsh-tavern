import { templateStateFields } from '../tavern-plugin/lib/domain/template-window-reader.js'
import { createTemplateServices } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/services.js'
import * as templateHost from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/host.js'
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
  const adapter=createTavernScriptHostAdapter({presetRegexScripts:chat=>chat.runtimePresetSnapshot?.regexScripts || [],resolveChatMetadataSlice:()=>persistence.readSlice('chat',[],templateStateFields),resolveChatSlice:(_id,indices)=>persistence.readSlice('chat',indices),resolveChangedChatSlice:(_id,revision,fields)=>persistence.readChangedSlice('chat',revision,fields),patchChat:persistence.patch,resolveChat:()=>persistence.read('chat'),writeChat:persistence.write,
    updateChat:persistence.update,readChatRevision:persistence.readRevision,readCard:async()=>({name:'角色'}),
    worldBooks:{bound:async()=>null},scriptDispatch:{},isPlayChat:()=>true,
    globalVariables:createPromptTemplateGlobalVariables(createProfileDataStore({dataRoot:root})),
    fullExtensionSettings:createTavernExtensionSettings(createProfileDataStore({dataRoot:root}))})
  return {persistence,adapter,open}
}

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


// Same native save, with and without the bounded stale-reader merge.

test('template display keeps preset regex through full, unchanged and changed history reads', async t => {
  const {adapter,persistence}=await fixture(t)
  const rule = (findRegex, replaceString) => ({findRegex,replaceString,placement:[2],markdownOnly:true,promptOnly:true,enabled:true})
  await persistence.update('chat', chat => { chat.runtimePresetSnapshot={regexScripts:[rule('/<thinking>[\\s\\S]*?<\\/thinking>/g',''),rule('/GLOBAL/g','PRESET')]}; return chat })
  const connection=await createNativeTemplateConnection({sessionId:'session',rpc:(_method,args)=>adapter.readFullPromptTemplateState(args.sessionId,args.cursor)})
  t.after(()=>templateHost.disposeTemplateHost())
  templateHost.configureTemplateHost(connection.snapshot,{}, {yaml:{}})
  const previousWindow=globalThis.window
  globalThis.window={$:{fn:{html(){}}}}
  t.after(()=>{if(previousWindow === undefined) delete globalThis.window; else globalThis.window=previousWindow})
  const services=createTemplateServices(()=>connection.snapshot,()=>{})
  const check = () => {
    templateHost.refreshTemplateSnapshot({...connection.snapshot,extension_settings:{regex:[rule('/seed/g','GLOBAL'),rule('/!/g','!!')]}})
    connection.snapshot.dsh.regexScripts.push(rule('/PRESET/g','CARD'))
    assert.equal(services.getRegexedString('<thinking>secret</thinking>seed!',2,{isMarkdown:true}),'CARD!!')
  }
  check()
  await connection.refresh()
  check()
  await persistence.update('chat', chat => {chat.messages.push({role:'assistant',text:'next',turn:2});return chat})
  await connection.refresh()
  check()
})
