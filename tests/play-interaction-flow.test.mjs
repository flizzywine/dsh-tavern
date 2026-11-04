import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayInteractionFlow } from '../tavern-plugin/lib/domain/play-interaction-flow.js'
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function harness(rpc) {
  const errors = [], views = [], bodies = []
  const flow = createPlayInteractionFlow({ rpc, coordinationView: value => value,
    coordination: { setView: (...args) => views.push(args), invalidate() {} },
    applyBodyResult: (...args) => bodies.push(args), reportError: (...args) => errors.push(args),
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms === 250 ? 0 : ms), clearTimeout } })
  return { flow, errors, views, bodies }
}
test('candidate admission retries share one request id and overlapping submits share work', async () => {
  const requests = []
  const h = harness(async (_method, args) => { requests.push(args); if (requests.length === 1) throw new Error('Failed to fetch'); return { task: { status: 'queued' } } })
  const one = h.flow.submitCandidateTask('a', 'm', 'guide'), two = h.flow.submitCandidateTask('a', 'm', 'guide')
  assert.equal(one, two)
  assert.equal((await one).status, 'queued')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].requestId, requests[1].requestId)
  await h.flow.submitCandidateTask('a', 'm', 'guide')
  assert.equal(requests.length, 3)
})
test('body regeneration owns busy state and guidance, ignores double submit and preserves a newer panel', async () => {
  const wait = deferred(), calls = [], h = harness(async (...args) => { calls.push(args); return wait.promise })
  const panel = h.flow.regeneration.set({ sessionId: 'a', phase: 'input', tail: 'tail' })
  const pending = h.flow.regenerateBody(panel, ' 改写 ', { restyle: true })
  await h.flow.regenerateBody(panel, 'second')
  assert.equal(h.flow.guidance('a'), '改写')
  assert.equal(h.flow.guidance('b'), '')
  const next = h.flow.regeneration.set({ sessionId: 'b', phase: 'input' })
  const candidates = h.flow.candidates.set({ sessionId: 'b', choices: ['new'] })
  wait.resolve({ view: { chatId: 'a' } }); await pending
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['regenBody', { guidance: '改写', restyle: true, styleGuidance: '改写' }, 'a'])
  assert.equal(h.flow.regeneration.getSnapshot(), next)
  assert.equal(h.flow.candidates.getSnapshot(), candidates)
  assert.deepEqual(h.bodies, [['a', { chatId: 'a' }, 'tail']])
})
test('panel subscriptions release and matching candidate refresh retains collapsed state', () => {
  const h = harness(), snapshots = []
  const release = h.flow.candidates.subscribe(value => snapshots.push(value))
  h.flow.candidates.set({ sessionId: 'a', messageId: 'm', phase: 'ready', choices: ['one'], expanded: true })
  h.flow.candidates.set({ sessionId: 'a', messageId: 'm', phase: 'ready', choices: ['one'] })
  assert.equal(h.flow.candidates.getSnapshot().expanded, true)
  release(); h.flow.candidates.set(null)
  assert.equal(snapshots.length, 2)
})
test('body regeneration without the panel opens nothing, keeps the request and reports its warning', async () => {
  const calls = [], h = harness(async (...args) => { calls.push(args); return { view: { chatId: 'a', regenerationWarning: '正文被截断' } } })
  const result = await h.flow.submitBodyRegeneration('a', { tail: 'tail' }, '')
  assert.deepEqual(calls, [['regenBody', { guidance: '' }, 'a']])
  assert.equal(h.flow.regeneration.getSnapshot(), null)
  assert.equal(h.flow.guidance('a'), '')
  assert.deepEqual(h.bodies, [['a', { chatId: 'a', regenerationWarning: '正文被截断' }, 'tail']])
  assert.equal(result.view.chatId, 'a')
  assert.equal(h.errors.length, 1)
  assert.equal(h.errors[0][0], '重新生成提示')
})
test('body regeneration without the panel reports a failure and leaves the panel closed', async () => {
  const h = harness(async () => { throw new Error('boom') })
  await assert.rejects(h.flow.submitBodyRegeneration('a', {}, '按意见改写'), /boom/)
  assert.equal(h.flow.regeneration.getSnapshot(), null)
  assert.equal(h.flow.guidance('a'), '按意见改写')
  assert.deepEqual(h.errors.map(entry => entry[0]), ['正文重新生成'])
})
