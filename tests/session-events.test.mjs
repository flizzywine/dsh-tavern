import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

test('rc.1 history uses the current immutable snapshot without reading the removed property', () => {
  let events = Object.freeze([{ seq: 0 }])
  const session = {
    snapshotEvents() { assert.equal(this, session); return events },
    get events() { throw Error('removed API') },
  }
  const first = sessionEvents(session)
  assert.equal(first, events)
  events = Object.freeze([...events, { seq: 1 }])
  assert.equal(sessionEvents(session).length, 2)
  assert.equal(first.length, 1)
  assert.equal(Object.isFrozen(first), true)
})

test('old hosts and unavailable sessions retain their existing read semantics', () => {
  const events = Object.freeze([{ seq: 0 }])
  assert.equal(sessionEvents({ events }), events)
  for (const session of [null, undefined, {}, { events: null }]) assert.deepEqual(sessionEvents(session), [])
  assert.throws(() => sessionEvents({ snapshotEvents() { throw Error('read failure') } }), /read failure/)
})
