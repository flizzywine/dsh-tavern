import assert from 'node:assert/strict'
import test from 'node:test'

import { createForegroundHandoff } from '../tavern-plugin/lib/domain/foreground-handoff.js'

test('候选重生成跳过普通下一回合的世界同步与失败清理', async () => {
  const order = []
  const handoff = createForegroundHandoff({
    store: { async chatForSession() { return { id: 'chat', mode: 'story', messages: [{ role: 'assistant', text: '旧正文' }],
      regenInProgress: true, regenRecovery: { candidateFrame: { kind: 'foreground' } } } } },
    tasks: { activity() { throw new Error('候选准备不得读取普通任务状态') } },
    async queueBackground() {},
    async beforeNextTurn() { order.push('beforeNextTurn') },
    async clearFailedTurns() { order.push('clearFailedTurns') },
    async syncWorldBook() { order.push('syncWorldBook') },
    turns: { async finalize() {}, async discard() {}, async prepare() { order.push('prepare'); return { ready: true } } }
  })
  const prepared = await handoff.prepare({ sessionId: 'session', turn: 3, userText: '继续' })
  assert.equal(prepared.ready, true)
  assert.deepEqual(order, ['prepare'])
})

test('a turn that ends in an error records why on its kept input before the discard', async () => {
  const order = []
  const handoff = createForegroundHandoff({
    store: { async chatForSession() { return { id: 'chat' } } },
    tasks: { activity() { return {} } }, async queueBackground() {},
    defer: work => work(),
    turns: { async finalize() {}, async prepare() {},
      async recordFailure(input) { order.push(['failure', input]) },
      async discard(target) { order.push(['discard', target]) } }
  })
  handoff.end({ sessionId: 's', turn: 4, reason: 'error', error: { code: 'BAD_REQUEST', message: 'API error (400): invalid thinking signature' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, [
    ['failure', { sessionId: 's', turn: 4, code: 'BAD_REQUEST', message: '这一轮没有生成正文：API error (400): invalid thinking signature' }],
    ['discard', { sessionId: 's', turn: 4 }]
  ])
  // A stop by the player is not a failure.
  order.length = 0
  handoff.end({ sessionId: 's', turn: 5, reason: 'aborted' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, [['discard', { sessionId: 's', turn: 5 }]])
})

test('awaitOpening waits for the card scripts only while the MVU opening is pending', async () => {
  let status = 'pending', waited = 0
  const handoff = createForegroundHandoff({
    store: { async chatForSession() { return { mvu: { enabled: true, owner: 'official', openingInitialization: { status } } } } },
    scriptDispatch: { async waitUntilReady(id) { assert.equal(id, 's'); waited++ } },
    tasks: { activity() { return {} } }, async queueBackground() {},
    turns: { async finalize() {}, async prepare() {}, async discard() {} }
  })
  await handoff.awaitOpening('s')
  status = 'complete'
  await handoff.awaitOpening('s')
  assert.equal(waited, 1)
})