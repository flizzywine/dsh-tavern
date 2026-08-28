import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernHelperEventGate } from '../tavern-plugin/lib/domain/tavern-helper-event-gate.js'

test('Helper event gate skips immediately while no browser runtime is present', async function () {
  const gate = createTavernHelperEventGate()
  assert.deepEqual(await gate.dispatch('session-a', 'MESSAGE_SENT', [2]), { handled: false, args: [2] })
})

test('Helper event gate publishes one event and returns browser mutations', async function () {
  const gate = createTavernHelperEventGate({ timeoutMs: 500 })
  gate.touch('session-a')
  const pending = gate.dispatch('session-a', 'COMMAND_PARSED', [{ value: 1 }, [{ type: 'set' }]], { messages: [] })
  const event = gate.poll('session-a').event
  assert.equal(event.name, 'COMMAND_PARSED')
  assert.deepEqual(event.context, { messages: [] })
  event.args[1].length = 0
  assert.equal(gate.complete('session-a', event.id, event.args), true)
  assert.deepEqual(await pending, { handled: true, args: [{ value: 1 }, []] })
  assert.equal(gate.poll('session-a').event, null)
})

test('Helper event gate times out without blocking later events', async function () {
  let clock = 0
  const gate = createTavernHelperEventGate({ timeoutMs: 100, presenceTtlMs: 1000, now: function () { return clock } })
  gate.touch('session-a')
  const result = await gate.dispatch('session-a', 'MESSAGE_SENT', [3])
  assert.equal(result.handled, false)
  assert.equal(result.timedOut, true)
  clock = 50
  const pending = gate.dispatch('session-a', 'MESSAGE_SENT', [4])
  const event = gate.poll('session-a').event
  gate.complete('session-a', event.id, event.args)
  assert.equal((await pending).handled, true)
})

test('同一会话只允许一个浏览器运行 Helper，租约过期后才能接管', function () {
  let clock = 0
  const gate = createTavernHelperEventGate({ timeoutMs: 100, presenceTtlMs: 1000, now: function () { return clock } })

  assert.deepEqual(gate.poll('session-a', 'browser-a'), { active: true, event: null })
  assert.deepEqual(gate.poll('session-a', 'browser-b'), { active: false, event: null })
  clock = 1001
  assert.deepEqual(gate.poll('session-a', 'browser-b'), { active: true, event: null })
  assert.deepEqual(gate.poll('session-a', 'browser-a'), { active: false, event: null })
})

test('非所有者不能完成事件或释放其他浏览器的执行权', async function () {
  const gate = createTavernHelperEventGate({ timeoutMs: 500 })
  gate.poll('session-a', 'browser-a')
  const pending = gate.dispatch('session-a', 'MESSAGE_SENT', [1])
  const event = gate.poll('session-a', 'browser-a').event

  assert.equal(gate.complete('session-a', event.id, event.args, 'browser-b'), false)
  assert.equal(gate.dispose('session-a', 'browser-b'), false)
  assert.equal(gate.complete('session-a', event.id, event.args, 'browser-a'), true)
  assert.equal((await pending).handled, true)
})
