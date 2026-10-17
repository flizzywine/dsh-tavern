import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { stubFrameDependencyImports } from './fixtures/frame-dependency-imports.mjs'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }
})
const client = descriptor.factory(() => ({}))
function frame(persistent = true, clock = { now: 0 }) {
  let state = { version: 1, stateRevision: 1, chatVariables: {}, messages: [{ variables: {} }], turnMessageIds: { 1: 0 } }
  const html = client.buildTavernFrameDocument({ content: '', token: 'test', turn: 1, helperContext: state, persistent, observeMvuView: false, runtimeReporting: false })
  const messages = [], listeners = [], timers = new Map()
  let timerId = 0
  const parent = { postMessage(data) { messages.push(data) } }
  const context = { parent, console, structuredClone, Date: { now: () => clock.now },
    document: { addEventListener(type, run) { this[type] = run } },
    addEventListener(type, run) { if (type === 'message') listeners.push(run) },
    setTimeout(run) { timers.set(++timerId, run); return timerId }, clearTimeout(id) { timers.delete(id) } }
  context.window = context
  vm.createContext(context)
  for (const match of html.matchAll(/<script data-dsh-tavern-(?:helper|frame-variable-aliases|status-refresh)>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(stubFrameDependencyImports(match[1]), context)
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

test('a card that polls the same data by itself (10s) is never reloaded; render-burst re-reads still are', async () => {
  const clock = { now: 0 }
  const polling = frame(true, clock)
  polling.context.getAllVariables()
  clock.now = 10000
  polling.context.getAllVariables()
  await polling.update({ stat_data: { 地点: '山门' } })
  polling.flush()
  assert.equal(polling.reloads, 0)
  const burst = frame(true, { now: 0 })
  burst.context.getAllVariables()
  burst.context.getAllVariables()
  await burst.update({ stat_data: { 地点: '山门' } })
  burst.flush()
  assert.equal(burst.reloads, 1)
})
