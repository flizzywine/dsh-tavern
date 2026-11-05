import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createAutoCompaction } from '../tavern-plugin/lib/domain/auto-compaction.js'

const gate = () => Promise.withResolvers()
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await nextTurn()
  }
  assert.fail('controlled operation did not reach the expected boundary')
}
function fixture() {
  let chat = { id: 'chat', mode: 'story', sessionId: 'front', messages: [], timeline: {
    branchId: 'main', revision: 1, participants: { background: { sessionId: 'back' } }
  } }
  let tail = Promise.resolve()
  const calls = [], writes = [], checkpoints = { front: 7, back: 17 }
  const deps = {
    readChat: async () => structuredClone(chat),
    updateChat: (_id, mutate) => {
      const work = tail.then(async () => {
        await nextTurn()
        const before = structuredClone(chat)
        chat = mutate(structuredClone(chat))
        writes.push({ before, after: structuredClone(chat) })
        return structuredClone(chat)
      })
      tail = work.catch(() => {})
      return work
    },
    policy: async () => ({ mode: 'manual' }),
    activity: () => ({ phase: 'idle' }), exclusive: async (_id, work) => work(),
    pressure: async () => ({ percent: 40 }), checkpoint: async id => checkpoints[id],
    recover: async () => 'succeeded',
    markBackground: async (id, target) => deps.updateChat(id, current => {
      assert.equal(current.timeline.participants.background.sessionId, target)
      current.timeline.participants.background.requiresNewSessionOnRewind = true
      return current
    }),
    compact: async (id, side, options, signal) => {
      const receipt = chat.contextCompaction.operation[side]
      assert.deepEqual(receipt, { status: 'dispatching', before: checkpoints[id] })
      calls.push(side)
      await h.compact(id, side, options, signal)
      checkpoints[id]++
      return { message: side + ' done' }
    }
  }
  let service = createAutoCompaction(deps)
  const h = {
    deps, calls, writes, checkpoints, compact: async () => {},
    get chat() { return chat },
    run: options => service.run('front', options),
    blocked: () => service.blocked(chat),
    restart() { service = createAutoCompaction(deps) }
  }
  return h
}

test('parallel sides persist independent receipts before dispatch and retain every interleaved update', async () => {
  const h = fixture(), foreground = gate(), background = gate()
  h.compact = async (_id, side) => (side === 'foreground' ? foreground : background).promise
  const running = h.run({ manual: true })
  try {
    await until(() => h.calls.length === 2)
    assert.equal(h.blocked(), true)
    assert.equal(h.chat.contextCompaction.operation.foreground.status, 'dispatching')
    assert.equal(h.chat.contextCompaction.operation.background.status, 'dispatching')
    foreground.resolve()
    await until(() => h.chat.contextCompaction.operation.foreground.status === 'succeeded')
    assert.equal(h.chat.contextCompaction.operation.background.status, 'dispatching')
    assert.equal(h.chat.contextCompaction.operation.status, 'running')
    background.resolve()
    const result = await running
    assert.equal(result.status, 'completed')
    assert.equal(result.foreground.after, 8)
    assert.equal(result.background.after, 18)
    assert.deepEqual(h.chat.contextCompaction.operation, result)
    assert.equal(h.chat.timeline.participants.background.requiresNewSessionOnRewind, true)
    assert.equal(h.blocked(), false)
    for (const { before, after } of h.writes) {
      const previous = before.contextCompaction?.operation, current = after.contextCompaction?.operation
      if (!previous || previous.id !== current?.id) continue
      const changed = ['foreground', 'background'].filter(side => JSON.stringify(previous[side]) !== JSON.stringify(current[side]))
      assert.ok(changed.length <= 1, 'a receipt write must not publish the sibling in-memory receipt')
      for (const side of ['foreground', 'background']) {
        if (previous[side].status === 'succeeded') assert.deepEqual(current[side], previous[side])
      }
    }
  } finally { foreground.resolve(); background.resolve(); await running }
})

test('parallel duration is max(24s, 13s), with afterPercent measured only after both settle', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const h = fixture(), events = []
  h.deps.policy = async () => ({ mode: 'percent', percent: 80 })
  h.deps.pressure = async () => { events.push(['pressure', Date.now()]); return { percent: 35 } }
  h.compact = async (_id, side) => {
    events.push([side, Date.now()])
    await new Promise(resolve => setTimeout(resolve, side === 'foreground' ? 24000 : 13000))
  }
  const running = h.run({ manual: true })
  await until(() => h.calls.length === 2)
  t.mock.timers.tick(13000)
  await until(() => h.chat.contextCompaction.operation.background.status === 'succeeded')
  assert.equal(events.length, 2)
  assert.equal(h.blocked(), true)
  t.mock.timers.tick(11000)
  const result = await running
  assert.equal(result.completedAt - result.startedAt, 24000)
  assert.equal(result.afterPercent, 35)
  assert.deepEqual(events, [['foreground', 0], ['background', 0], ['pressure', 24000]])
})

for (const failed of ['foreground', 'background']) {
  test(`parallel ${failed} failure keeps the other receipt and yields partial`, async () => {
    const h = fixture(), release = gate()
    h.compact = async (_id, side) => { await release.promise; if (side === failed) throw Error('fixture failure') }
    const running = h.run({ manual: true })
    await until(() => h.calls.length === 2)
    release.resolve()
    const result = await running
    assert.equal(result.status, 'partial')
    assert.equal(result[failed].status, 'failed')
    const other = failed === 'foreground' ? 'background' : 'foreground'
    assert.equal(result[other].status, 'succeeded')
    assert.deepEqual(h.chat.contextCompaction.operation[other], result[other])
    assert.match(h.chat.contextCompaction.warning, /fixture failure/)
    assert.equal(h.blocked(), false)
  })
}

test('abort with both sides in flight waits for both and preserves the side that already committed', async () => {
  const h = fixture(), foreground = gate(), controller = new AbortController()
  h.compact = async (_id, side, _options, signal) => {
    assert.equal(signal, controller.signal)
    if (side === 'foreground') return foreground.promise
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }
  const running = h.run({ manual: true, signal: controller.signal })
  await until(() => h.calls.length === 2)
  foreground.resolve()
  await until(() => h.chat.contextCompaction.operation.foreground.status === 'succeeded')
  controller.abort()
  const result = await running
  assert.equal(result.status, 'partial')
  assert.equal(result.foreground.after, 8)
  assert.equal(result.background.status, 'failed')
  assert.equal(h.blocked(), false)
})

test('abort during both requests records both failures before releasing the reservation', async () => {
  const h = fixture(), controller = new AbortController()
  h.compact = async (_id, _side, _options, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const running = h.run({ manual: true, signal: controller.signal })
  await until(() => h.calls.length === 2)
  controller.abort()
  const result = await running
  assert.equal(result.status, 'failed')
  assert.equal(result.foreground.status, 'failed')
  assert.equal(result.background.status, 'failed')
  assert.equal(h.blocked(), false)
})

for (const evidence of ['succeeded', 'unknown']) {
  test(`restart recovers both dispatching receipts independently (${evidence} background evidence)`, async () => {
    const h = fixture(), recovered = []
    h.chat.contextCompaction = { operation: {
      id: 'interrupted', status: 'running', foregroundSessionId: 'front', backgroundSessionId: 'back',
      foreground: { status: 'dispatching', before: 7 }, background: { status: 'dispatching', before: 17 }
    } }
    h.deps.recover = async (id, before) => { recovered.push([id, before]); return id === 'front' ? 'succeeded' : evidence }
    h.restart()
    const result = await h.run()
    assert.deepEqual(recovered, [['front', 7], ['back', 17]])
    assert.deepEqual(h.calls, [])
    assert.equal(result.status, evidence === 'succeeded' ? 'completed' : 'partial')
    assert.equal(result.foreground.status, 'succeeded')
    assert.equal(result.background.status, evidence === 'succeeded' ? 'succeeded' : 'failed')
    assert.equal(h.blocked(), false)
  })
}

test('foreground busy deferral drains background and pre-step retry reuses its successful receipt', async () => {
  const h = fixture(), foreground = gate(), background = gate()
  h.deps.policy = async () => ({ mode: 'rounds', rounds: 1 })
  await h.run()
  h.chat.messages.push({ role: 'assistant', turn: 1 })
  h.compact = async (_id, side, options) => {
    if (side === 'background') return background.promise
    if (!options.openTurnCompact) { await foreground.promise; throw Object.assign(Error('busy'), { code: 'busy' }) }
  }
  let returned = false
  const idle = h.run().then(result => { returned = true; return result })
  await until(() => h.calls.length === 2)
  const preStep = h.run({ openTurnCompact: () => {} })
  foreground.resolve()
  await until(() => h.chat.contextCompaction.operation.foreground.status === 'pending')
  assert.equal(h.chat.contextCompaction.operation.status, 'running')
  assert.equal(h.chat.contextCompaction.operation.background.status, 'dispatching')
  assert.equal(returned, false)
  assert.equal(h.blocked(), true)
  background.resolve()
  const deferred = await idle
  assert.equal(deferred.status, 'deferred')
  assert.equal(deferred.background.status, 'succeeded')
  const result = await preStep
  assert.equal(result.status, 'completed')
  assert.deepEqual(h.calls, ['foreground', 'background', 'foreground'])
  assert.deepEqual(result.background, deferred.background)
  assert.equal(h.blocked(), false)
})

test('unexpected receipt-save rejection drains the sibling and leaves recoverable persisted state', async () => {
  const h = fixture(), foreground = gate(), background = gate()
  h.compact = async (_id, side) => (side === 'foreground' ? foreground : background).promise
  const update = h.deps.updateChat
  let fail = true
  h.deps.updateChat = (id, mutate) => update(id, current => {
    const next = mutate(current)
    if (fail && next.contextCompaction?.operation?.foreground?.status === 'succeeded') {
      fail = false
      throw Error('receipt storage unavailable')
    }
    return next
  })
  let returned = false
  const running = h.run({ manual: true }).finally(() => { returned = true })
  const rejected = assert.rejects(running, /receipt storage unavailable/)
  await until(() => h.calls.length === 2)
  foreground.resolve()
  await until(() => !fail)
  assert.equal(returned, false)
  assert.equal(h.blocked(), true)
  background.resolve()
  await rejected
  assert.equal(h.chat.contextCompaction.operation.foreground.status, 'dispatching')
  assert.equal(h.chat.contextCompaction.operation.background.status, 'succeeded')
  h.restart()
  assert.equal((await h.run()).status, 'completed')
  assert.deepEqual(h.calls, ['foreground', 'background'])
})
