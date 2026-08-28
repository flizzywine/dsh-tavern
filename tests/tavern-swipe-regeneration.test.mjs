import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeRegeneratedSwipe } from '../tavern-plugin/lib/domain/tavern-swipe-regeneration.js'

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
