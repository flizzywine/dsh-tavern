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
