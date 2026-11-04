import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernRetryLimiter } from '../tavern-plugin/lib/domain/tavern-retry-limiter.js'

function fixture() {
  const events = []
  const session = {
    events,
    append(type, data) {
      const event = { seq: events.length, type, data }
      events.push(event)
      return event
    }
  }
  return {
    session,
    payload: {
      agent: { session },
      turn: 2,
      step: 1,
      provider: 'test',
      failure: { message: 'closed', code: 'TRANSPORT' },
      retryPolicy: {
        mode: 'normal',
        maxRetries: 5,
        retryableCodes: ['TRANSPORT'],
        initialDelayMs: 500,
        maxDelayMs: 10000,
        jitterRatio: 0.1
      },
      signal: new AbortController().signal
    }
  }
}

test('rc.1 snapshot-only Session still limits requests to one retry', async () => {
  const { session, payload } = fixture()
  const events = session.events
  delete session.events
  session.snapshotEvents = () => Object.freeze(events.slice())
  const limiter = createTavernRetryLimiter({ owns: async () => true, wait: async () => true })
  assert.deepEqual(await limiter.handle(payload, async () => {}), { kind: 'retry' })
  assert.equal(await limiter.handle(payload, async () => {}), undefined)
  assert.equal(events.filter(event => event.type === 'llm/retry').length, 1)
})

test('设置 › 高级 › 请求失败自动重试 关闭后一次都不重发，也不再交给下游', async () => {
  const { session, payload } = fixture()
  let downstream = 0
  const limiter = createTavernRetryLimiter({ owns: async () => true, wait: async () => true, enabled: async () => false })
  assert.equal(await limiter.handle(payload, async () => { downstream += 1; return { kind: 'retry' } }), undefined)
  assert.equal(downstream, 0)
  assert.equal(session.events.filter(event => event.type === 'llm/retry').length, 0)
})

test('设置读不出来时保持出厂行为：仍然重试一次', async () => {
  const { session, payload } = fixture()
  const limiter = createTavernRetryLimiter({ owns: async () => true, wait: async () => true, enabled: async () => { throw new Error('unreadable') } })
  assert.deepEqual(await limiter.handle(payload, async () => {}), { kind: 'retry' })
  assert.equal(session.events.filter(event => event.type === 'llm/retry').length, 1)
})

test('不是酒馆的会话照旧交给下游，开关不参与', async () => {
  const { payload } = fixture()
  let downstream = 0
  const limiter = createTavernRetryLimiter({ owns: async () => false, enabled: async () => false })
  assert.deepEqual(await limiter.handle(payload, async () => { downstream += 1; return { kind: 'retry' } }), { kind: 'retry' })
  assert.equal(downstream, 1)
})
