import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'
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

test('MVU Runtime 只返回确定性 effect；重复应用不会重复 delta', async function () {
  const value = chat()
  value._storageRevision = 4
  value.mvu.owner = 'official'
  let adapter
  let dispatches = 0
  const writes = []
  adapter = createTavernScriptHostAdapter({
    resolveChat: async function () { return value },
    writeChat: async function (draft, metadata) {
      writes.push({ draft: structuredClone(draft), metadata })
      Object.assign(value, structuredClone(draft))
    },
    readCard: async function () { return { name: '测试卡' } },
    worldBooks: { bound: async function () { return null } },
    scriptDispatch: {
      status: function () { return { present: true, ready: true, busy: false } },
      async dispatch(_sessionId, _name, _args, _context, work) {
        dispatches++
        const receipt = await adapter.updateVariables('session-1', { type: 'chat' }, { marker: true }, 2, work.eventId,
          { chatId: value.id, stateRevision: 4, lifecycleRevision: 2 })
        assert.equal(receipt.transactional, true)
        assert.ok(receipt.context)
        assert.equal(receipt.contextDelta, undefined)
        const current = value.messages[0].variables[0].stat_data?.hp ?? value.messages[0].variables[0].hp
        await adapter.updateMessages('session-1', [{
          message_id: 0,
          data: { hp: current - 1, schema: { type: 'object' }, stat_data: { hp: current - 1 } }
        }], 2, work.eventId)
        return { handled: true }
      },
      poll: function () {}, complete: function () {}, dispose: function () {}
    },
    isPlayChat: function (candidate) { return candidate.mode === 'story' }
  })

  const input = {
    operationId: 'settlement-operation-1',
    chatId: 'chat-1',
    sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2,
    storyText: '旧正文', command: '<UpdateVariable></UpdateVariable>'
  }
  const first = await adapter.settleMvuUpdate(input)

  assert.equal(first.updated, true)
  assert.equal(dispatches, 1)
  assert.equal(writes.length, 0)
  assert.deepEqual(value.messages[0].variables[0], { hp: 10 })
  applyMvuSettlementEffect(value, first.effect)
  applyMvuSettlementEffect(value, first.effect)
  assert.equal(value.messages[0].variables[0].stat_data.hp, 9)
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

test('浏览器执行器暂时缺席时立即挂起，不等待也不写入', async function () {
  const run = harness(chat(), {
    scriptDispatch: {
      status: function () { return { present: false, ready: false, busy: false } },
      dispatch: async function () { throw new Error('不应投递') },
      poll: function () {}, complete: function () {}, dispose: function () {}
    }
  })
  const startedAt = Date.now()
  const result = await run.adapter.settleMvuUpdate({
    operationId: 'deferred-settlement-1',
    sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2,
    storyText: '旧正文', command: '<UpdateVariable></UpdateVariable>'
  })
  assert.equal(result.deferred, true)
  assert.ok(Date.now() - startedAt < 100, '运行时缺席不能盲等 15 秒')
  assert.equal(run.writes.length, 0)
})

test('后台 MVU 脚本链失败时丢弃整份事务草稿', async function () {
  const value = chat()
  let adapter
  const writes = []
  adapter = createTavernScriptHostAdapter({
    resolveChat: async function () { return value },
    writeChat: async function (draft, metadata) { writes.push({ draft: structuredClone(draft), metadata }) },
    readCard: async function () { return { name: '测试卡' } },
    worldBooks: { bound: async function () { return null } },
    scriptDispatch: {
      async dispatch(_sessionId, _name, _args, _context, work) {
        await adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 1 } }], 2, work.eventId)
        return { handled: false, error: '人物卡脚本「变量守卫」处理事件超时' }
      },
      poll: function () {}, complete: function () {}, dispose: function () {}
    }
  })

  await assert.rejects(function () {
    return adapter.settleMvuUpdate({
      operationId: 'failed-settlement-1',
      sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2,
      storyText: '旧正文', command: '<UpdateVariable></UpdateVariable>'
    })
  }, /变量守卫.*超时/)
  assert.equal(writes.length, 0)
  assert.deepEqual(value.messages[0].variables[0], { hp: 10 })
})

test('MVU 事务只接受当前 Host event 的变量写入', async function () {
  const value = chat()
  value.mvu.owner = 'official'
  let adapter
  adapter = createTavernScriptHostAdapter({
    resolveChat: async () => value,
    writeChat: async () => { throw new Error('Runtime 不应提前写入') },
    readCard: async () => ({}), worldBooks: { bound: async () => null },
    scriptDispatch: { async dispatch(_sessionId, _name, _args, _context, work) {
      await assert.rejects(
        adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 1 } }], 2, 'another-event'),
        /不属于当前 MVU 结算事件/
      )
      await adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 9 } }], 2, work.eventId)
      return { handled: true }
    } }
  })

  const result = await adapter.settleMvuUpdate({
    operationId: 'scoped-settlement-1', diagnosticId: 'attempt-1',
    sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2,
    command: '<UpdateVariable/>'
  })
  assert.equal(result.updated, true)
})

test('明确脚本错误可修正重试，但已写世界书时不得自动重放', async () => {
  for (const external of [false, true]) {
    const value = chat()
    let adapter, writes = 0, worldbookWrites = 0
    adapter = createTavernScriptHostAdapter({
      resolveChat: async () => value, writeChat: async () => { writes++ }, readCard: async () => ({}),
      worldBooks: {
        bound: async () => ({ source: { kind: 'card', path: 'card' }, view: { displayName: 'book', entries: [{ ref: '1', sourceUid: 1, content: 'old', enabled: true }] } }),
        update: async (_source, _input) => { worldbookWrites++; return { view: { displayName: 'book', entries: [] } } }
      },
      scriptDispatch: { async dispatch(_sessionId, _name, _args, _context, work) {
        await adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 1 } }], 2, work.eventId)
        if (external) {
          const { worldbook } = await adapter.getWorldbook('session-1', 'book')
          worldbook.entries[0].content = 'new'
          await adapter.replaceWorldbook('session-1', 'book', worldbook.entries)
        }
        return { handled: false, error: 'hp: expected number', diagnostics: [{ level: 'error', message: 'schema rejected' }] }
      } }
    })
    const settlement = adapter.settleMvuUpdate({ operationId: 'external-settlement-' + String(external), sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2, command: '<UpdateVariable/>' })
    if (external) await assert.rejects(settlement, /结算事务不能修改.*世界书/)
    else {
      const result = await settlement
      assert.equal(result.rejected, true)
      assert.equal(result.retryable, true)
      assert.equal(result.retryAfterMs, 3100)
      assert.equal(result.validation.failures[0].message, 'hp: expected number')
    }
    assert.equal(writes, 0)
    assert.equal(worldbookWrites, 0)
    assert.deepEqual(value.messages[0].variables[0], { hp: 10 })
  }
})

test('脚本执行期间目标生命周期变化时，草稿不得覆盖新目标', async () => {
  const value = chat()
  let adapter, writes = 0
  adapter = createTavernScriptHostAdapter({
    resolveChat: async () => value, writeChat: async () => { writes++ }, readCard: async () => ({}), worldBooks: { bound: async () => null },
    scriptDispatch: { async dispatch(_sessionId, _name, _args, _context, work) {
      await adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 1 } }], 2, work.eventId)
      value.tavernHelperLifecycleRevision++
      return { handled: true }
    } }
  })
  const result = await adapter.settleMvuUpdate({ operationId: 'lifecycle-settlement-1', sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2, command: '<UpdateVariable/>' })
  assert.equal(result.stale, true)
  assert.equal(writes, 0)
  assert.deepEqual(value.messages[0].variables[0], { hp: 10 })
})

test('Host Adapter 把脚本变量和消息调用写回 dsh-tavern 权威 Chat', async function () {
  const run = harness()
  const variables = await run.adapter.updateVariables('session-1', { type: 'message', message_id: 0 }, { hp: 7 }, 2)
  assert.equal(variables.updated, true)
  assert.deepEqual(run.chat.messages[0].variables[0], { hp: 7 })

  const messages = await run.adapter.updateMessages('session-1', [{ message_id: 0, swipe_id: 1 }], 2)
  assert.equal(messages.updated, true)
  assert.equal(run.chat.messages[0].swipeId, 1)
  assert.equal(run.chat.messages[0].text, '新正文')
  assert.deepEqual(run.writes.map(function (item) { return item.metadata.source }), ['tavern-helper.variables', 'tavern-helper.messages'])
})

test('Host Adapter 追加 Helper 楼层并保留追加式剧情边界', async function () {
  const run = harness()
  const result = await run.adapter.createMessages('session-1', [{
    role: 'assistant', message: '<chat_history>手机回复</chat_history>', is_hidden: false
  }], {}, 2)

  assert.equal(result.updated, true)
  assert.deepEqual(result.targets, [{ messageId: 1 }])
  assert.equal(run.chat.messages[1].role, 'tavern-helper')
  assert.equal(run.chat.messages[1].tavernRole, 'assistant')
  assert.equal(run.chat.messages[1].turn, undefined)
  assert.equal(run.writes.at(-1).metadata.source, 'tavern-helper.messages.create')
})

test('Host Adapter 把全局变量保存到 Profile 作用域而不改写 Chat', async () => {
  const value = chat()
  const writes = []
  let globals = { extra_analysis: true }
  const adapter = createTavernScriptHostAdapter({
    resolveChat: async () => value,
    writeChat: async (...args) => { writes.push(args) },
    readCard: async () => ({}),
    worldBooks: { bound: async () => null },
    scriptDispatch: { dispatch: async () => ({ handled: true }) },
    globalVariables: {
      read: async () => structuredClone(globals),
      save: async variables => { globals = structuredClone(variables); return structuredClone(globals) }
    },
    isPlayChat: () => true
  })
  const result = await adapter.updateVariables('session-1', { type: 'global' }, {}, 2)
  assert.equal(result.updated, true)
  assert.deepEqual(result.target, { type: 'global' })
  assert.deepEqual(result.globalVariables, {})
  assert.deepEqual(globals, {})
  assert.equal(writes.length, 0)
})

test('Host Adapter 把人物卡变量保存到人物卡而不改写 Chat', async () => {
  const value = chat()
  const writes = []
  const saved = []
  const adapter = createTavernScriptHostAdapter({
    resolveChat: async () => value,
    writeChat: async (...args) => { writes.push(args) },
    readCard: async () => ({ name: '测试卡' }),
    worldBooks: { bound: async () => null },
    scriptDispatch: { dispatch: async () => ({ handled: true }) },
    characterVariables: {
      save: async (cardPath, variables) => {
        saved.push({ cardPath, variables: structuredClone(variables) })
        return structuredClone(variables)
      }
    },
    isPlayChat: () => true
  })
  const variables = { phone_data: { user: { name: '绘梨衣' } } }
  const result = await adapter.updateVariables('session-1', { type: 'character' }, variables, 2)
  assert.equal(result.updated, true)
  assert.deepEqual(result.target, { type: 'character' })
  assert.deepEqual(result.characterVariables, variables)
  assert.deepEqual(saved, [{ cardPath: 'cards/test.json', variables }])
  assert.equal(writes.length, 0)
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

test('官方 MVU 写回全部开场 Swipe 后由 Host 标记初始化完成', async function () {
  const value = chat()
  Object.assign(value.messages[0], {
    sourceText: '{{User}}靠在树边。', swipes: ['{{User}}靠在树边。', '另一个开场'],
    text: '你靠在树边。', projectionText: '你靠在树边。', displayText: '你靠在树边。'
  })
  value.mvu = { enabled: true, owner: 'official', openingInitialization: { version: 2, status: 'pending' } }
  const run = harness(value)
  const first = { stat_data: { hp: 10 }, schema: { type: 'object' } }
  const second = { stat_data: { hp: 8 }, schema: { type: 'object' } }
  await run.adapter.updateMessages('session-1', [{ message_id: 0, swipes_data: [first, second] }], 2)
  assert.equal(run.chat.mvu.openingInitialization.status, 'complete')
  assert.equal(run.chat.mvu.openingInitialization.version, 2)
  assert.equal(typeof run.chat.mvu.openingInitialization.completedAt, 'number')
  const saved = run.writes.at(-1).value.messages[0]
  assert.equal(saved.text, '你靠在树边。')
  assert.equal(saved.projectionText, '你靠在树边。')
  assert.equal(saved.displayText, '你靠在树边。')
  assert.equal(saved.swipes[0], '{{User}}靠在树边。')
  assert.deepEqual(saved.variables, [first, second])
})

test('Host Adapter 统一翻译世界书与生命周期事件', async function () {
  const run = harness()
  const projected = await run.adapter.getWorldbook('session-1', 'current')
  const entries = structuredClone(projected.worldbook.entries)
  entries[0].content = '新内容'
  const changed = await run.adapter.replaceWorldbook('session-1', '测试世界书', entries)
  assert.equal(changed.updated, true)
  assert.equal(run.worldbook.view.entries[0].content, '新内容')
})

test('服务重启后结算立即挂起，由上层在浏览器重新登记后接续', async function () {
  const value = chat()
  const gate = createTavernScriptDispatch({ timeoutMs: 500, readyTimeoutMs: 200 })
  const run = harness(value, { scriptDispatch: gate })
  const result = await run.adapter.settleMvuUpdate({
    operationId: 'restart-settlement-1',
    sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2,
    storyText: '旧正文', command: '<UpdateVariable></UpdateVariable>'
  })
  assert.equal(result.deferred, true)
  assert.equal(run.writes.length, 0)
})

test('MVU 执行失联释放事务，不写入草稿并保留待恢复状态', async () => {
  const gate = createTavernScriptDispatch({ timeoutMs: 100 })
  gate.touch('session-1', 'browser', true)
  const run = harness(chat(), { scriptDispatch: gate })
  const input = { operationId: 'timeout-settlement-1', sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2,
    storyText: '旧正文', command: '<UpdateVariable></UpdateVariable>' }
  const deferred = run.adapter.settleMvuUpdate(input)
  await new Promise(resolve => setImmediate(resolve))
  const offer = gate.claim('session-1', 'browser', true)
  gate.start('session-1', offer.event.id, offer.leaseToken, 'browser')
  assert.equal((await deferred).deferred, true)
  assert.equal(run.writes.length, 0)
  assert.equal(gate.status('session-1').busy, false)
  gate.dispose('session-1')
  const retried = await run.adapter.settleMvuUpdate(input)
  assert.equal(retried.deferred, true, '失败后释放事务锁，允许重试而不是已有结算正在执行')
})

test('Host Adapter 为脚本事件投影临时玩家输入但不改写 Chat', async function () {
  const run = harness()
  const result = await run.adapter.dispatchEvent({
    sessionId: 'session-1', chat: run.chat, transientUserText: '玩家行动', name: 'MESSAGE_SENT', args: [1]
  })
  assert.equal(result.handled, true)
  assert.equal(run.chat.messages.length, 1)
  assert.equal(run.events[0].context.messages.length, 2)
  assert.equal(run.events[0].context.messages[1].message, '玩家行动')
  assert.deepEqual(run.events[0].context.messages[1].variables, { hp: 10 })
})

test('非 MVU 普通脚本可使用变量和世界书，但不能执行官方 MVU 结算', async () => {
  const current = chat(); current.mvu = { enabled: false }
  let enabled = true, saves = 0
  const adapter = createTavernScriptHostAdapter({ resolveChat: async () => current, writeChat: async () => { saves++ },
    readCard: async () => ({}), hasScripts: async () => enabled, isPlayChat: value => value.mode === 'story',
    worldBooks: { bound: async () => ({ view: { displayName: 'book', entries: [] } }) }, scriptDispatch: {} })
  await adapter.updateVariables('session-1', { type: 'chat' }, { setting: 1 })
  assert.equal(saves, 1)
  assert.equal((await adapter.getWorldbook('session-1', 'book')).worldbook.name, 'book')
  await assert.rejects(adapter.settleMvuUpdate({ sessionId: 'session-1' }), /未启用 MVU/)
  enabled = false
  await assert.rejects(adapter.updateVariables('session-1', { type: 'chat' }, {}), /没有启用脚本/)
})

test('Helper creation waits for native session publication and propagates publication failure', async () => {
  let release
  let published
  const gate = new Promise(resolve => { release = resolve })
  const run = harness(chat(), { publishCreatedMessages: async (value, targets) => {
    assert.equal(run.writes.length, 1)
    published = { value: structuredClone(value), targets }
    await gate
  } })
  let done = false
  const task = run.adapter.createMessages('session-1', [{ role: 'user', message: '旅馆开局' }], {}, 2).then(value => { done = true; return value })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(done, false)
  assert.equal(published.value.messages[published.targets[0].messageId].text, '旅馆开局')
  release()
  assert.equal((await task).updated, true)
  const failed = harness(chat(), { publishCreatedMessages: async () => { throw new Error('native flush failed') } })
  await assert.rejects(failed.adapter.createMessages('session-1', [{ role: 'user', message: '开局' }], {}, 2), /native flush failed/)
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

test('结算事务打开期间，空 eventId 写入给出可操作的错配提示', async () => {
  let adapter
  let sawEmpty = false
  const run = harness(chat(), {
    scriptDispatch: {
      async dispatch(_session, _name, _args, _context, work) {
        try {
          await adapter.updateVariables('session-1', { type: 'message', message_id: 0 }, { hp: 1 }, 2, '')
        } catch (error) {
          sawEmpty = error.code === 'MVU_SETTLEMENT_EVENT_MISMATCH'
          assert.match(error.message, /未携带当前 MVU 结算事件身份/)
        }
        await adapter.updateVariables('session-1', { type: 'message', message_id: 0 }, { hp: 9 }, 2, work.eventId)
        return { handled: true }
      }
    }
  })
  adapter = run.adapter
  const result = await adapter.settleMvuUpdate({
    operationId: 'empty-id', sessionId: 'session-1', messageId: 0, swipeId: 0,
    expectedLifecycleRevision: 2, command: '<UpdateVariable/>'
  })
  assert.equal(sawEmpty, true)
  assert.equal(result.updated, true)
  assert.ok(result.mutations >= 1)
})



test('已有普通事件执行时，MVU 延后领取事务，不拒绝该事件的合法写入', async t => {
  const dispatch = createTavernScriptDispatch({ timeoutMs: 5000 })
  dispatch.touch('session-1', 'browser', true)
  t.after(() => dispatch.dispose('session-1'))
  const ordinary = dispatch.dispatch('session-1', 'MESSAGE_RECEIVED', [0], null, { eventId: 'ordinary-event' })
  const offer = dispatch.claim('session-1', 'browser', true)
  dispatch.start('session-1', offer.event.id, offer.leaseToken, 'browser')
  let releaseCard
  const card = new Promise(resolve => { releaseCard = resolve })
  const run = harness(chat(), { scriptDispatch: dispatch, readCard: () => card })
  const settlement = run.adapter.settleMvuUpdate({ operationId: 'overlapping', sessionId: 'session-1',
    messageId: 0, swipeId: 0, expectedLifecycleRevision: 2, command: '<UpdateVariable/>' })
  const outcome = settlement.then(value => value, error => error)
  await new Promise(resolve => setImmediate(resolve))
  let failure
  try {
    await run.adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 12 } }], 2, offer.event.id)
  } catch (error) { failure = error }
  releaseCard({})
  const result = await outcome
  dispatch.complete('session-1', offer.event.id, [0], 'browser', offer.leaseToken)
  await ordinary
  assert.equal(failure?.code, undefined, failure?.message)
  assert.equal(run.writes.length, 1)
  assert.equal(result.deferred, true)
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

test('MVU 已预约执行器但还在准备上下文时，新生命周期事件返回 busy', async t => {
  const dispatch = createTavernScriptDispatch({ timeoutMs: 5000 })
  dispatch.touch('session-1', 'browser', true)
  t.after(() => dispatch.dispose('session-1'))
  let releaseCard
  const card = new Promise(resolve => { releaseCard = resolve })
  const run = harness(chat(), { scriptDispatch: dispatch, readCard: () => card })
  const settlement = run.adapter.settleMvuUpdate({ operationId: 'preparing', sessionId: 'session-1',
    messageId: 0, swipeId: 0, expectedLifecycleRevision: 2, command: '<UpdateVariable/>' })
  const outcome = settlement.then(value => value, error => error)
  await new Promise(resolve => setImmediate(resolve))
  const ordinary = run.adapter.dispatchEvent({ sessionId: 'session-1', name: 'MESSAGE_RECEIVED', args: [0], context: {} })
  await new Promise(resolve => setImmediate(resolve))
  // Context preparation now happens while projecting an offer, under the same reservation.
  let offered=false
  const pendingOffer=dispatch.claimWithContext('session-1','browser',true).then(value=>{offered=true;return value})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(offered,false)
  const result = await ordinary
  releaseCard({})
  const work = await pendingOffer
  dispatch.start('session-1', work.event.id, work.leaseToken, 'browser')
  await run.adapter.updateMessages('session-1', [{ message_id: 0, data: { hp: 14 } }], 2, work.event.id)
  dispatch.complete('session-1', work.event.id, [0], 'browser', work.leaseToken)
  assert.equal((await outcome).updated, true)
  assert.equal(result.busy, true)
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
