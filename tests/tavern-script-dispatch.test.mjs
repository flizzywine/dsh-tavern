import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'

test('opening readiness waits for initialization, propagates failure, and bounds a missing runtime', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = createTavernScriptDispatch({ executionTimeoutMs: 1000 })
  let ready = false
  const pending = gate.waitUntilReady('opening').then(() => { ready = true })
  gate.touch('opening', 'browser', false)
  await Promise.resolve()
  assert.equal(ready, false)
  gate.touch('opening', 'browser', true)
  await pending
  assert.equal(ready, true)
  await gate.waitUntilReady('opening')
  const failure = assert.rejects(gate.waitUntilReady('broken'), /initialization failed/)
  gate.touch('broken', 'browser', false, 'initialization failed')
  await failure
  const missing = assert.rejects(gate.waitUntilReady('missing'), /初始化尚未完成/)
  t.mock.timers.tick(1000)
  await missing
})

function claimAndStart(gate, sessionId, runtimeId = 'legacy') {
  const offer = gate.claim(sessionId, runtimeId, true)
  assert.ok(offer.event)
  assert.equal(gate.start(sessionId, offer.event.id, offer.leaseToken, runtimeId).started, true)
  return offer
}

test('claim 响应丢失后重放同一 offer，显式 start 后才进入执行超时', async function () {
  const gate = createTavernScriptDispatch({ claimTimeoutMs: 500, executionTimeoutMs: 100 })
  gate.touch('session-a', 'browser-a', true)
  const pending = gate.dispatch('session-a', 'MESSAGE_RECEIVED', [1])

  const first = gate.claim('session-a', 'browser-a', true)
  const replay = gate.claim('session-a', 'browser-a', true)
  assert.equal(gate.status('session-a').phase, 'offered')
  assert.equal(replay.event.id, first.event.id)
  assert.equal(replay.leaseToken, first.leaseToken)
  assert.deepEqual(gate.start('session-a', first.event.id, first.leaseToken, 'browser-a'), { started: true, alreadyStarted: false })
  assert.deepEqual(gate.start('session-a', first.event.id, first.leaseToken, 'browser-a'), { started: true, alreadyStarted: true })
  assert.equal(gate.status('session-a').phase, 'executing')

  const result = await pending
  assert.equal(result.executionLost, true)
  assert.equal(result.phase, 'executing')
})

test('MVU 加载失败即时终止在途事件，保留脱敏原因且不发布 ready；只有租约所有者可报告', async () => {
  const gate = createTavernScriptDispatch({ timeoutMs: 200 })
  let ready = 0, settled = 0
  gate.subscribeReady(() => ready++)
  gate.subscribeSettled(() => settled++)
  gate.claim('s', 'owner', true)
  const pending = gate.dispatch('s', 'MESSAGE_RECEIVED', [0])
  const error = 'Failed to fetch dynamically imported module: http://localhost/bundle.js?token=private-value'
  gate.claim('s', 'other', false, error)
  assert.equal(gate.status('s').ready, true)
  gate.claim('s', 'owner', false, error)
  const failed = await pending
  assert.equal(failed.initializationFailed, true)
  assert.match(failed.error, /bundle.js/)
  assert.doesNotMatch(failed.error, /private-value/)
  assert.equal(gate.status('s').ready, false)
  assert.equal(ready, 1)
  assert.equal(settled, 2)
  gate.claim('s', 'owner', false, error)
  assert.equal(settled, 2)
  assert.equal((await gate.dispatch('s', 'MESSAGE_RECEIVED')).initializationFailed, true)
  gate.claim('s', 'owner', true)
  assert.equal(gate.status('s').initializationError, undefined)
  assert.equal(ready, 2)
})

test('完成回执可重复确认，查询与续租严格校验执行身份', async () => {
  const gate = createTavernScriptDispatch({ executionTimeoutMs: 100 })
  gate.touch('s', 'browser', true)
  const pending = gate.dispatch('s', 'MESSAGE_RECEIVED', [1])
  const { event, leaseToken } = claimAndStart(gate, 's', 'browser')
  try {
    assert.equal(gate.workState('s', event.id, leaseToken, 'other', true).phase, 'unknown')
    for (let i = 0; i < 4; i++) {
      await new Promise(resolve => setTimeout(resolve, 40))
      assert.equal(gate.workState('s', event.id, leaseToken, 'browser', true).phase, 'executing')
    }
    assert.equal(gate.complete('s', event.id, [2], 'browser', leaseToken), true)
    assert.equal(gate.complete('s', event.id, [2], 'browser', leaseToken), true)
    assert.equal(gate.workState('s', event.id, leaseToken, 'browser').phase, 'completed')
    assert.deepEqual(await pending, { handled: true, args: [2] })
  } finally { gate.dispose('s') }
})
