
import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

import { applyMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'

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

test('后台 MVU 命令只在隔离草稿执行并原子提交，协议不进入正文历史', async function () {
  const value = chat()
  value.mvu.owner = 'official'
  let adapter
  const writes = []
  const adapterOptions = {
    globalVariables: { read: async () => ({ keep: 1 }), save: async () => { throw Error('transaction must not persist globals') } },
    resolveChat: async function () { return value },
    writeChat: async function (draft, metadata) {
      writes.push({ draft: structuredClone(draft), metadata })
      Object.assign(value, structuredClone(draft))
    },
    readCard: async function () { return { name: '测试卡' } },
    worldBooks: { bound: async function () { return null } },
    scriptDispatch: {
      async dispatch(_sessionId, _name, _args, context, work) {
        assert.match(context.messages[0].message, /<UpdateVariable>/)
        for (const extra_analysis of [false, true, false]) {
          const result = await adapter.updateVariables('session-1', { type: 'global' }, { keep: 1, extra_analysis }, 2, work.eventId)
          assert.equal(result.globalVariables.extra_analysis, extra_analysis)
        }
        await assert.rejects(adapter.updateVariables('session-1', { type: 'global' }, { keep: 2 }, 2, work.eventId), /跨对话的全局变量/)

        await adapter.updatePrompts('session-1', { kind: 'inject', prompts: [{ id: 'event', content: '当前事件', position: 'in_chat', depth: 0, role: 'system' }] }, 2, work.eventId)
        await adapter.updateMessages('session-1', [{
          message_id: 0,
          message: context.messages[0].message,
          data: { hp: 7, schema: { type: 'object' }, stat_data: { hp: 7 } }
        }], 2, work.eventId)
        return { handled: true }
      },
      poll: function () {}, complete: function () {}, dispose: function () {}
    }
  }
  adapter = createTavernScriptHostAdapter(adapterOptions)

  const result = await adapter.settleMvuUpdate({
    operationId: 'atomic-settlement-1',
    chatId: 'chat-1',
    sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2,
    storyText: '旧正文',
    command: '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":7}]</JSONPatch></UpdateVariable>'
  })

  assert.equal(result.updated, true)
  assert.equal(result.mutations, 2)
  assert.equal(writes.length, 0)
  assert.equal(value.tavernScriptPrompts, undefined)
  applyMvuSettlementEffect(value, result.effect)
  assert.equal(value.tavernScriptPrompts[0].content, '当前事件')
  assert.equal(value.messages[0].text, '旧正文')
  assert.equal(value.messages[0].swipes[0], '旧正文')
  assert.doesNotMatch(JSON.stringify(value.messages[0]), /UpdateVariable/)
  assert.equal(value.messages[0].variables[0].stat_data.hp, 7)
})

test('后台 MVU 结算遇到过期生命周期时不触发脚本和写入', async function () {
  const run = harness()
  const result = await run.adapter.settleMvuUpdate({
    operationId: 'stale-settlement-1',
    sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 1,
    storyText: '旧正文', command: '<UpdateVariable></UpdateVariable>'
  })
  assert.equal(result.stale, true)
  assert.equal(run.events.length, 0)
  assert.equal(run.writes.length, 0)
})

test('Host Adapter 保留脚本门控并拒绝过期 iframe 覆盖新状态', async function () {
  const disabled = harness(Object.assign(chat(), { mvu: { enabled: false } }))
  await assert.rejects(function () {
    return disabled.adapter.updateVariables('session-1', { type: 'chat' }, { value: 1 }, 2)
  }, /没有启用脚本运行时/)

  const stale = harness()
  const result = await stale.adapter.updateMessages('session-1', [{ message_id: 0, swipe_id: 1 }], 1)
  assert.equal(result.updated, false)
  assert.equal(result.stale, true)
  assert.equal(stale.writes.length, 0)
})

test('变量重算在隔离副本恢复基线，替换已结算结果而不重复扣减', async () => {
  const value = chat()
  value.messages.unshift({ role: 'user', text: '行动', variables: [{ stat_data: { hp: 4 }, schema: {} }] })
  const targetId = 1
  value.messages[targetId].displayText = '<div>已渲染正文</div>'
  value.messages[targetId].variables[0] = { stat_data: { hp: 7 }, schema: {} }
  let adapter
  adapter = harness(value, { scriptDispatch: {
    async dispatch(_session, _event, _args, context, work) {
      assert.equal(context.messages[targetId].variables.stat_data.hp, 10)
      assert.equal(context.messages[0].variables.stat_data.hp, 10)
      assert.equal(value.messages[0].variables[0].stat_data.hp, 4)
      assert.equal(value.messages[targetId].variables[0].stat_data.hp, 7)
      await adapter.updateMessages('session-1', [{ message_id: targetId,
        data: { stat_data: { hp: context.messages[targetId].variables.stat_data.hp - 1 }, schema: {} }
      }], 2, work.eventId)
      return { handled: true }
    }
  } }).adapter
  const result = await adapter.settleMvuUpdate({ operationId: 'retry', sessionId: 'session-1',
    messageId: targetId, swipeId: 0, expectedLifecycleRevision: 2, storyText: '旧正文',
    preserveForeground: true, baselineVariables: { stat_data: { hp: 10 }, schema: {} }, command: '<UpdateVariable/>',
    validate: ({ before, after }) => {
      assert.equal(before.stat_data.hp, 10)
      assert.equal(after.stat_data.hp, 9)
      return { changes: [], failures: [] }
    }
  })
  assert.equal(value.messages[targetId].variables[0].stat_data.hp, 7)
  applyMvuSettlementEffect(value, result.effect)
  assert.equal(value.messages[targetId].variables[0].stat_data.hp, 9)
  assert.equal(value.messages[0].variables[0].stat_data.hp, 4)
  assert.equal(value.messages[targetId].text, '旧正文')
  assert.equal(value.messages[targetId].displayText, '<div>已渲染正文</div>')
})

test('服务重启后迟到的 MVU 事件不能越过已消失的草稿直接写入聊天', async () => {
  const h = harness()
  await assert.rejects(h.adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 0 } }], 2, 'mvu-work:old-attempt'), /结算已结束/)
  assert.equal(h.writes.length, 0)
})

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

test('stale resource variable write returns a complete recovery context',async()=>{
 const full=chat(),header={...full,messages:[]};let reads=0
 const {adapter}=harness(full,{resolveChat:async()=>{reads++;return full},resolveChatSlice:async()=>({chat:header,denseMessages:true}),globalVariables:{save:async()=>{throw Error('stale write must not persist')}}})
 const result=await adapter.updateVariables('session-1',{type:'global'},{hp:99},1)
 assert.equal(result.stale,true)
 assert.equal(result.context.messages.length,1)
 assert.equal(reads,1)
})

test('template initialization opts into a bounded projection without reading complete Chat',async()=>{
 const source={...chat(),_storageRevision:8}
 let full=0
 const {adapter}=harness(source,{resolveChat:async()=>{full++;return source},
  worldBooks:{templateSnapshot:async()=>({worldName:'book',worldbooks:{book:{entries:{}}}})},
  resolveTemplateWindow:async()=>({chat:source,historyWindow:{from:9999,messageCount:10000,revision:8,token:'grant'}})})
 const projected=await adapter.readFullPromptTemplateState('session-1',undefined,true)
 assert.equal(full,0)
 assert.equal(projected.state.chat.length,1)
 assert.equal(projected.historyWindow.from,9999)
 assert.equal(projected.state.stateRevision,8)
 await adapter.readFullPromptTemplateState('session-1')
 assert.equal(full,1,'default API retains its complete-state contract')
})
