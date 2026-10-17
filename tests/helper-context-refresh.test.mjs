import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
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
function mountFrame() {
  const slots = []
  let cursor = 0
  let effects = []
  let attached = new Map()
  const listeners = new Set()
  const posts = []
  const React = {
    useSyncExternalStore(subscribe, inspect) { return inspect() },
    useLayoutEffect(run, deps) { this.useEffect(run, deps) },
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
      if (!deps || !slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: run() } })
      }
    },
    createElement(type, props, ...children) { return { type, props, children: children.flat() } }
  }
  const client = loadClient(React, {
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener) }
  })
  function render(helperContext, content = '<p>status</p>') {
    cursor = 0
    effects = []
    const panel = client.TavernPersistentStatusRuntime({ sessionId: 'status-test', view: { mode: 'story', tavernHelper: helperContext, tavernStatusViews: [{ viewId: 'panel', content, targetTurn: 1 }] } })
    function findFrame(node) { if (!node || typeof node !== 'object') return; if (node.type === client.TavernMessageFrame) return node; return (node.children || []).map(findFrame).find(Boolean) }
    const tree = client.TavernMessageFrame(findFrame(panel).props)
    const next = new Map()
    function frames(node) { return !node || typeof node !== 'object' ? [] : node.type === 'iframe' ? [node] : (node.children || []).flatMap(frames) }
    for (const element of frames(tree)) {
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

test('stale legacy status replaces only the live iframe, retains old UI until ready, and uses latest variables', () => {
  const host = mountFrame()
  const [old] = host.render(context(1, '未系'))
  assert.ok(old.element.props.srcDoc.includes('<script data-dsh-tavern-status-refresh>'), 'the actual status panel must enable stale-variable refresh')
  host.message(old, 'dsh-tavern-frame-ready')
  host.render(context(2, '已系'))
  host.message(old, 'dsh-tavern-status-stale', {}) // reject wrong sender
  assert.equal(host.render(context(2, '已系')).length, 1)
  host.message(old, 'dsh-tavern-status-stale')
  host.render(context(2, '已系'))
  const [stillVisible, pending] = host.render(context(2, '已系'))
  assert.ok(pending, 'a non-reactive status must be replaced without manual refresh')
  assert.equal(stillVisible.node, old.node)
  assert.equal(pending.element.props['aria-hidden'], true)
  assert.match(pending.element.props.srcDoc, /已系/)
  host.message(old, 'dsh-tavern-status-stale') // coalesce duplicates while loading
  const [, samePending] = host.render(context(2, '已系'))
  assert.equal(samePending.node, pending.node)
  host.message(pending, 'dsh-tavern-frame-ready')
  const [current] = host.render(context(2, '已系'))
  assert.equal(current.node, pending.node)
  host.message(old, 'dsh-tavern-status-stale') // detached sender
  assert.equal(host.render(context(2, '已系')).length, 1)
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
