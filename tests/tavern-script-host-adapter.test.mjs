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
  assert.equal(result.mutations, 1)
  assert.equal(writes.length, 0)
  applyMvuSettlementEffect(value, result.effect)
  assert.equal(value.messages[0].text, '旧正文')
  assert.equal(value.messages[0].swipes[0], '旧正文')
  assert.doesNotMatch(JSON.stringify(value.messages[0]), /UpdateVariable/)
  assert.equal(value.messages[0].variables[0].stat_data.hp, 7)
})

test('MVU Runtime 只返回确定性 effect；重复应用不会重复 delta', async function () {
  const value = chat()
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

test('MVU 执行回执超时释放事务，不写入草稿并明确提示重试', async () => {
  const gate = createTavernScriptDispatch({ timeoutMs: 100 })
  gate.touch('session-1', 'browser', true)
  const run = harness(chat(), { scriptDispatch: gate })
  const input = { operationId: 'timeout-settlement-1', sessionId: 'session-1', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2,
    storyText: '旧正文', command: '<UpdateVariable></UpdateVariable>' }
  const rejected = assert.rejects(run.adapter.settleMvuUpdate(input), /回执超时.*重试/)
  await new Promise(resolve => setImmediate(resolve))
  const offer = gate.claim('session-1', 'browser', true)
  gate.start('session-1', offer.event.id, offer.leaseToken, 'browser')
  await rejected
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
