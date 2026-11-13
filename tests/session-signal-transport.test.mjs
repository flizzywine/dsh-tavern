import assert from 'node:assert/strict'
import test from 'node:test'

import { createSessionSignalTransport } from '../tavern-plugin/lib/domain/session-signal-transport.js'

test('one global snapshot stream coalesces bursts by session and kind and reopens from a complete baseline', async function () {
  const transport = createSessionSignalTransport()
  transport.publish('session-a', { kind: 'tavern-state', version: '1', snapshot: { mailboxVersion: 1 } })
  transport.publish('session-b', { kind: 'runtime-work', version: 'job-1' })

  const abort = new AbortController()
  const iterator = transport.follow(abort.signal)[Symbol.asyncIterator]()
  const opening = await iterator.next()
  assert.equal(opening.value.type, 'snapshot')
  assert.deepEqual(opening.value.signals.map(signal => [signal.sessionId, signal.kind, signal.version]), [
    ['session-a', 'tavern-state', '1'],
    ['session-b', 'runtime-work', 'job-1']
  ])

  for (let version = 2; version <= 1000; version++) {
    transport.publish('session-a', { kind: 'tavern-state', version: String(version), snapshot: { mailboxVersion: version } })
  }
  transport.publish('session-b', { kind: 'runtime-work', version: 'job-2' })

  const firstDelta = await iterator.next()
  const secondDelta = await iterator.next()
  assert.deepEqual([firstDelta.value.signal.version, secondDelta.value.signal.version].sort(), ['1000', 'job-2'])

  abort.abort()
  assert.equal((await iterator.next()).done, true)

  const reopened = transport.follow(new AbortController().signal)[Symbol.asyncIterator]()
  const replacement = await reopened.next()
  assert.deepEqual(replacement.value.signals.map(signal => [signal.sessionId, signal.kind, signal.version]), [
    ['session-a', 'tavern-state', '1000'],
    ['session-b', 'runtime-work', 'job-2']
  ])
  await reopened.return()
})

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

