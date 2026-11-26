import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { applyMvuSettlementEffect, createMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { createHelperChatDataHost } from './fixtures/helper-chat-data-host.mjs'
import { projectAgentContent } from '../tavern-plugin/lib/domain/runtime-content-projection.js'

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

test('message frames publish once and resume MVU on the existing floors after a failed send event', async () => {
  let saved = chat(), appends = 0, publishes = 0, fail = true
  saved.mvu.owner = 'official'
  const events = []
  const { adapter } = harness(saved, {
    resolveChat: async () => structuredClone(saved),
    writeChat: async value => { appends++; saved = value; return saved },
    publishCreatedMessages: async () => { publishes++ },
    scriptDispatch: { async dispatch(_sessionId, name, [id], context) {
      assert.equal(name, 'MESSAGE_SENT')
      assert.equal(context.messages[id].role, 'user')
      events.push(id)
      if (id === 3 && fail) return { handled: false, error: '试运行失败' }
      await adapter.updateVariables('session-1', { type: 'message', message_id: id }, { stat_data: { ready: true } }, 2)
      return { handled: true }
    } }
  })
  const messages = [{ role: 'user', message: 'first' }, { role: 'assistant', message: 'note' }, { role: 'user', message: 'second' }]
  const send = () => adapter.createMessages('session-1', messages, {}, 2, '', { operationId: 'create-id', dispatch: true })
  const failed = await send()
  assert.match(failed.completionError, /已保存.*试运行失败/)
  fail = false
  const receipts = await Promise.all([send(), send()])
  assert.deepEqual(events, [1, 3, 3])
  assert.equal(publishes, 1)
  assert.equal(saved.messages.length, 4)
  assert.equal(appends, 3, 'one message append and two MVU variable saves')
  for (const receipt of receipts) {
    assert.equal(receipt.completionError, undefined)
    assert.equal(receipt.context.messages[3].variables.stat_data.ready, true)
  }
})

for (const concurrent of ['plugin-data', 'new-opening']) {
  test(`helper append reads the current chat after a concurrent ${concurrent} write`, async t => {
    const host = await createHelperChatDataHost()
    t.after(host.cleanup)
    const initial = await host.persistence.read('audit')
    async function saveConcurrentChange() {
      await host.persistence.update('audit', chat => {
        if (concurrent === 'plugin-data') chat.messages[0].tavernPluginData = { wiki: 'keep' }
        else chat.tavernHelperLifecycleRevision += 1
        return chat
      })
    }
    const { adapter } = harness(initial, {
      resolveChat: () => host.persistence.read('audit'), hasScripts: async () => true,
      async updateChat(...args) { await saveConcurrentChange(); return host.persistence.update(...args) },
      async writeChat(...args) { await saveConcurrentChange(); return host.persistence.write(...args) }
    })
    const result = await adapter.createMessages('audit', [{ role: 'assistant', message: '脚本补充' }], {}, 2)
    const saved = await host.open().read('audit')
    if (concurrent === 'plugin-data') {
      assert.deepEqual(result.targets, [{ messageId: 1 }])
      assert.equal(saved.messages[1].text, '脚本补充')
      assert.deepEqual(saved.messages[0].tavernPluginData, { wiki: 'keep' })
    } else {
      assert.equal(result.stale, true)
      assert.equal(result.context.lifecycleRevision, 3)
      assert.equal(saved.messages.length, 1)
    }
  })
}

test('independent Helper appends get distinct floor IDs and publish each native message once', async t => {
  const host = await createHelperChatDataHost()
  t.after(host.cleanup)
  const initial = await host.persistence.read('audit')
  const published = []
  let reads = 0, releaseReads
  const bothRead = new Promise(resolve => { releaseReads = resolve })
  const { adapter } = harness(initial, {
    async resolveChat() {
      const current = await host.persistence.read('audit')
      if (++reads === 2) releaseReads()
      await bothRead
      return current
    },
    hasScripts: async () => true,
    writeChat: (...args) => host.persistence.write(...args),
    updateChat: (...args) => host.persistence.update(...args),
    async publishCreatedMessages(saved, [{ messageId }]) { published.push({ messageId, text: saved.messages[messageId].text }) }
  })
  const append = text => adapter.createMessages('audit', [{ role: 'user', message: text }], {}, 2, '', { operationId: text })
  const [a, b] = await Promise.all([append('第一条'), append('第二条')])
  const saved = await host.open().read('audit')
  assert.equal(saved.messages.length, 3)
  assert.equal(saved.messages[a.targets[0].messageId].text, '第一条')
  assert.equal(saved.messages[b.targets[0].messageId].text, '第二条')
  assert.deepEqual((await append('第一条')).targets, a.targets)
  assert.deepEqual(published, saved.messages.slice(1).map(({ text }, index) => ({ messageId: index + 1, text })))
  assert.equal((await host.open().read('audit')).messages.length, 3)
})

for (const concurrent of ['plugin-data', 'same-field', 'next-opening']) {
  test(`helper opening initialization reconciles concurrent ${concurrent}`, async t => {
    const host = await createHelperChatDataHost()
    t.after(host.cleanup)
    const mvu = gold => ({ stat_data: { gold }, schema: {} })
    const initial = await host.persistence.update('audit', chat => {
      chat.mvu = { enabled: true, owner: 'official', openingInitialization: { version: 2, status: 'pending' } }
      chat.messages[0].variables = [mvu(0)]
      return chat
    })
    const { adapter } = harness(initial, {
      resolveChat: () => host.persistence.read('audit'),
      writeChat: (...args) => host.persistence.write(...args),
      patchChat: (...args) => host.persistence.patch(...args),
      async replyRegexScripts() {
        await host.persistence.update('audit', latest => {
          if (concurrent === 'same-field') latest.messages[0].variables = [mvu(9)]
          else if (concurrent === 'next-opening') latest.tavernHelperLifecycleRevision += 1
          else {
            latest.messages[0].tavernPluginData = { wiki: { visited: true } }
            latest.messages[0].displayRuntime = { frames: [] }
            latest.tavernPluginMetadata = { wiki: { ready: true } }
          }
          return latest
        })
        return []
      }
    })
    const update = adapter.updateMessages('audit', [{ message_id: 0, swipes_data: [mvu(30)] }], 2, 'host-event-3')
    if (concurrent === 'same-field') {
      await assert.rejects(update, { code: 'DSH_TAVERN_CHAT_CONFLICT' })
    } else {
      const result = await update
      assert.equal(result.updated, concurrent !== 'next-opening')
      if (concurrent === 'next-opening') assert.equal(result.stale, true)
      else assert.equal(result.context.messages[0].variables.stat_data.gold, 30)
    }
    const saved = await host.open().read('audit')
    assert.deepEqual(saved.messages[0].variables, [mvu(concurrent === 'plugin-data' ? 30 : concurrent === 'same-field' ? 9 : 0)])
    if (concurrent === 'plugin-data') {
      assert.deepEqual(saved.messages[0].tavernPluginData, { wiki: { visited: true } })
      assert.deepEqual(saved.messages[0].displayRuntime, { frames: [] })
      assert.deepEqual(saved.tavernPluginMetadata, { wiki: { ready: true } })
      assert.equal(saved.mvu.openingInitialization.status, 'complete')
    }
  })
}

test('a helper message rewrite preserves plugin data and invalidates a late display capture', async t => {
  const host = await createHelperChatDataHost()
  t.after(host.cleanup)
  const initial = await host.persistence.update('audit', chat => {
    chat.mvu.enabled = true
    return chat
  })
  const { adapter } = harness(initial, {
    resolveChat: () => host.persistence.read('audit'),
    writeChat: (...args) => host.persistence.write(...args),
    patchChat: (...args) => host.persistence.patch(...args),
    async replyRegexScripts() {
      await host.persistence.update('audit', latest => {
        latest.messages[0].tavernPluginData = { wiki: 'keep' }
        latest.messages[0].displayRuntime = { frames: [] }
        return latest
      })
      return []
    }
  })
  await adapter.updateMessages('audit', [{ message_id: 0, message: '新的开场。' }], 2)
  const saved = await host.open().read('audit')
  assert.equal(saved.messages[0].text, '新的开场。')
  assert.deepEqual(saved.messages[0].tavernPluginData, { wiki: 'keep' })
  assert.equal(saved.messages[0].displayRuntime, undefined)
})

for (const sliced of [false, true]) test(`chat player identity is persisted atomically with variables: sliced=${sliced}`, async t => {
  const host = await createHelperChatDataHost()
  t.after(host.cleanup)
  await host.persistence.update('audit', chat => ({ ...chat, mvu: { enabled: true },
    macroState: { userName: '原名', local: { score: 2 }, global: { keep: true } } }))
  const before = await host.persistence.read('audit')
  const patches = []
  const adapter = createTavernScriptHostAdapter({
    resolveChat: id => { assert.equal(sliced, false, 'compact writes must not load the whole chat'); return host.persistence.read(id) },
    resolveChatSlice: sliced ? (id, indices, fields) => host.persistence.readSlice(id, indices, fields) : undefined,
    readChatRevision: (...args) => host.persistence.readRevision(...args),
    patchChat: (...args) => { patches.push(args[2]); return host.persistence.patch(...args) },
    writeChat() { assert.fail('identity and variables must use the same journal patch') },
    readCard: async () => ({}), worldBooks: {}, scriptDispatch: {},
  })
  const baseline = sliced ? { chatId: before.id, stateRevision: before._storageRevision, lifecycleRevision: 2 } : undefined
  const result = await adapter.updateVariables('audit', { type: 'chat' }, { playerName: '沈砚', welcomeShown: true }, 2, '', baseline)
  assert.equal(result.updated, true)
  assert.equal(Boolean(result.contextDelta), sliced)
  const saved = await host.open().read('audit')
  assert.equal(saved.variables.playerName, '沈砚')
  assert.deepEqual(saved.macroState, { userName: '沈砚', local: { score: 2 }, global: { keep: true } })
  assert.equal(projectAgentContent('{{user}} / <user>', { macroState: saved.macroState }).agentText, '沈砚 / 沈砚')
  assert.equal(patches.length, 1)
  assert.ok(patches[0].some(change => change.path[0] === 'variables'))
  assert.ok(patches[0].some(change => change.path[0] === 'macroState'))
  assert.equal(before.macroState.userName, '原名', 'a previous snapshot must retain its identity')
})

for (const variablesChanged of [false, true]) test(`pending input variable write survives preparation only with unchanged variables: changed=${variablesChanged}`, async t => {
  const host = await createHelperChatDataHost()
  t.after(host.cleanup)
  const before = await host.persistence.update('audit', chat => {
    chat.mvu.enabled = true
    chat.messages.push({ role: 'user', text: '推门 ZZ3', sourceText: '推门 ZZ3', placeholder: true,
      source: { kind: 'user', rpcId: 'input-3' } })
    return chat
  })
  let patches = 0
  const adapter = harness(before, {
    resolveChat: () => host.persistence.read('audit'),
    resolveChatSlice: (id, indices, fields) => host.persistence.readSlice(id, indices, fields),
    readChatRevision: (...args) => host.persistence.readRevision(...args),
    writeChat: (...args) => host.persistence.write(...args),
    async patchChat(id, revision, changes, metadata) {
      if (++patches === 1) await host.persistence.update(id, chat => {
        chat.messages[1].text = '推门 〔3〕'
        if (variablesChanged) chat.messages[1].variables = [{ hp: 8 }]
        chat.messages.push({ role: 'assistant', turn: 2, text: '', placeholder: true })
        return chat
      })
      return host.persistence.patch(id, revision, changes, metadata)
    }
  }).adapter
  const pending = adapter.updateVariables('audit', { type: 'message', message_id: 1 }, { hp: 10 }, 2, undefined,
    { chatId: 'audit', stateRevision: before._storageRevision, lifecycleRevision: 2 })
  if (variablesChanged) await assert.rejects(pending, { code: 'DSH_TAVERN_CHAT_CONFLICT' })
  else {
    const result = await pending
    assert.equal(result.updated, true)
    assert.equal(result.context.messages.length, 3)
  }
  const saved = await host.open().read('audit')
  assert.equal(saved.messages[1].text, '推门 〔3〕')
  assert.deepEqual(saved.messages[1].variables, [{ hp: variablesChanged ? 8 : 10 }])
  assert.equal(saved.messages[2].role, 'assistant')
})

for (const hasIdentity of [false, true]) test(`MVU settlement commits the player identity with chat variables: existing=${hasIdentity}`, async () => {
  const value = chat()
  if (hasIdentity) value.macroState = { userName: '原名', local: { score: 2 }, global: { keep: true } }
  const before = structuredClone(value)
  let adapter
  adapter = harness(value, { scriptDispatch: { async dispatch(_session, _event, _args, _context, work) {
    await adapter.updateVariables('session-1', { type: 'chat' }, { playerName: '沈砚' }, 2, work.eventId)
    return { handled: true }
  } } }).adapter
  const result = await adapter.settleMvuUpdate({ operationId: 'identity', sessionId: 'session-1', messageId: 0,
    swipeId: 0, expectedLifecycleRevision: 2, command: '<UpdateVariable/>' })
  assert.deepEqual(value, before, 'the live identity must not change before the settlement commits')
  applyMvuSettlementEffect(value, result.effect)
  assert.equal(value.variables.playerName, '沈砚')
  assert.deepEqual(value.macroState, { userName: '沈砚', local: hasIdentity ? { score: 2 } : {}, global: hasIdentity ? { keep: true } : {} })
})

test('MVU identity effects retain macro counters and reject concurrent renames atomically', () => {
  const before = { ...chat(), macroState: { userName: '原名', local: { score: 2 }, global: { keep: true } } }
  const after = { ...before, variables: { playerName: '沈砚' }, macroState: { userName: '沈砚', local: { score: 999 }, global: {} } }
  const effect = createMvuSettlementEffect({ operationId: 'identity', chatId: before.id, sessionId: before.sessionId,
    messageId: 0, swipeId: 0, expectedLifecycleRevision: 2, before, after, guardChanges: true })
  const concurrent = structuredClone(before)
  concurrent.macroState.userName = '另一个玩家'
  assert.throws(() => applyMvuSettlementEffect(concurrent, effect), error => error.code === 'STALE_SETTLEMENT_EFFECT')
  assert.deepEqual(concurrent.variables, {}, 'a conflict must not partially commit the variable write')
  const target = structuredClone(before)
  applyMvuSettlementEffect(target, effect)
  assert.deepEqual(target.macroState, { userName: '沈砚', local: { score: 2 }, global: { keep: true } })
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
