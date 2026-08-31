import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }
})
const client = descriptor.factory(() => ({}))
function frame(persistent = true) {
  let state = { version: 1, stateRevision: 1, chatVariables: {}, messages: [{ variables: {} }], turnMessageIds: { 1: 0 } }
  const html = client.buildTavernFrameDocument({ content: '', token: 'test', turn: 1, helperContext: state, persistent, observeMvuView: false, runtimeReporting: false })
  const messages = [], listeners = [], timers = new Map()
  let timerId = 0
  const parent = { postMessage(data) { messages.push(data) } }
  const context = { parent, console, structuredClone,
    addEventListener(type, run) { if (type === 'message') listeners.push(run) },
    setTimeout(run) { timers.set(++timerId, run); return timerId }, clearTimeout(id) { timers.delete(id) } }
  context.window = context
  vm.createContext(context)
  for (const match of html.matchAll(/<script data-dsh-tavern-(?:helper|frame-variable-aliases|status-refresh)>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(match[1].replace(/import\("[^"]+"\)/, 'Promise.resolve({})'), context)
  }
  return { context, messages, async update(variables, turn = 1, sender = parent) {
    const next = structuredClone(state)
    next.stateRevision++
    if (turn === 1) next.messages[0].variables = variables
    else { next.messages[1] = { variables }; next.turnMessageIds[turn] = 1 }
    const data = { type: 'dsh-tavern-helper-context-update', token: 'test', update: client.createTavernHelperContextUpdate(null, next, 1, turn) }
    for (const run of listeners) run({ source: sender, data })
    if (sender === parent) state = next
    await new Promise(resolve => setImmediate(resolve))
  }, flush() { const runs = [...timers.values()]; timers.clear(); runs.forEach(run => run()) },
  get reloads() { return messages.filter(x => x.type === 'dsh-tavern-status-stale').length } }
}

test('read-once legacy status requests refresh when initial variables arrive; duplicate updates coalesce', async () => {
  const run = frame()
  assert.equal(run.context.getAllVariables().stat_data, undefined)
  await run.update({ stat_data: { 地点: '山门' } })
  await run.update({ stat_data: { 地点: '庭院' } })
  run.flush()
  assert.equal(run.reloads, 1)
  await run.update({ stat_data: { 地点: '大殿' } })
  run.flush()
  assert.equal(run.reloads, 1, 'one request per document')
})

test('event-driven and polling cards that reread current variables do not reload', async () => {
  for (const events of [true, false]) {
    const run = frame()
    run.context.getAllVariables()
    if (events) run.context.eventOn('mag_variable_update_ended', () => run.context.getAllVariables())
    await run.update({ stat_data: { 地点: '山门' } })
    if (!events) run.context.getAllVariables() // existing card poll during grace period
    run.flush()
    assert.equal(run.reloads, 0)
  }
})

test('listeners can render the event payload without another API read; removing the listener restores fallback', async () => {
  const run = frame()
  run.context.getAllVariables()
  let place
  const render = data => { place = data.stat_data.地点 }
  run.context.eventOn('mag_variable_update_ended', render)
  await run.update({ stat_data: { 地点: '山门' } })
  run.flush()
  assert.equal(place, '山门')
  assert.equal(run.reloads, 0)
  run.context.eventOff('mag_variable_update_ended', render)
  await run.update({ stat_data: { 地点: '庭院' } })
  run.flush()
  assert.equal(run.reloads, 1)
})

test('unchanged data, non-status frames, forged messages, and frames without reads do not reload', async () => {
  const unchanged = frame(); unchanged.context.getAllVariables(); await unchanged.update({}); unchanged.flush()
  assert.equal(unchanged.reloads, 0)
  const historical = frame(false); historical.context.getAllVariables(); await historical.update({ stat_data: {} }); historical.flush()
  assert.equal(historical.reloads, 0)
  const forged = frame(); forged.context.getAllVariables(); await forged.update({ stat_data: {} }, 1, {}); forged.flush()
  assert.equal(forged.reloads, 0)
  const unread = frame(); await unread.update({ stat_data: {} }); unread.flush()
  assert.equal(unread.reloads, 0)
})

test('following the latest turn detects stale read-once data, but updated readers stay mounted', async () => {
  for (const reread of [false, true]) {
    const run = frame()
    run.context.getAllVariables()
    await run.update({ stat_data: { 地点: '山门' } }, 2)
    if (reread) run.context.getAllVariables()
    run.flush()
    assert.equal(run.reloads, reread ? 0 : 1)
  }
})

test('a status performing Helper writes is not automatically replayed', async () => {
  const run = frame()
  run.context.getAllVariables()
  void run.context.replaceVariables({ stat_data: { 地点: '山门' } })
  await run.update({ stat_data: { 地点: '庭院' } })
  run.flush()
  assert.equal(run.reloads, 0)
})
