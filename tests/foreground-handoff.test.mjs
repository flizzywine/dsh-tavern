import assert from 'node:assert/strict'
import test from 'node:test'

import { createForegroundHandoff } from '../tavern-plugin/lib/domain/foreground-handoff.js'

test('Foreground Turn 完成后只在 turn/end 成功事件后启动持久 Background Cycle', async () => {
  const deferred = []
  const queued = []
  const chat = { id: 'chat-1' }
  const handoff = createForegroundHandoff({
    turns: { async finalize(input) { return { saved: true, chatId: chat.id, input } }, async discard() {} },
    store: { async chatForSession() { return chat } },
    tasks: { activity() { return { phase: 'pending', busy: true, role: 'worldbook' } } },
    async queueBackground(chatId) { queued.push(chatId) },
    defer(run) { deferred.push(run) },
    logger: { error() {} }
  })

  await handoff.finalize({ sessionId: 'session-1', turn: 1, userText: '向前走', assistantText: '雨夜。' })
  assert.equal(handoff.end({ sessionId: 'session-1', turn: 1, reason: 'completed' }), true)
  assert.deepEqual(queued, [])
  deferred[0]()
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.deepEqual(queued, ['chat-1'])
})

test('失败回合只清理 Foreground Turn，不启动后台工作', async () => {
  const discarded = []
  const queued = []
  const handoff = createForegroundHandoff({
    turns: { async finalize() {}, async discard(input) { discarded.push(input) } },
    store: { async chatForSession() { return { id: 'chat-1' } } },
    tasks: { activity() { return { phase: 'idle', busy: false, role: '' } } },
    async queueBackground(chatId) { queued.push(chatId) },
    defer(run) { run() },
    logger: { error() {} }
  })

  assert.equal(handoff.end({ sessionId: 'session-1', turn: 3, reason: 'failed' }), true)
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.deepEqual(discarded, [{ sessionId: 'session-1', turn: 3 }])
  assert.deepEqual(queued, [])
})

test('启动时恢复所有遗留 Background Cycle，并重新排队', async () => {
  const recovered = []
  const queued = []
  const chats = new Map([['chat-1', { id: 'chat-1' }], ['chat-2', { id: 'chat-2' }]])
  const handoff = createForegroundHandoff({
    turns: { async finalize() {}, async discard() {} },
    store: { async readChat(id) { return chats.get(id) } },
    tasks: {
      activity() { return { phase: 'idle', busy: false, role: '' } },
      async recover(chat) { recovered.push(chat.id); return { chat, activity: { phase: chat.id === 'chat-1' ? 'pending' : 'idle', busy: chat.id === 'chat-1', role: 'worldbook' } } }
    },
    async queueBackground(chatId) { queued.push(chatId) },
    logger: { error() {} }
  })

  await handoff.recover(['chat-1', 'chat-2'])
  assert.deepEqual(recovered, ['chat-1', 'chat-2'])
  assert.deepEqual(queued, ['chat-1'])
})
