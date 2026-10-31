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
