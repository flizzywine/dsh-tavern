import assert from 'node:assert/strict'
import test from 'node:test'

import { createSessionSignalTransport } from '../tavern-plugin/lib/domain/session-signal-transport.js'

test('typed session signals filter by kind and dedupe the same authoritative version', function () {
  const transport = createSessionSignalTransport()
  const candidate = []
  const runtime = []
  const stopCandidate = transport.subscribe('session-a', ['candidate'], signal => candidate.push(signal))
  const stopRuntime = transport.subscribe('session-a', ['runtime-work'], signal => runtime.push(signal))

  assert.equal(transport.publish('session-a', { kind: 'candidate', version: '7' }), true)
  assert.equal(transport.publish('session-a', { kind: 'candidate', version: '7' }), false)
  assert.equal(transport.publish('session-a', { kind: 'runtime-work', version: 'event-1' }), true)

  assert.deepEqual(candidate.map(signal => signal.id), ['candidate:7'])
  assert.deepEqual(runtime.map(signal => signal.id), ['runtime-work:event-1'])
  stopCandidate()
  stopRuntime()
})

test('new subscribers replay the latest signal and never receive another session', function () {
  const transport = createSessionSignalTransport()
  transport.publish('session-a', { kind: 'candidate', version: '8' })
  transport.publish('session-b', { kind: 'candidate', version: '9' })
  const received = []
  const stop = transport.subscribe('session-a', [], signal => received.push(signal))

  assert.deepEqual(received.map(signal => ({ sessionId: signal.sessionId, version: signal.version })), [
    { sessionId: 'session-a', version: '8' }
  ])
  stop()
  transport.publish('session-a', { kind: 'candidate', version: '10' })
  assert.equal(received.length, 1)
})

test('tavern-state signal preserves its matching projection snapshot across live delivery and replay', function () {
  const transport = createSessionSignalTransport()
  const snapshot = { mailboxVersion: 7, task: { status: 'succeeded' } }
  const live = []
  const stopLive = transport.subscribe('session-a', ['tavern-state'], signal => live.push(signal))

  transport.publish('session-a', { kind: 'tavern-state', version: '7', snapshot })
  assert.deepEqual(live[0].snapshot, snapshot)
  stopLive()

  const replayed = []
  transport.subscribe('session-a', ['tavern-state'], signal => replayed.push(signal))()
  assert.deepEqual(replayed[0].snapshot, snapshot)
})
