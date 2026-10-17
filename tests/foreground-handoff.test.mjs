import assert from 'node:assert/strict'
import test from 'node:test'

import { createForegroundHandoff } from '../tavern-plugin/lib/domain/foreground-handoff.js'
import { prepareWorldBookRecall } from '../tavern-plugin/lib/domain/worldbook-recall.js'

test('开场预扫描只提供预览，不调用结算模型、不重复准备', async () => {
  const chat = { id: 'opening', mode: 'story', messages: [{ role: 'assistant', greeting: true, text: '铜铃渡口旁有星砂信箱。', turn: 1 }] }
  const entries = ['铜铃渡口', '星砂信箱', '玩家专有词'].map((key, index) => ({ ref: 'entry:' + index, enabled: true, constant: false, primaryKeys: [key], content: '秘密' + index }))
  let preparations = 0
  const handoff = createForegroundHandoff({
    store: { async chatForSession() { return chat } },
    tasks: { activity() { return { phase: 'idle', role: '', busy: false } } },
    async queueBackground() { assert.fail('开场召回无需启动结算模型') },
    async prepareOpeningWorldBook(current) {
      preparations++
      const result = prepareWorldBookRecall({ chat: current, card: { name: '阿芙拉' }, turn: 1, worldBook: { view: { entries } } })
      current.preparedWorldBook = { refs: result.refs }
      current.preparedWorldBookContext = result.context
    },
    turns: {
      async finalize() {}, async discard() {},
      async prepare() {
        assert.deepEqual(chat.preparedWorldBook.refs, [])
        assert.doesNotMatch(chat.preparedWorldBookContext, /秘密0/)
        assert.doesNotMatch(chat.preparedWorldBookContext, /秘密1/)
        assert.doesNotMatch(chat.preparedWorldBookContext, /秘密2/)
      }
    }
  })
  await handoff.prepare({ sessionId: 'session', turn: 2, userText: '玩家专有词' })
  await handoff.prepare({ sessionId: 'session', turn: 2, userText: '玩家专有词' })
  assert.equal(preparations, 1)
})

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

test('发送前与回复后只读表头：完整读取仅留给开场预扫描', async () => {
  const header = { id: 'chat-2', mode: 'story', timeline: {} }
  const calls = []
  const deferred = []
  const handoff = createForegroundHandoff({
    store: {
      async chatForSession() { calls.push('full'); return { ...header, messages: [{ role: 'assistant', greeting: true }] } },
      async stateForSession() { calls.push('state'); return header },
      async openingStateForSession() { calls.push('opening'); return { chat: header, messageCount: calls.includes('greeting') ? 1 : 9, firstGreeting: true } }
    },
    tasks: { activity() { return { phase: 'pending', busy: true, role: 'settlement' } } },
    async queueBackground(chatId) { calls.push('queue:' + chatId) },
    async prepareOpeningWorldBook() { calls.push('opening-worldbook') },
    turns: { async finalize() {}, async discard() {}, async prepare() { calls.push('prepare') } },
    defer(run) { deferred.push(run) }
  })
  await handoff.prepare({ sessionId: 's', turn: 5, userText: '继续' })
  assert.deepEqual(calls, ['opening', 'queue:chat-2', 'prepare'])
  handoff.end({ sessionId: 's', turn: 5, reason: 'completed' })
  deferred[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.slice(3), ['state', 'queue:chat-2'])
  calls.length = 0; calls.push('greeting')
  await handoff.prepare({ sessionId: 's', turn: 2, userText: '继续' })
  assert.deepEqual(calls.slice(1), ['opening', 'queue:chat-2', 'full', 'opening-worldbook', 'prepare'])
})

test('发送前等插件任务跑完：结算之后的插件任务不让下一轮插队', async () => {
  const order = []
  let release
  const handoff = createForegroundHandoff({
    store: { async chatForSession() { return { id: 'chat-3', mode: 'story', messages: [] } } },
    tasks: { activity() { return { phase: 'running', busy: true, role: 'plugin-task' } } },
    async queueBackground() { assert.fail('插件任务不是结算') },
    waitBackground: chatId => new Promise(resolve => { order.push('wait:' + chatId); release = resolve }),
    turns: { async finalize() {}, async discard() {}, async prepare() { order.push('prepare') } }
  })
  const prepared = handoff.prepare({ sessionId: 'session-3', turn: 2, userText: '继续' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['wait:chat-3'])
  release()
  await prepared
  assert.deepEqual(order, ['wait:chat-3', 'prepare'])
})

test('发送前先清掉遗留的失败回合，再准备本轮（#193）', async () => {
  const order = []
  const handoff = createForegroundHandoff({
    store: { async chatForSession() { return { id: 'chat-4', mode: 'story', messages: [] } } },
    tasks: { activity() { return { phase: 'idle', busy: false, role: '' } } },
    async queueBackground() {},
    clearFailedTurns: async sessionId => { order.push('clear:' + sessionId) },
    turns: { async finalize() {}, async discard() {}, async prepare() { order.push('prepare') } }
  })
  await handoff.prepare({ sessionId: 'session-4', turn: 3, userText: '教室写字' })
  assert.deepEqual(order, ['clear:session-4', 'prepare'])
})
