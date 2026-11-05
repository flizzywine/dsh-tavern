import test from 'node:test'
import assert from 'node:assert/strict'
import { withHostSession } from '../tavern-plugin/lib/host/sessions.js'

test('loaded sessions are borrowed without acquiring or disposing an Agent', async () => {
  const session = { id: 'session' }
  for (const stored of [true, false]) {
    const host = { sessions: { get: () => stored ? session : undefined }, agents: {
      get: () => ({ session }), resume: () => assert.fail('must not resume a loaded session')
    } }
    assert.equal(await withHostSession(host, session.id, async value => { assert.equal(value, session); return 'result' }), 'result')
  }
})

test('resumed handles stay alive until work settles and are disposed exactly once on success or failure', async () => {
  for (const fail of [false, true]) {
    const session = { id: 'session' }, events = [], failure = new Error('flush failed')
    const host = { sessions: { get() {} }, agents: { get() {}, async resume(input) {
      assert.deepEqual(input, { resumeSessionId: session.id })
      events.push('resume')
      return { agent: { session }, async dispose() { events.push('dispose') } }
    } } }
    const pending = withHostSession(host, session.id, async value => {
      assert.equal(value, session)
      events.push('start')
      await Promise.resolve()
      events.push('finish')
      if (fail) throw failure
      return 42
    })
    if (fail) await assert.rejects(pending, error => error === failure)
    else assert.equal(await pending, 42)
    assert.deepEqual(events, ['resume', 'start', 'finish', 'dispose'])
  }
})

test('failed acquisition never runs work; synchronous work failures still release owned handles', async () => {
  const failure = new Error('not found')
  const host = { sessions: { get() {} }, agents: { get() {}, async resume() { throw failure } } }
  await assert.rejects(withHostSession(host, 'missing', () => assert.fail()), error => error === failure)
  let disposed = 0
  host.agents.resume = async () => ({ agent: { session: {} }, dispose: async () => { disposed++ } })
  await assert.rejects(withHostSession(host, 'session', () => { throw failure }), error => error === failure)
  assert.equal(disposed, 1)
})
