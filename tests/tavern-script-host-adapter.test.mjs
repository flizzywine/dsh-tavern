import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

function chat() {
  return {
    id: 'chat-1',
    sessionId: 'session-1',
    cardPath: 'cards/test.json',
    mode: 'story',
    mvu: { enabled: true },
    tavernHelperLifecycleRevision: 2,
    variables: {},
    messages: [{
      role: 'assistant', turn: 1, text: '旧正文', sourceText: '旧正文',
      swipes: ['旧正文', '新正文'], swipeId: 0, variables: [{ hp: 10 }, { hp: 8 }]
    }]
  }
}

function harness(chatValue = chat(), overrides = {}) {
  const writes = []
  const events = []
  const worldbook = {
    source: { kind: 'card', path: chatValue.cardPath },
    view: {
      displayName: '测试世界书',
      entries: [{ ref: 'entry-1', sourceUid: 1, comment: '条目', content: '旧内容', enabled: true }]
    }
  }
  const adapter = createTavernScriptHostAdapter({
    resolveChat: async function () { return chatValue },
    writeChat: async function (value, metadata) { writes.push({ value: structuredClone(value), metadata }) },
    readCard: async function () { return { name: '测试卡' } },
    worldBooks: {
      bound: async function () { return worldbook },
      update: async function (_source, input) {
        for (const operation of input.operations) {
          if (operation.patch.content !== undefined) worldbook.view.entries[0].content = operation.patch.content
        }
        return worldbook
      }
    },
    scriptDispatch: {
      dispatch: async function (sessionId, name, args, context) { events.push({ sessionId, name, args, context }); return { handled: true, args } },
      poll: function () { return { active: true, event: null } },
      complete: function () { return true },
      dispose: function () { return true }
    },
    isPlayChat: function (value) { return value.mode === 'story' },
    ...overrides
  })
  return { adapter, chat: chatValue, writes, events, worldbook }
}

test('同时开始的 MVU 尝试不会在 await 之后互相覆盖事务所有权', async () => {
  let run
  run = harness(chat(), { scriptDispatch: { async dispatch(_session, _name, _args, _context, work) {
    await run.adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 13 } }], 2, work.eventId)
    return { handled: true }
  } } })
  const input = { sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2, command: '<UpdateVariable/>' }
  const results = await Promise.allSettled([
    run.adapter.settleMvuUpdate({ ...input, operationId: 'first' }),
    run.adapter.settleMvuUpdate({ ...input, operationId: 'second' })
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.updated).length, 1,
    results.map(result => result.reason?.message || result.status).join('; '))
  assert.match(results.find(result => result.status === 'rejected').reason.message, /已有.*结算/)
  assert.equal(run.writes.length, 0, '有效尝试仍只返回草稿 effect，不能提前持久化')
})

test('global template settings read and save without resolving any game', async () => {
  const current = { EjsTemplate: { enabled: false }, otherPlugin: { enabled: true } }
  let saved
  const { adapter } = harness(chat(), {
    resolveChat: async () => { throw new Error('must not read a game') },
    fullExtensionSettings: {
      read: async () => structuredClone(current),
      save: async (next, base) => { saved = { next, base }; return next }
    }
  })
  assert.deepEqual(await adapter.readGlobalPromptTemplateSettings(), { settings: { enabled: false } })
  assert.deepEqual(await adapter.saveGlobalPromptTemplateSettings({ enabled: true }, { enabled: false }), { updated: true, settings: { enabled: true } })
  assert.deepEqual(saved.base, current)
  assert.deepEqual(saved.next.otherPlugin, current.otherPlugin)
  await assert.rejects(adapter.saveGlobalPromptTemplateSettings([], {}), /模板设置/)
})

for (const concurrent of [false, true, 'conflict']) test(`prompt updates use exact-revision patch with safe merge fallback: concurrent=${concurrent}`, async t => {
  const {mkdtemp,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {createChatJournalStore}=await import('../tavern-plugin/lib/domain/chat-journal-store.js')
  const {createChatPersistence}=await import('../tavern-plugin/lib/domain/chat-persistence.js')
  const root=await mkdtemp(join(tmpdir(),'prompt-patch-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const persistence=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
  await persistence.write(chat())
  let patches=0,writes=0
  const run=harness(chat(),{
    resolveChat:()=>persistence.read('chat-1'),
    patchChat:async(id,revision,changes,metadata)=>{
      patches++
      assert.deepEqual(changes.map(c=>c.path),[['tavernScriptPrompts']])
      if(concurrent)await persistence.update(id,latest=>{latest.variables.concurrent=true;if(concurrent==='conflict')latest.tavernScriptPrompts=[{id:'other',content:'并发提示'}];return latest})
      return persistence.patch(id,revision,changes,metadata)
    },
    writeChat:async(value,metadata)=>{writes++;return persistence.write(value,metadata)}
  })
  const pending=run.adapter.updatePrompts('session-1',{kind:'inject',prompts:[{id:'test',content:'提示',position:'in_chat',depth:0,role:'system'}]},2)
  if(concurrent==='conflict') {
    await assert.rejects(pending,/tavernScriptPrompts/)
    assert.equal((await persistence.read('chat-1')).tavernScriptPrompts[0].content,'并发提示')
    return
  }
  const result=await pending
  const saved=await persistence.read('chat-1')
  assert.equal(patches,1)
  assert.equal(writes,concurrent?1:0)
  assert.equal(saved.tavernScriptPrompts[0].content,'提示')
  assert.deepEqual(saved.messages,chat().messages)
  assert.equal(saved.variables.concurrent,concurrent?true:undefined)
  assert.equal(result.context.stateRevision,saved._storageRevision)
  assert.equal(result.context.messages[0].message,'旧正文')
})

for(const type of ['global','character'])test(type+' variable writes validate Chat headers without reading message history',async()=>{
 const header=chat();delete header.messages
 let saved
 const {adapter}=harness(chat(),{resolveChat:async()=>{throw Error('full history read forbidden')},resolveChatSlice:async(_session,indices)=>{assert.deepEqual(indices,[]);return {chat:header,messageCount:20000,denseMessages:true}},
 globalVariables:{save:async value=>{saved=value;return value}},characterVariables:{save:async(_path,value)=>{saved=value;return value}}})
 const result=await adapter.updateVariables('session-1',{type},{hp:8},2)
 assert.equal(result.updated,true)
 assert.deepEqual(saved,{hp:8})
})
