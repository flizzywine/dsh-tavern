import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernHelperEventGate, TAVERN_HELPER_EVENT_TIMEOUT_MS } from '../tavern-plugin/lib/domain/tavern-helper-event-gate.js'

test('默认等待预算覆盖多个隔离 Helper 脚本的串行事件上限', function () {
  assert.equal(TAVERN_HELPER_EVENT_TIMEOUT_MS, 60000)
})

test('Helper event gate skips immediately while no browser runtime is present', async function () {
  const gate = createTavernHelperEventGate()
  assert.deepEqual(await gate.dispatch('session-a', 'MESSAGE_SENT', [2]), { handled: false, unavailable: true, args: [2] })
})

test('Helper event gate publishes one event and returns browser mutations', async function () {
  const gate = createTavernHelperEventGate({ timeoutMs: 500 })
  gate.touch('session-a', 'legacy', true)
  const pending = gate.dispatch('session-a', 'COMMAND_PARSED', [{ value: 1 }, [{ type: 'set' }]], { messages: [] })
  const event = gate.poll('session-a', 'legacy', true).event
  assert.equal(event.name, 'COMMAND_PARSED')
  assert.deepEqual(event.context, { messages: [] })
  event.args[1].length = 0
  assert.equal(gate.complete('session-a', event.id, event.args), true)
  assert.deepEqual(await pending, { handled: true, args: [{ value: 1 }, []] })
  assert.equal(gate.poll('session-a', 'legacy', true).event, null)
})

test('Helper event gate propagates browser script failure instead of reporting handled', async function () {
  const gate = createTavernHelperEventGate({ timeoutMs: 500 })
  gate.touch('session-a', 'browser-a', true)
  const pending = gate.dispatch('session-a', 'MESSAGE_RECEIVED', [2])
  const event = gate.poll('session-a', 'browser-a', true).event

  assert.equal(gate.complete('session-a', event.id, event.args, 'browser-a', '变量守卫执行超时'), true)
  assert.deepEqual(await pending, { handled: false, error: '变量守卫执行超时', args: [2] })
  assert.equal(gate.poll('session-a', 'browser-a', true).event, null)
})

test('Helper event gate times out without blocking later events', async function () {
  let clock = 0
  const gate = createTavernHelperEventGate({ timeoutMs: 100, presenceTtlMs: 1000, now: function () { return clock } })
  gate.touch('session-a', 'legacy', true)
  const result = await gate.dispatch('session-a', 'MESSAGE_SENT', [3])
  assert.equal(result.handled, false)
  assert.equal(result.timedOut, true)
  clock = 50
  const pending = gate.dispatch('session-a', 'MESSAGE_SENT', [4])
  const event = gate.poll('session-a', 'legacy', true).event
  gate.complete('session-a', event.id, event.args)
  assert.equal((await pending).handled, true)
})

test('同一会话只允许一个浏览器运行 Helper，租约过期后才能接管', function () {
  let clock = 0
  const gate = createTavernHelperEventGate({ timeoutMs: 100, presenceTtlMs: 1000, now: function () { return clock } })

  assert.deepEqual(gate.poll('session-a', 'browser-a'), { active: true, ready: false, event: null })
  assert.deepEqual(gate.poll('session-a', 'browser-b'), { active: false, ready: false, event: null })
  clock = 1001
  assert.deepEqual(gate.poll('session-a', 'browser-b'), { active: true, ready: false, event: null })
  assert.deepEqual(gate.poll('session-a', 'browser-a'), { active: false, ready: false, event: null })
})

test('非所有者不能完成事件或释放其他浏览器的执行权', async function () {
  const gate = createTavernHelperEventGate({ timeoutMs: 500 })
  gate.poll('session-a', 'browser-a', true)
  const pending = gate.dispatch('session-a', 'MESSAGE_SENT', [1])
  const event = gate.poll('session-a', 'browser-a', true).event

  assert.equal(gate.complete('session-a', event.id, event.args, 'browser-b'), false)
  assert.equal(gate.dispose('session-a', 'browser-b'), false)
  assert.equal(gate.complete('session-a', event.id, event.args, 'browser-a'), true)
  assert.equal((await pending).handled, true)
})

test('浏览器取得租约但脚本尚未完成初始化时不会接收结算事件', async function () {
  const gate = createTavernHelperEventGate({ timeoutMs: 500 })
  assert.deepEqual(gate.poll('session-a', 'browser-a', false), { active: true, ready: false, event: null })
  assert.deepEqual(await gate.dispatch('session-a', 'MESSAGE_RECEIVED', [1]), { handled: false, unavailable: true, args: [1] })
  assert.deepEqual(gate.poll('session-a', 'browser-a', true), { active: true, ready: true, event: null })
})

test('执行器只在从未就绪变为就绪时通知接续任务', function () {
  const gate = createTavernHelperEventGate()
  const ready = []
  const unsubscribe = gate.subscribeReady(function (sessionId) { ready.push(sessionId) })
  gate.poll('session-a', 'browser-a', false)
  gate.poll('session-a', 'browser-a', true)
  gate.poll('session-a', 'browser-a', true)
  assert.deepEqual(ready, ['session-a'])
  gate.dispose('session-a', 'browser-a')
  gate.poll('session-a', 'browser-b', true)
  assert.deepEqual(ready, ['session-a', 'session-a'])
  unsubscribe()
})
