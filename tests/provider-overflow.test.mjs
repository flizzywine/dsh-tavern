import test from 'node:test'
import assert from 'node:assert/strict'

import { createTavernRetryLimiter } from '../tavern-plugin/lib/domain/tavern-retry-limiter.js'

test('the retry limiter leaves overflow to compaction even under an always-retry policy', async () => {
  const limiter = createTavernRetryLimiter({ owns: () => true })
  const payload = { agent: { session: { append() { throw new Error('should not retry') } } }, retryPolicy: { mode: 'always' }, failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'x' } }
  assert.equal(await limiter.handle(payload, async () => 'next'), 'next')
})
