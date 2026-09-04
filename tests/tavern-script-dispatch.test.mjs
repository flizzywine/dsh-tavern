import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernScriptDispatch, TAVERN_SCRIPT_EXECUTION_TIMEOUT_MS } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'

test('默认执行预算覆盖多个隔离 Helper 脚本的串行事件上限', function () {
  assert.equal(TAVERN_SCRIPT_EXECUTION_TIMEOUT_MS, 60000)
})

test('Script dispatch skips immediately while no browser runtime is present', async function () {
  const gate = createTavernScriptDispatch()
  assert.deepEqual(await gate.dispatch('session-a', 'MESSAGE_SENT', [2]), { handled: false, unavailable: true, args: [2] })
})

test('Script dispatch publishes one work signal and returns browser mutations', async function () {
  const signals = []
  const gate = createTavernScriptDispatch({ timeoutMs: 500, publishSignal(sessionId, signal) { signals.push({ sessionId, ...signal }) } })
  gate.touch('session-a', 'legacy', true)
  const pending = gate.dispatch('session-a', 'COMMAND_PARSED', [{ value: 1 }, [{ type: 'set' }]], { messages: [] })
  assert.equal(gate.status('session-a').phase, 'queued')
  assert.deepEqual(signals, [{ sessionId: 'session-a', kind: 'runtime-work', version: 'script-work-1' }])
  const event = gate.claim('session-a', 'legacy', true).event
  assert.equal(gate.status('session-a').phase, 'executing')
  assert.equal(event.name, 'COMMAND_PARSED')
  assert.deepEqual(event.context, { messages: [] })
  event.args[1].length = 0
  assert.equal(gate.complete('session-a', event.id, event.args), true)
  assert.deepEqual(await pending, { handled: true, args: [{ value: 1 }, []] })
  assert.equal(gate.status('session-a').phase, 'idle')
  assert.equal(gate.claim('session-a', 'legacy', true).event, null)
})

test('Script dispatch propagates browser script failure instead of reporting handled', async function () {
  const gate = createTavernScriptDispatch({ timeoutMs: 500 })
  gate.touch('session-a', 'browser-a', true)
  const pending = gate.dispatch('session-a', 'MESSAGE_RECEIVED', [2])
  const event = gate.claim('session-a', 'browser-a', true).event

  assert.equal(gate.complete('session-a', event.id, event.args, 'browser-a', '变量守卫执行超时'), true)
  assert.deepEqual(await pending, { handled: false, error: '变量守卫执行超时', args: [2] })
  assert.equal(gate.claim('session-a', 'browser-a', true).event, null)
})

test('claimed script work times out without blocking later events', async function () {
  let clock = 0
  const gate = createTavernScriptDispatch({ timeoutMs: 100, presenceTtlMs: 1000, now: function () { return clock } })
  gate.touch('session-a', 'legacy', true)
  const first = gate.dispatch('session-a', 'MESSAGE_SENT', [3])
  gate.claim('session-a', 'legacy', true)
  const result = await first
  assert.equal(result.handled, false)
  assert.equal(result.timedOut, true)
  clock = 50
  const pending = gate.dispatch('session-a', 'MESSAGE_SENT', [4])
  const event = gate.claim('session-a', 'legacy', true).event
  gate.complete('session-a', event.id, event.args)
  assert.equal((await pending).handled, true)
})

test('unclaimed work returns scheduling state after the short claim budget', async function () {
  const gate = createTavernScriptDispatch({ claimTimeoutMs: 100 })
  gate.touch('session-a', 'browser', true)
  const result = await gate.dispatch('session-a', 'MESSAGE_SENT', [5])
  assert.deepEqual(result, { handled: false, unavailable: true, claimTimedOut: true, phase: 'queued', args: [5] })
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

test('非所有者不能完成事件或释放其他浏览器的执行权', async function () {
  const gate = createTavernScriptDispatch({ timeoutMs: 500 })
  gate.claim('session-a', 'browser-a', true)
  const pending = gate.dispatch('session-a', 'MESSAGE_SENT', [1])
  const event = gate.claim('session-a', 'browser-a', true).event

  assert.equal(gate.complete('session-a', event.id, event.args, 'browser-b'), false)
  assert.equal(gate.dispose('session-a', 'browser-b'), false)
  assert.equal(gate.complete('session-a', event.id, event.args, 'browser-a'), true)
  assert.equal((await pending).handled, true)
})

test('浏览器取得租约但脚本尚未完成初始化时不会接收结算事件', async function () {
  const gate = createTavernScriptDispatch({ timeoutMs: 500 })
  assert.deepEqual(gate.claim('session-a', 'browser-a', false), { active: true, ready: false, event: null })
  assert.deepEqual(await gate.dispatch('session-a', 'MESSAGE_RECEIVED', [1]), { handled: false, unavailable: true, args: [1] })
  assert.deepEqual(gate.claim('session-a', 'browser-a', true), { active: true, ready: true, event: null })
})

test('执行器只在从未就绪变为就绪时通知接续任务', function () {
  const gate = createTavernScriptDispatch()
  const ready = []
  const unsubscribe = gate.subscribeReady(function (sessionId) { ready.push(sessionId) })
  gate.claim('session-a', 'browser-a', false)
  gate.claim('session-a', 'browser-a', true)
  gate.claim('session-a', 'browser-a', true)
  assert.deepEqual(ready, ['session-a'])
  gate.dispose('session-a', 'browser-a')
  gate.claim('session-a', 'browser-b', true)
  assert.deepEqual(ready, ['session-a', 'session-a'])
  unsubscribe()
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
  const { event } = gate.claim('s', 'owner', true)
  gate.complete('s', event.id, [], 'owner', 'MVU 加载失败 http://localhost/bundle.js?token=secret-value',
    [{ kind: 'initialization', initializationFailed: true }])
  const result = await pending
  assert.equal(result.initializationFailed, true)
  assert.doesNotMatch(result.error, /secret-value/)
})
