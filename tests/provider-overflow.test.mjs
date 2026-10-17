import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProviderOverflow } from '../tavern-plugin/lib/domain/provider-overflow.js'
import { createTavernRetryLimiter } from '../tavern-plugin/lib/domain/tavern-retry-limiter.js'

test('Zhipu 1261 is relabelled as context overflow for later handlers', async () => {
  const payload = { failure: Object.freeze({ code: 'BAD_REQUEST', message: '400 {"error":{"code":"1261","message":"Prompt exceeds max length"}}' }) }
  let seen
  await normalizeProviderOverflow(payload, async () => { seen = payload.failure.code })
  assert.equal(seen, 'CONTEXT_WINDOW_EXCEEDED')
  assert.match(payload.failure.message, /1261/)
})

test('other failures keep their code', async () => {
  const failure = { code: 'RATE_LIMIT', message: 'too many requests' }
  const payload = { failure }
  await normalizeProviderOverflow(payload, async () => {})
  assert.equal(payload.failure, failure)
})

test('the retry limiter leaves overflow to compaction even under an always-retry policy', async () => {
  const limiter = createTavernRetryLimiter({ owns: () => true })
  const payload = { agent: { session: { append() { throw new Error('should not retry') } } }, retryPolicy: { mode: 'always' }, failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'x' } }
  assert.equal(await limiter.handle(payload, async () => 'next'), 'next')
})
