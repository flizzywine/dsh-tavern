import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { deferred, flush, syncClock } from './fixtures/sync-clock.mjs'
const context = vm.createContext({ AbortController })
vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/src/client/modules/session-refresh-controller.js', import.meta.url), 'utf8'), context)
const create = context.createSessionRefreshController
function harness(overrides = {}) {
  const clock = syncClock(), loads = [], seen = [], errors = []
  const loop = create({ ...clock, loadTimeoutMs: 1000,
    load(scope) { const work = deferred(); loads.push({ ...work, scope }); return work.promise },
    onResult(result) { seen.push(result) },
    onError(error, scope) { errors.push({ error, timedOut: scope.timedOut }); return { retry: 5000 } }, ...overrides })
  loop.start()
  return { clock, loads, seen, errors, loop }
}

test('wake-up storms coalesce without cancelling an in-flight read or starving its result', async () => {
  const h = harness(); h.loop.request(); await h.clock.next()
  for (let n = 0; n < 500; n++) h.loop.request()
  assert.equal(h.loads.length, 1)
  assert.equal(h.loads[0].scope.signal.aborted, false)
  h.loads[0].resolve('first'); await flush()
  assert.deepEqual(h.seen, ['first'])
  assert.deepEqual(h.clock.delays(), [0])
  await h.clock.next(); assert.equal(h.loads.length, 2)
  h.loads[1].resolve('second'); await flush()
  assert.deepEqual(h.seen, ['first', 'second']); assert.deepEqual(h.clock.delays(), [])
  h.loop.stop()
})

for (const failure of ['timeout', 'error']) test(`${failure} retry deadline survives queued invalidation, new invalidations and watchdogs`, async () => {
  const h = harness(); h.loop.request(); await h.clock.next(); h.loop.request()
  if (failure === 'timeout') await h.clock.advance(1000)
  else { h.loads[0].reject(new Error('offline')); await flush() }
  assert.equal(h.errors.length, 1); assert.equal(h.errors[0].timedOut, failure === 'timeout')
  assert.deepEqual(h.clock.delays(), [5000])
  for (let n = 0; n < 4; n++) {
    await h.clock.advance(1000); h.loop.request(); await h.loop.refresh()
    assert.equal(h.loads.length, 1)
    assert.deepEqual(h.clock.delays(), [4000 - n * 1000])
  }
  await h.clock.advance(999); assert.equal(h.loads.length, 1)
  await h.clock.advance(1); assert.equal(h.loads.length, 2)
  h.loads[1].resolve('recovered'); await flush()
  assert.deepEqual(h.seen, ['recovered']); assert.deepEqual(h.clock.delays(), [])
  h.loop.stop()
})

for (const outcome of ['resolve', 'reject']) test(`replacement revokes late ${outcome}, timeout and finally before starting successor`, async () => {
  const h = harness(); h.loop.request(); await h.clock.next(); h.loop.request()
  h.loop.replace(); assert.equal(h.loads[0].scope.signal.aborted, true)
  h.loop.request(); await h.clock.next()
  h.loads[0][outcome](outcome === 'resolve' ? 'old' : new Error('old error')); await flush()
  assert.deepEqual(h.seen, []); assert.deepEqual(h.errors, [])
  assert.equal(h.loads[1].scope.isCurrent(), true)
  h.loads[1].resolve('new'); await flush(); await h.clock.advance(10000)
  assert.deepEqual(h.seen, ['new']); assert.deepEqual(h.clock.delays(), [])
  h.loop.stop()
})

test('stop and immediate re-subscribe isolate a hung, abort-ignoring old task', async () => {
  const h = harness(); h.loop.request(); await h.clock.next()
  h.loop.stop(); h.loop.start(); h.loop.request(); await h.clock.next()
  assert.equal(h.loads.length, 2)
  h.loads[1].resolve('new lifetime'); await flush()
  h.loads[0].reject(new Error('old lifetime')); await flush()
  assert.deepEqual(h.seen, ['new lifetime']); assert.deepEqual(h.errors, []); assert.deepEqual(h.clock.delays(), [])
  h.loop.stop()
})

test('synchronous cancellation while publishing loading never starts the old adapter', async () => {
  let loop, calls = 0
  const clock = syncClock()
  loop = create({ ...clock, loadTimeoutMs: 1000, onStart() { loop.stop() }, load() { calls++ }, onResult() {}, onError() { assert.fail('retired error') } })
  loop.start(); loop.request(); await clock.next()
  assert.equal(calls, 0); assert.deepEqual(clock.delays(), [])
})
