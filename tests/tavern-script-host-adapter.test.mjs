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

function harness(chatValue = chat()) {
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
    eventGate: {
      dispatch: async function (sessionId, name, args, context) { events.push({ sessionId, name, args, context }); return { handled: true, args } },
      poll: function () { return { active: true, event: null } },
      complete: function () { return true },
      dispose: function () { return true }
    },
    isPlayChat: function (value) { return value.mode === 'story' }
  })
  return { adapter, chat: chatValue, writes, events, worldbook }
}

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

test('Host Adapter 保留 MVU 门控并拒绝过期 iframe 覆盖新状态', async function () {
  const disabled = harness(Object.assign(chat(), { mvu: { enabled: false } }))
  await assert.rejects(function () {
    return disabled.adapter.updateVariables('session-1', { type: 'chat' }, { value: 1 }, 2)
  }, /未启用 MVU/)

  const stale = harness()
  const result = await stale.adapter.updateMessages('session-1', [{ message_id: 0, swipe_id: 1 }], 1)
  assert.equal(result.updated, false)
  assert.equal(result.stale, true)
  assert.equal(stale.writes.length, 0)
})

test('官方 MVU 写回全部开场 Swipe 后由 Host 标记初始化完成', async function () {
  const value = chat()
  value.mvu = { enabled: true, owner: 'official', openingInitialization: { version: 2, status: 'pending' } }
  const run = harness(value)
  const first = { stat_data: { hp: 10 }, schema: { type: 'object' } }
  const second = { stat_data: { hp: 8 }, schema: { type: 'object' } }
  await run.adapter.updateMessages('session-1', [{ message_id: 0, swipes_data: [first, second] }], 2)
  assert.equal(run.chat.mvu.openingInitialization.status, 'complete')
  assert.equal(run.chat.mvu.openingInitialization.version, 2)
  assert.equal(typeof run.chat.mvu.openingInitialization.completedAt, 'number')
})

test('Host Adapter 统一翻译世界书、Swipe 与生命周期事件', async function () {
  const run = harness()
  const projected = await run.adapter.getWorldbook('session-1', 'current')
  const entries = structuredClone(projected.worldbook.entries)
  entries[0].content = '新内容'
  const changed = await run.adapter.replaceWorldbook('session-1', '测试世界书', entries)
  assert.equal(changed.updated, true)
  assert.equal(run.worldbook.view.entries[0].content, '新内容')

  await run.adapter.switchSwipe('session-1', 0, 1)
  assert.equal(run.chat.messages[0].swipeId, 1)
  assert.equal(run.events.at(-1).name, 'MESSAGE_SWIPED')
  assert.equal(run.events.at(-1).context.messages[0].message, '新正文')
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
