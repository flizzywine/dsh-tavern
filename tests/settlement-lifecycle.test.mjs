import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSettlementAfterTurnEndScheduler,
  isOpeningAwaitingSettlement,
  shouldStartSettlementAfterTurnEnd
} from '../tavern-plugin/lib/domain/settlement-lifecycle.js'

test('只有尚未结算的纯开场白会在首次生成候选前补跑后台结算', () => {
  assert.equal(isOpeningAwaitingSettlement({
    settleStatus: 'idle',
    messages: [{ role: 'assistant', text: '开场白', greeting: true }]
  }), true)
  assert.equal(isOpeningAwaitingSettlement({
    settleStatus: 'done',
    messages: [{ role: 'assistant', text: '开场白', greeting: true }]
  }), false)
  assert.equal(isOpeningAwaitingSettlement({
    settleStatus: 'idle',
    messages: [
      { role: 'assistant', text: '开场白', greeting: true },
      { role: 'user', text: '向前走' },
      { role: 'assistant', text: '第一轮正文' }
    ]
  }), false)
})

test('正文只在前台 turn/end 成功送达后启动后台结算', () => {
  const story = { mode: 'story', settleStatus: 'running' }
  assert.equal(shouldStartSettlementAfterTurnEnd(story, 'completed'), true)
  assert.equal(shouldStartSettlementAfterTurnEnd(story, 'max-tokens'), true)
  assert.equal(shouldStartSettlementAfterTurnEnd(story, ''), false)
  assert.equal(shouldStartSettlementAfterTurnEnd(story, 'failed'), false)
  assert.equal(shouldStartSettlementAfterTurnEnd({ mode: 'card', settleStatus: 'running' }, 'completed'), false)
  assert.equal(shouldStartSettlementAfterTurnEnd({ mode: 'story', settleStatus: 'done' }, 'completed'), false)
})

test('后台结算被推迟到 turn/end 事件处理完成后的下一任务', async () => {
  const queued = []
  const deferred = []
  const schedule = createSettlementAfterTurnEndScheduler({
    async readChatForSession() { return { id: 'chat-1', mode: 'story', settleStatus: 'running' } },
    async queueSettlement(chatId) { queued.push(chatId) },
    defer(task) { deferred.push(task) }
  })

  assert.equal(schedule({ sessionId: 'session-1', reason: 'completed' }), true)
  assert.deepEqual(queued, [])
  assert.equal(deferred.length, 1)
  deferred[0]()
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.deepEqual(queued, ['chat-1'])
})
