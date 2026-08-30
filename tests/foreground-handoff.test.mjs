import assert from 'node:assert/strict'
import test from 'node:test'

import { createForegroundHandoff } from '../tavern-plugin/lib/domain/foreground-handoff.js'

test('Foreground Turn 完成后立即排队待处理的后台结算', async () => {
  const deferred = []
  const queued = []
  const chat = { id: 'chat-1' }
  const handoff = createForegroundHandoff({
    turns: { async finalize(input) { return { saved: true, chatId: chat.id, input } }, async discard() {} },
    store: { async chatForSession() { return chat } },
    tasks: { activity() { return { phase: 'pending', busy: true, role: 'settlement' } } },
    async queueBackground(chatId) { queued.push(chatId) },
    defer(run) { deferred.push(run) },
    logger: { error() {} }
  })

  await handoff.finalize({ sessionId: 'session-1', turn: 1, userText: '向前走', assistantText: '雨夜。' })
  assert.equal(handoff.end({ sessionId: 'session-1', turn: 1, reason: 'completed' }), true)
  assert.deepEqual(queued, [])
  assert.equal(deferred.length, 1)
  deferred[0]()
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.deepEqual(queued, ['chat-1'])
})

test('正文重生成的临时 DSH 回合不启动变量结算', async () => {
  const deferred = []
  const queued = []
  const handoff = createForegroundHandoff({
    turns: { async finalize() {}, async discard() {} },
    store: { async chatForSession() { return { id: 'chat-1', regenInProgress: true } } },
    tasks: { activity() { return { phase: 'pending', busy: false, role: 'settlement' } } },
    async queueBackground(chatId) { queued.push(chatId) },
    defer(run) { deferred.push(run) },
    logger: { error() {} }
  })

  handoff.end({ sessionId: 'session-1', turn: 2, reason: 'completed' })
  deferred[0]()
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.deepEqual(queued, [])
})

test('失败回合只清理 Foreground Turn，不启动后台工作', async () => {
  const discarded = []
  const cleaned = []
  const queued = []
  const handoff = createForegroundHandoff({
    turns: { async finalize() {}, async discard(input) { discarded.push(input) } },
    store: { async chatForSession() { return { id: 'chat-1' } } },
    tasks: { activity() { return { phase: 'idle', busy: false, role: '' } } },
    async queueBackground(chatId) { queued.push(chatId) },
    async cleanupFailedTurn(input) { cleaned.push(input) },
    defer(run) { run() },
    logger: { error() {} }
  })

  assert.equal(handoff.end({ sessionId: 'session-1', turn: 3, reason: 'failed' }), true)
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.deepEqual(discarded, [{ sessionId: 'session-1', turn: 3 }])
  assert.deepEqual(cleaned, [{ sessionId: 'session-1', turn: 3 }])
  assert.deepEqual(queued, [])
})

test('发送下一轮正文时按需完成待处理 Background Cycle', async () => {
  let prepared = false
  const queued = []
  const handoff = createForegroundHandoff({
    turns: { async prepare() { prepared = true }, async finalize() {}, async discard() {} },
    store: { async chatForSession() { return { id: 'chat-1' } } },
    tasks: { activity() { return { phase: 'pending', busy: false, role: 'settlement' } } },
    async queueBackground(chatId) { queued.push(chatId) },
    logger: { error() {} }
  })

  await handoff.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })
  assert.deepEqual(queued, ['chat-1'])
  assert.equal(prepared, true)
})

test('启动时只把遗留 Background Cycle 恢复为待处理，不自动排队', async () => {
  const recovered = []
  const queued = []
  const chats = new Map([['chat-1', { id: 'chat-1' }], ['chat-2', { id: 'chat-2' }]])
  const handoff = createForegroundHandoff({
    turns: { async finalize() {}, async discard() {} },
    store: { async readChat(id) { return chats.get(id) } },
    tasks: {
      activity() { return { phase: 'idle', busy: false, role: '' } },
      async recover(chat) { recovered.push(chat.id); return { chat, activity: { phase: chat.id === 'chat-1' ? 'pending' : 'idle', busy: false, role: 'settlement' } } }
    },
    async queueBackground(chatId) { queued.push(chatId) },
    logger: { error() {} }
  })

  await handoff.recover(['chat-1', 'chat-2'])
  assert.deepEqual(recovered, ['chat-1', 'chat-2'])
  assert.deepEqual(queued, [])
})
