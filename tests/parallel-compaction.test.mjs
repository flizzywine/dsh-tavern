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
