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

test('concurrent cold-session readers share one writer and keep it until every borrower finishes', async () => {
  let writer = false, resumes = 0, disposed = 0
  let publish, finish
  const publishing = new Promise(resolve => { publish = resolve })
  const finishing = new Promise(resolve => { finish = resolve })
  let loaded
  const session = { id: 'session' }
  const host = { sessions: { get: () => loaded }, agents: { get() {}, async resume() {
    if (writer) throw new Error('session "session" is already owned by an active write handle')
    writer = true; resumes++
    await publishing
    loaded = session
    return { agent: { session }, async dispose() { writer = false; loaded = undefined; disposed++ } }
  } } }
  const first = withHostSession(host, session.id, async () => { await finishing; assert.equal(writer, true) })
  const second = withHostSession(host, session.id, async () => { assert.equal(writer, true) })
  // Attach the rejection handler before allowing the asynchronous resume to publish.
  const both = Promise.all([first, second])
  publish()
  try {
    await second
    assert.equal(disposed, 0)
    await withHostSession(host, session.id, () => assert.equal(writer, true))
    assert.equal(disposed, 0)
  } finally { finish() }
  await both
  assert.equal(resumes, 1)
  assert.equal(disposed, 1)
})

test('a new borrower waits for a previous writer to finish closing before resuming', async () => {
  let close, closing = false, resumes = 0
  const closed = new Promise(resolve => { close = resolve })
  const session = { id: 'session' }
  const host = { sessions: { get() {} }, agents: { get() {}, async resume() {
    assert.equal(closing, false)
    resumes++
    return { agent: { session }, async dispose() { closing = true; await closed; closing = false } }
  } } }
  const first = withHostSession(host, session.id, () => {})
  while (!closing) await Promise.resolve()
  const second = withHostSession(host, session.id, () => {})
  await Promise.resolve()
  assert.equal(resumes, 1)
  close()
  await Promise.all([first, second])
  assert.equal(resumes, 2)
})

test('a failed shared acquisition can be retried', async () => {
  let attempts = 0
  const failure = new Error('resume failed')
  const host = { sessions: { get() {} }, agents: { get() {}, async resume() {
    if (++attempts === 1) throw failure
    return { agent: { session: { id: 'session' } }, async dispose() {} }
  } } }
  const results = await Promise.allSettled([withHostSession(host, 'session', () => {}), withHostSession(host, 'session', () => {})])
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure))
  assert.equal(await withHostSession(host, 'session', session => session.id), 'session')
  assert.equal(attempts, 2)
})
