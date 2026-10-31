import assert from 'node:assert/strict'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'
import { JSDOM } from 'jsdom'
import { assembleTavernClient } from '../bin/build-tavern-client.mjs'

// Exercise the actual generated height reporter from current source, without
// rewriting the committed bundle. jsdom supplies DOM/MutationObserver semantics;
// dimensions and ResizeObserver are controlled doubles, not browser layout tests.
let descriptor
vm.runInNewContext(await assembleTavernClient(), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
const client = descriptor.factory(() => ({}))
const html = client.buildTavernFrameDocument({ token: 'root-removal', content: '', runtimeReporting: false })
const reporter = html.match(/<script data-dsh-tavern-frame>([\s\S]*?)<\/script>/)?.[1]
assert.ok(reporter, 'generated content frame contains its height reporter')

function harness(t, { resizeObserver = true, initiallyRootless = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only' })
  const { window } = dom
  const { document } = window
  const reports = [], errors = [], frames = [], mutations = [], resizes = []
  const parent = { postMessage(data) { reports.push(data) } }
  Object.defineProperty(window, 'parent', { value: parent })
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
  window.addEventListener('error', event => { errors.push(event.error); event.preventDefault() })
  const NativeMutationObserver = window.MutationObserver
  window.MutationObserver = class extends NativeMutationObserver {
    constructor(callback) { super(callback); this.targets = new Set(); mutations.push(this) }
    observe(target, options) { super.observe(target, options); this.targets.add(target) }
    disconnect() { super.disconnect(); this.targets.clear() }
  }
  if (resizeObserver) window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); resizes.push(this) }
    observe(target) { assert.ok(target instanceof window.Element); this.targets.add(target) }
    disconnect() { this.targets.clear() }
  }
  t.after(() => { mutations.forEach(observer => observer.disconnect()); window.close() })
  function size(body, height) {
    body.style.margin = '0'
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: height })
    body.getBoundingClientRect = () => ({ top: 0, bottom: height, width: 300, height })
  }
  size(document.body, 120)
  if (initiallyRootless) document.documentElement.remove()
  vm.runInContext(reporter, dom.getInternalVMContext())
  function activate(active = true, options = {}) {
    window.dispatchEvent(new window.MessageEvent('message', {
      source: options.source ?? parent,
      data: { type: 'dsh-tavern-frame-measure-active', token: options.token ?? 'root-removal', active }
    }))
  }
  async function flush() {
    await new Promise(resolve => setImmediate(resolve))
    for (let i = 0; i < 10; i++) {
      for (const callback of frames.splice(0)) callback()
      await new Promise(resolve => setImmediate(resolve))
      if (!frames.length) { assert.deepEqual(errors, []); return }
    }
    assert.fail('height reporting did not settle')
  }
  function replaceRoot(height = 240) {
    const root = document.createElement('html')
    root.append(document.createElement('head'), document.createElement('body'))
    size(root.querySelector('body'), height)
    document.append(root)
    return root
  }
  return { window, document, reports, frames, mutations, resizes, size, activate, flush, replaceRoot }
}

for (const resizeObserver of [true, false]) {
  test(`jsdom: measurement activation tolerates root removal and observes its replacement (ResizeObserver=${resizeObserver})`, async t => {
    const h = harness(t, { resizeObserver })
    await h.flush()
    assert.equal(h.reports.at(-1).height, 120)
    h.activate(false)
    assert.equal(h.mutations[0].targets.size, 0)
    if (resizeObserver) assert.equal(h.resizes[0].targets.size, 0)
    h.document.documentElement.remove()
    h.activate()
    h.activate()
    await h.flush()
    assert.equal(h.reports.length, 1)
    assert.equal(h.mutations[0].targets.size, 0, 'missing root does not install a document-wide watcher')
    assert.equal(h.frames.length, 0)

    const root = h.replaceRoot()
    h.activate()
    await h.flush()
    assert.equal(h.reports.at(-1).height, 240)
    assert.deepEqual([...h.mutations[0].targets], [root])
    h.size(h.document.body, 360)
    h.document.body.append(h.document.createElement('div'))
    await h.flush()
    assert.equal(h.reports.at(-1).height, 360, 'replacement subtree mutations still trigger measurement')

    h.activate(false)
    h.size(h.document.body, 480)
    h.document.body.append(h.document.createElement('div'))
    await h.flush()
    h.activate(true, { token: 'wrong-token' })
    h.activate(true, { source: {} })
    await h.flush()
    assert.equal(h.reports.at(-1).height, 360, 'paused measurement ignores invalid activation messages')
    h.activate()
    await h.flush()
    assert.equal(h.reports.at(-1).height, 480, 'valid reactivation still resumes measurement')
  })
}

test('jsdom: an initially absent root skips both observer types and recovers on activation', async t => {
  const h = harness(t, { initiallyRootless: true })
  await h.flush()
  assert.equal(h.reports.length, 0)
  assert.equal(h.mutations[0].targets.size, 0)
  assert.equal(h.resizes[0].targets.size, 0)
  h.replaceRoot(180)
  h.activate()
  await h.flush()
  assert.equal(h.reports.at(-1).height, 180)
})
