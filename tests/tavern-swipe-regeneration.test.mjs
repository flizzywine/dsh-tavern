import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { assertRegenerationSourceCurrent, mergeRegeneratedSwipe } from '../tavern-plugin/lib/domain/tavern-swipe-regeneration.js'

test('重新生成正文保留旧 Swipe 和变量快照，并选中新候选', function () {
  const originalChat = {
    id: 'chat-1', posture: '旧状态', messages: [
      { role: 'assistant', greeting: true, text: '开场' },
      { role: 'user', text: '继续', swipeId: 0, swipes: ['继续'], variables: [{ stat_data: { hp: 10 } }] },
      { role: 'assistant', turn: 2, text: '旧正文', sourceText: '旧正文', displayText: '<p>旧正文</p>', swipeId: 0, swipes: ['旧正文'], variables: [{ stat_data: { hp: 9 } }] }
    ]
  }
  const regeneratedChat = {
    id: 'chat-1', posture: '新状态', timeline: { revision: 3 }, messages: [
      { role: 'assistant', greeting: true, text: '开场' },
      { role: 'user', text: '合成输入' },
      { role: 'assistant', turn: 8, text: '新正文', sourceText: '新正文', projectionText: '新投影', displayText: '<p>新正文</p>', swipeId: 0, swipes: ['新正文\n<StatusPlaceHolderImpl/>'], variables: [{ stat_data: { hp: 7 } }] }
    ]
  }

  const result = mergeRegeneratedSwipe({ originalChat, regeneratedChat, assistantIndex: 2 })
  assert.equal(result.chat.posture, '新状态')
  assert.equal(result.chat.timeline.revision, 3)
  assert.equal(result.chat.messages[1].text, '继续')
  assert.equal(result.assistant.turn, 2)
  assert.equal(result.assistant.swipeId, 1)
  assert.deepEqual(result.assistant.swipes, ['旧正文', '新正文\n<StatusPlaceHolderImpl/>'])
  assert.equal(result.assistant.variables[0].stat_data.hp, 9)
  assert.equal(result.assistant.variables[1].stat_data.hp, 7)
  assert.equal(result.assistant.displayText, '<p>新正文</p>')
  assert.equal(originalChat.messages[2].swipes.length, 1)
})

test('没有 MVU 的重新生成仍保留纯文本 Swipe', function () {
  const originalChat = { messages: [{ role: 'user', text: '继续' }, { role: 'assistant', turn: 1, text: '旧正文' }] }
  const regeneratedChat = { messages: [{ role: 'user', text: '合成输入' }, { role: 'assistant', turn: 2, text: '新正文' }] }
  const result = mergeRegeneratedSwipe({ originalChat, regeneratedChat, assistantIndex: 1 })
  assert.deepEqual(result.assistant.swipes, ['旧正文', '新正文'])
  assert.equal(result.assistant.swipeId, 1)
  assert.equal(result.assistant.variables, undefined)
})

test('重新生成允许状态栏捕获并发更新，但拒绝正文真的变化', function () {
  const originalChat = {
    id: 'chat-1', timeline: { branchId: 'branch-1', revision: 4 }, messages: [
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 4, text: '旧正文', sourceText: '旧正文', displayRuntime: { dom: '<p>旧状态栏</p>' } }
    ]
  }
  const displayCaptured = structuredClone(originalChat)
  displayCaptured.messages[1].displayRuntime = { dom: '<p>新状态栏</p>' }
  assert.doesNotThrow(function () {
    assertRegenerationSourceCurrent({ originalChat, currentChat: displayCaptured, assistantIndex: 1 })
  })

  const bodyChanged = structuredClone(displayCaptured)
  bodyChanged.messages[1].text = '另一项操作写入的正文'
  assert.throws(function () {
    assertRegenerationSourceCurrent({ originalChat, currentChat: bodyChanged, assistantIndex: 1 })
  }, function (error) {
    return error && error.code === 'DSH_TAVERN_REGEN_CONFLICT'
  })
})

test('状态栏捕获夹在重生成读写之间时，锁内提交不再产生 messages 假冲突', async function () {
  let stored = {
    id: 'chat-1', timeline: { branchId: 'branch-1', revision: 4 }, _storageRevision: 1, messages: [
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 4, text: '旧正文', sourceText: '旧正文', displayRuntime: { dom: '<p>旧状态栏</p>' } }
    ]
  }
  const store = {
    async read() { return structuredClone(stored) },
    async update(_chatId, updater) {
      const next = await updater(structuredClone(stored))
      if (next !== undefined) stored = structuredClone(next)
      return structuredClone(stored)
    },
    async remove() {}
  }
  const persistence = createChatPersistence({ store, now: function () { return 1000 } })
  const originalChat = await persistence.read('chat-1')
  await persistence.update('chat-1', function (current) {
    current.messages[1].displayRuntime = { dom: '<p>新状态栏</p>' }
    return current
  }, { source: 'display.capture' })

  await persistence.update('chat-1', function (current) {
    assertRegenerationSourceCurrent({ originalChat, currentChat: current, assistantIndex: 1 })
    current.messages = []
    current.regenInProgress = true
    return current
  }, { source: 'rollback.regen' })

  assert.deepEqual(stored.messages, [])
  assert.equal(stored.regenInProgress, true)
})
