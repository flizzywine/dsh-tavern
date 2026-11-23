import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'
import { stubFrameDependencyImports } from './fixtures/frame-dependency-imports.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

function loadClient(React = {}, window = {}) {
  let descriptor
  window.__ModuleLoader__ = { load(value) { descriptor = value } }
  vm.runInNewContext(source, { window, console })
  return descriptor.factory(name => name === 'react' ? React : {})
}

function context(revision, belt) {
  return { version: 1, stateRevision: revision, lifecycleRevision: 1,
    messages: [{ role: 'assistant', variables: { stat_data: { 安全带: belt } } }],
    turnMessageIds: { 1: 0 }, chatVariables: {}, scriptVariables: {} }
}

// Minimal commit-phase harness: on the SAME iframe, React detaches/rebinds a
// callback ref when its identity changes, before running passive effects.

test('snapshot recovery refreshes event-driven MVU view after installing state, including rollback', async () => {
  const client = loadClient()
  const before = context(1, '未系')
  const html = client.buildTavernFrameDocument({ content: '<p>status</p>', token: 'refresh-test', helperContext: before, turn: 1 })
  const shim = html.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1]
  const handlers = {}
  const requests = []
  const parent = { postMessage(data) { requests.push(data) } }
  const sandbox = { parent, console, structuredClone, addEventListener(type, run) { handlers[type] = run } }
  sandbox.window = sandbox
  // Dependency import is unrelated to this transport; use the real shim otherwise.
  vm.runInNewContext(stubFrameDependencyImports(shim), sandbox)
  const displayed = []
  let received = 0
  sandbox.eventOn(sandbox.Mvu.events.VARIABLE_UPDATE_ENDED, () => displayed.push(sandbox.Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data.安全带))
  sandbox.eventOn('MESSAGE_RECEIVED', () => { received++ })
  async function deliver(update) {
    handlers.message({ source: parent, data: { type: 'dsh-tavern-helper-context-update', token: 'refresh-test', update } })
    await new Promise(resolve => setImmediate(resolve))
  }
  await deliver(client.createTavernHelperContextUpdate(before, context(2, '未系'), 1, 1))
  await deliver(client.createTavernHelperContextUpdate(before, context(3, '已系'), 1, 1))
  assert.equal(requests.at(-1).type, 'dsh-tavern-helper-context-request')
  await deliver(client.createTavernHelperContextUpdate(null, context(3, '已系'), 1, 1))
  assert.deepEqual(displayed, ['已系'])
  await deliver(client.createTavernHelperContextUpdate(context(3, '已系'), before, 1, 1))
  assert.deepEqual(displayed, ['已系', '未系'])
  assert.equal(received, 0, 'snapshot must not fabricate a new-message event')
  assert.equal(requests.some(item => item.type === 'dsh-tavern-helper-call'), false, 'read-only refresh must not write variables')
})

// A status panel reads the chat's last floor (message_id -1 / 'latest'). The floors a
// turn adds before its reply is saved carry no variables yet; every reader must keep
// seeing the latest saved floor through generating, failing, regenerating and rollback.
function settled(id, role, name) {
  const variables = { stat_data: { 特工: { 姓名: name } } }
  return { message_id: id, role, message: role + id, swipe_id: 0, swipes: [role + id], swipes_data: [variables], variables }
}
function unsettled(id, role) {
  return { message_id: id, role, message: '', swipe_id: 0, swipes: [''], swipes_data: [], variables: {} }
}
function chat(revision, messages, turnMessageIds) {
  return { version: 1, stateRevision: revision, lifecycleRevision: 1, messages, turnMessageIds, chatVariables: {}, scriptVariables: {} }
}

test('status frames keep the latest saved floor variables while a turn is unsettled', async () => {
  const client = loadClient()
  const saved = [settled(0, 'assistant', '初始'), settled(1, 'user', '初始'), settled(2, 'assistant', '高坂月')]
  const idle = chat(1, saved, { 1: 0, 2: 2 })
  const html = client.buildTavernFrameDocument({ content: '<p>status</p>', token: 'tail-test', helperContext: idle, turn: 2 })
  const shim = html.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1]
  const handlers = {}
  const parent = { postMessage() {} }
  const sandbox = { parent, console, structuredClone, addEventListener(type, run) { handlers[type] = run } }
  sandbox.window = sandbox
  vm.runInNewContext(stubFrameDependencyImports(shim), sandbox)
  const ended = []
  sandbox.eventOn(sandbox.Mvu.events.VARIABLE_UPDATE_ENDED, variables => ended.push(variables.stat_data?.特工?.姓名))
  let current = idle
  async function deliver(next, turn) {
    handlers.message({ source: parent, data: { type: 'dsh-tavern-helper-context-update', token: 'tail-test',
      update: client.createTavernHelperContextUpdate(current, next, 2, turn) } })
    current = next
    await new Promise(resolve => setImmediate(resolve))
  }
  const name = option => sandbox.getVariables(option).stat_data?.特工?.姓名
  const reads = () => [name({ type: 'message', message_id: -1 }), name({ type: 'message', message_id: 'latest' }), name(), sandbox.Mvu.getMvuData({ type: 'message', message_id: -1 }).stat_data?.特工?.姓名]

  // Generating: the player's input and the reply placeholder are the new tail.
  await deliver(chat(2, [...saved, unsettled(3, 'user'), unsettled(4, 'assistant')], { 1: 0, 2: 2, 3: 4 }), 3)
  assert.deepEqual(reads(), ['高坂月', '高坂月', '高坂月', '高坂月'])
  // Failed or cancelled: the placeholder is gone, the input stays without variables.
  await deliver(chat(3, [...saved, unsettled(3, 'user')], { 1: 0, 2: 2 }), 2)
  assert.deepEqual(reads(), ['高坂月', '高坂月', '高坂月', '高坂月'])
  // Regenerating the failed round adds a new placeholder after that input.
  await deliver(chat(4, [...saved, unsettled(3, 'user'), unsettled(4, 'assistant')], { 1: 0, 2: 2, 3: 4 }), 3)
  assert.deepEqual(reads(), ['高坂月', '高坂月', '高坂月', '高坂月'])
  // Saved: the new floor's own variables take over as soon as it has them.
  const next = [...saved, settled(3, 'user', '高坂月'), settled(4, 'assistant', '新名字')]
  await deliver(chat(5, next, { 1: 0, 2: 2, 3: 4 }), 3)
  assert.deepEqual(reads(), ['新名字', '新名字', '新名字', '新名字'])
  // Rolled back to the earlier round.
  await deliver(chat(6, saved, { 1: 0, 2: 2 }), 2)
  assert.deepEqual(reads(), ['高坂月', '高坂月', '高坂月', '高坂月'])
  assert.ok(ended.length > 0 && ended.every(Boolean), 'every MVU update event carried a saved floor: ' + JSON.stringify(ended))

  // A floor in the middle without variables still reads its own (empty) values,
  // and a saved floor whose values are empty stays empty.
  await deliver(chat(7, [settled(0, 'assistant', '初始'), unsettled(1, 'user'), settled(2, 'assistant', '高坂月')], { 1: 0, 2: 2 }), 2)
  assert.deepEqual(sandbox.getVariables({ type: 'message', message_id: 1 }), {})
  const empty = { ...unsettled(3, 'assistant'), swipes_data: [{}] }
  await deliver(chat(8, [...saved, empty], { 1: 0, 2: 2, 3: 3 }), 3)
  assert.deepEqual(sandbox.getVariables({ type: 'message', message_id: -1 }), {})
})

test('MVU update events on an unsettled tail carry the latest saved floor', async () => {
  const client = loadClient()
  const saved = [settled(0, 'assistant', '高坂月')]
  const pending = chat(1, [...saved, unsettled(1, 'user'), unsettled(2, 'assistant')], { 1: 0, 2: 2 })
  const html = client.buildTavernFrameDocument({ content: '<p>status</p>', token: 'tail-event', helperContext: pending, turn: 2 })
  const shim = html.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1]
  const handlers = {}
  const parent = { postMessage() {} }
  const sandbox = { parent, console, structuredClone, addEventListener(type, run) { handlers[type] = run } }
  sandbox.window = sandbox
  vm.runInNewContext(stubFrameDependencyImports(shim), sandbox)
  const ended = []
  sandbox.eventOn(sandbox.Mvu.events.VARIABLE_UPDATE_ENDED, variables => ended.push(variables.stat_data?.特工?.姓名))
  const update = { ...client.createTavernHelperContextUpdate(null, chat(2, pending.messages, pending.turnMessageIds), 2, 2), events: [sandbox.Mvu.events.VARIABLE_UPDATE_ENDED] }
  handlers.message({ source: parent, data: { type: 'dsh-tavern-helper-context-update', token: 'tail-event', update } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(ended, ['高坂月'])
})