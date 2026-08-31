import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

function loadClient(React = {}, window = {}) {
  let descriptor
  window.__ModuleLoader__ = { load(value) { descriptor = value } }
  // Expose the real component only in this VM; production exports stay unchanged.
  vm.runInNewContext(source.replace('exports.apply = apply;', 'exports.FrameForTest = TavernMessageFrame; exports.apply = apply;'), { window, console })
  return descriptor.factory(name => name === 'react' ? React : {})
}

function context(revision, belt) {
  return { version: 1, stateRevision: revision, lifecycleRevision: 1,
    messages: [{ role: 'assistant', variables: { stat_data: { 安全带: belt } } }],
    turnMessageIds: { 1: 0 }, chatVariables: {}, scriptVariables: {} }
}

// Minimal commit-phase harness: on the SAME iframe, React detaches/rebinds a
// callback ref when its identity changes, before running passive effects.
function mountFrame() {
  const slots = []
  let cursor = 0
  let effects = []
  let attached = new Map()
  const listeners = new Set()
  const posts = []
  const React = {
    useRef(value) { return slots[cursor++] ||= { current: value } },
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value }]
    },
    useMemo(run, deps) {
      const index = cursor++
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { deps, value: run() }
      return slots[index].value
    },
    useEffect(run, deps) {
      const index = cursor++
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: run() } })
      }
    },
    createElement(type, props, children) { return { type, props, children } }
  }
  const client = loadClient(React, {
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener) }
  })
  function render(helperContext, content = '<p>status</p>') {
    cursor = 0
    effects = []
    const tree = client.FrameForTest({ content, helperContext, turn: 1, eager: true, persistent: true, observeMvuView: false, runtimeReporting: false })
    const next = new Map()
    for (const element of tree.children.filter(Boolean)) {
      const old = attached.get(element.props.key)
      const node = old?.node || { contentWindow: { postMessage(data) { posts.push(data) } } }
      if (old && old.ref !== element.props.ref) old.ref(null)
      if (!old || old.ref !== element.props.ref) element.props.ref(node)
      next.set(element.props.key, { node, ref: element.props.ref, element })
    }
    for (const [key, entry] of attached) if (!next.has(key)) entry.ref(null)
    attached = next
    effects.forEach(run => run())
    return [...attached.values()]
  }
  return { client, posts, render, message(entry, type, source = entry.node.contentWindow) {
    for (const listener of listeners) listener({ source, data: { type, token: entry.element.props.key } })
  } }
}

test('persistent iframe keeps its incremental baseline through rerenders and consecutive updates', () => {
  const host = mountFrame()
  const [initial] = host.render(context(1, '未系'))
  host.message(initial, 'dsh-tavern-frame-ready')
  const [second] = host.render(context(2, '已系'))
  host.render(context(2, '已系')) // unrelated parent rerender
  const [third] = host.render(context(3, '未系'))
  assert.equal(third.node, initial.node)
  assert.equal(third.element.props.srcDoc, initial.element.props.srcDoc)
  assert.equal(host.posts.length, 2)
  assert.deepEqual(host.posts.map(item => item.update.baseRevision), [1, 2])
  assert.equal(second.ref, initial.ref)
  let state = context(1, '未系')
  for (const { update } of host.posts) state = host.client.applyTavernHelperContextUpdate(state, update).context
  assert.equal(state.messages[0].variables.stat_data.安全带, '未系')
})

test('replacement iframe owns its baseline and detached iframe cannot request resync', () => {
  const host = mountFrame()
  const [old] = host.render(context(1, '未系'))
  host.message(old, 'dsh-tavern-frame-ready')
  host.render(context(2, '已系'), '<p>new template</p>')
  const [, pending] = host.render(context(2, '已系'), '<p>new template</p>')
  host.message(pending, 'dsh-tavern-frame-ready')
  const [current] = host.render(context(2, '已系'), '<p>new template</p>')
  assert.equal(current.node, pending.node)
  host.render(context(3, '未系'), '<p>new template</p>')
  assert.equal(host.posts.at(-1).update.baseRevision, 2)
  const count = host.posts.length
  host.message(old, 'dsh-tavern-helper-context-request')
  assert.equal(host.posts.length, count)
})

test('loading iframe defers updates without advancing its baseline and receives only the latest state on ready', async () => {
  const host = mountFrame()
  const before = context(79, '未系')
  const [frame] = host.render(before)
  host.render(context(80, '调整中'))
  host.render(context(81, '已系'))
  host.message(frame, 'dsh-tavern-frame-ready', {}) // wrong sender cannot mark the frame ready
  assert.equal(host.posts.length, 0, 'nothing may be sent before the receiver is ready')

  // Install the actual Helper listener late, just as with a slow-loading iframe.
  const shim = frame.element.props.srcDoc.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1]
  const handlers = {}
  const requests = []
  const parent = { postMessage(data) { requests.push(data) } }
  const sandbox = { parent, console, structuredClone, addEventListener(type, run) { handlers[type] = run } }
  sandbox.window = sandbox
  vm.runInNewContext(shim.replace(/import\("[^"]+"\)/, 'Promise.resolve({})'), sandbox)
  let displayed = '未系'
  sandbox.eventOn(sandbox.Mvu.events.VARIABLE_UPDATE_ENDED, () => {
    displayed = sandbox.Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data.安全带
  })
  host.message(frame, 'dsh-tavern-frame-ready')
  assert.equal(host.posts.length, 1)
  assert.equal(host.posts[0].update.baseRevision, 79)
  assert.equal(host.posts[0].update.stateRevision, 81)
  handlers.message({ source: parent, data: host.posts[0] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(displayed, '已系', 'the real MVU event listener must render the latest value')
  assert.equal(requests.some(item => item.type === 'dsh-tavern-helper-context-request'), false)

  host.message(frame, 'dsh-tavern-frame-ready')
  host.render(context(81, '已系'))
  assert.equal(host.posts.length, 1, 'duplicate ready/rerender must not replay updates')
  host.render(context(82, '未系'))
  assert.equal(host.posts[1].update.baseRevision, 81)
})

test('replacement iframe waits for its own ready and catches up updates received while loading', () => {
  const host = mountFrame()
  const [old] = host.render(context(1, '未系'))
  host.message(old, 'dsh-tavern-frame-ready')
  host.render(context(2, '调整中'), '<p>new template</p>')
  const [, pending] = host.render(context(2, '调整中'), '<p>new template</p>')
  host.render(context(3, '已系'), '<p>new template</p>')
  assert.equal(host.posts.some(item => item.token === pending.element.props.key), false)
  host.message(pending, 'dsh-tavern-frame-ready')
  const delivered = host.posts.filter(item => item.token === pending.element.props.key)
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].update.baseRevision, 2)
  assert.equal(delivered[0].update.stateRevision, 3)
  const [current] = host.render(context(3, '已系'), '<p>new template</p>')
  assert.equal(current.node, pending.node)
  const count = host.posts.length
  host.message(old, 'dsh-tavern-frame-ready')
  host.message(old, 'dsh-tavern-helper-context-request')
  host.message(current, 'dsh-tavern-frame-ready')
  assert.equal(host.posts.length, count)
  host.render(context(4, '未系'), '<p>new template</p>')
  assert.equal(host.posts.at(-1).update.baseRevision, 3)
})

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
  vm.runInNewContext(shim.replace(/import\("[^"]+"\)/, 'Promise.resolve({})'), sandbox)
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
