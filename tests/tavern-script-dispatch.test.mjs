import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'

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

test('unclaimed work expires the stale ready lease before settlement retries', async function () {
  const gate = createTavernScriptDispatch({ claimTimeoutMs: 100 })
  const settled = []
  gate.subscribeSettled(sessionId => settled.push(sessionId))
  gate.touch('session-a', 'browser', true)
  const result = await gate.dispatch('session-a', 'MESSAGE_SENT', [5])
  assert.deepEqual(result, { handled: false, unavailable: true, claimTimedOut: true, phase: 'queued', args: [5] })
  assert.deepEqual(gate.status('session-a'), { present: false, ready: false, busy: false, phase: 'idle' })

  gate.claim('session-a', 'browser', true)
  assert.deepEqual(settled, ['session-a', 'session-a'])
})

test('同一会话只允许一个浏览器运行 Helper，租约过期后才能接管', function () {
  let clock = 0
  const gate = createTavernScriptDispatch({ timeoutMs: 100, presenceTtlMs: 1000, now: function () { return clock } })

  assert.deepEqual(gate.claim('session-a', 'browser-a'), { active: true, ready: false, event: null })
  assert.deepEqual(gate.claim('session-a', 'browser-b'), { active: false, ready: false, event: null })
  clock = 1001
  assert.deepEqual(gate.claim('session-a', 'browser-b'), { active: true, ready: false, event: null })
  assert.deepEqual(gate.claim('session-a', 'browser-a'), { active: false, ready: false, event: null })
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

test('claim 尚未同步失败时，事件回执也识别初始化失败并脱敏', async () => {
  const gate = createTavernScriptDispatch()
  gate.claim('s', 'owner', true)
  const pending = gate.dispatch('s', 'MESSAGE_RECEIVED')
  const offer = claimAndStart(gate, 's', 'owner')
  const { event } = offer
  gate.complete('s', event.id, [], 'owner', offer.leaseToken, 'MVU 加载失败 http://localhost/bundle.js?token=secret-value',
    [{ kind: 'initialization', initializationFailed: true }])
  const result = await pending
  assert.equal(result.initializationFailed, true)
  assert.doesNotMatch(result.error, /secret-value/)
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
