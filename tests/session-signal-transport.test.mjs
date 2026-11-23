import assert from 'node:assert/strict'
import test from 'node:test'

import { createSessionSignalTransport } from '../tavern-plugin/lib/domain/session-signal-transport.js'

test('narrative-damper 信号保留完整对象快照供实时显示与重放，非白名单信号仍剥离快照', async function () {
  const transport = createSessionSignalTransport()
  const outcome = { mode: 'balanced', judgeMode: 'author', rulingTier: 'full_accept', leverageScore: 1.2, clampedCount: 0, evaluatedAt: 123 }
  transport.publish('session-d', { kind: 'narrative-damper', version: '1', snapshot: { active: true, turn: 2, outcome } })
  transport.publish('session-d', { kind: 'runtime-work', version: '2', snapshot: { ignored: true } })

  const abort = new AbortController()
  const received = []
  const unsubscribe = transport.subscribe('session-d', 'narrative-damper', signal => received.push(signal))
  assert.equal(received.length, 1)
  assert.deepEqual(received[0].snapshot, { active: true, turn: 2, outcome })

  const iterator = transport.follow(abort.signal)[Symbol.asyncIterator]()
  const opening = await iterator.next()
  const byKind = new Map(opening.value.signals.map(s => [s.kind, s]))
  assert.deepEqual(byKind.get('narrative-damper').snapshot, { active: true, turn: 2, outcome })
  assert.equal(byKind.get('runtime-work').snapshot, undefined)

  unsubscribe()
  abort.abort()
  await iterator.return()
})
