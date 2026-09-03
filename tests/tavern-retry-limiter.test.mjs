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

test('Tavern 最多执行两次请求并把重试上限记录为 1', async () => {
  const { session, payload } = fixture()
  const waits = []
  const limiter = createTavernRetryLimiter({
    owns: async function () { return true },
    wait: async function (delayMs) { waits.push(delayMs); return true },
    id: function () { return 'retry-1' }
  })
  let downstream = 0
  const next = async function () { downstream++; return { kind: 'retry' } }

  assert.deepEqual(await limiter.handle(payload, next), { kind: 'retry' })
  assert.deepEqual(session.events.map(function (event) { return event.type }), ['llm/retry', 'llm/retry-started'])
  assert.equal(session.events[0].data.maxRetries, 1)
  assert.equal(session.events[0].data.retry, 1)
  assert.deepEqual(waits, [500])

  assert.equal(await limiter.handle(payload, next), undefined)
  assert.equal(session.events.length, 2)
  assert.equal(downstream, 0)
})

test('非 Tavern 会话和不可重试错误继续交给 DSH', async () => {
  const { payload } = fixture()
  let downstream = 0
  const next = async function () { downstream++; return undefined }
  const outside = createTavernRetryLimiter({ owns: async function () { return false } })
  assert.equal(await outside.handle(payload, next), undefined)

  const inside = createTavernRetryLimiter({ owns: async function () { return true } })
  payload.failure = { message: 'invalid', code: 'INVALID_REQUEST' }
  assert.equal(await inside.handle(payload, next), undefined)
  assert.equal(downstream, 2)
})

test('取消重试等待后不再启动下一次请求', async () => {
  const { session, payload } = fixture()
  const limiter = createTavernRetryLimiter({
    owns: async function () { return true },
    wait: async function () { return false },
    id: function () { return 'retry-cancelled' }
  })

  assert.equal(await limiter.handle(payload, async function () {}), undefined)
  assert.deepEqual(session.events.map(function (event) { return event.type }), ['llm/retry'])
})
