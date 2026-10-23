import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sourceFunction } from './fixtures/source-function.mjs'

// The compatibility window hands card scripts proxies of host nodes. Chrome
// rejects those in WebIDL APIs with "parameter 1 is not of type 'Node'", which
// used to kill whole card scripts (進境結算 observes #pBody's parent body).
const composerSource = readFileSync(new URL('../tavern-plugin/src/client/legacy-composer.js', import.meta.url), 'utf8')
const installSource = sourceFunction(composerSource, 'installTavernNodeCompatibility')

async function sandbox() {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<body><main></main><iframe></iframe></body>', { runScripts: 'outside-only' })
  dom.window.eval(composerSource + ';window.makeWindow=createTavernComposerWindow')
  const element = dom.window.document.querySelector('iframe')
  const view = dom.window.makeWindow(element.contentWindow, dom.window)
  return { dom, element, view }
}

test('兼容窗口交出的宿主节点在进入原生观察器前解包', async () => {
  const { dom, element, view } = await sandbox()
  try {
    class RecordingObserver {
      constructor(callback) { this.callback = callback; this.targets = [] }
      observe(target, options) { this.targets.push(target); this.options = options }
      disconnect() {}
      takeRecords() { return [] }
    }
    element.contentWindow.MutationObserver = RecordingObserver
    element.contentWindow.eval(installSource + ';installTavernNodeCompatibility(window)')

    const proxy = view.parent.document.body
    assert.notEqual(proxy, dom.window.document.body)
    const observer = new element.contentWindow.MutationObserver(() => {})
    observer.observe(proxy, { childList: true, subtree: true })
    assert.equal(observer.targets.length, 1)
    assert.equal(observer.targets[0], dom.window.document.body)
    assert.deepEqual(observer.options, { childList: true, subtree: true })
    assert.ok(observer instanceof element.contentWindow.MutationObserver)
    assert.equal(element.contentWindow.MutationObserver.__dshTavernNodeCompatible, true)

    // A script that observes something its document does not own still keeps
    // running: retarget to the document root instead of throwing.
    const fallback = new element.contentWindow.MutationObserver(() => {})
    fallback.observe({ not: 'a node' }, { childList: true })
    assert.equal(fallback.targets.length, 1)
    assert.equal(fallback.targets[0], element.contentWindow.document.documentElement)

    // jQuery collections and array-likes observe each element they contain.
    const collection = new element.contentWindow.MutationObserver(() => {})
    collection.observe({ jquery: '3.7.1', toArray: () => [dom.window.document.body, dom.window.document.head] }, { childList: true })
    assert.deepEqual(collection.targets, [dom.window.document.body, dom.window.document.head])
  } finally {
    dom.window.close()
  }
})

test('真实观察器在兼容层之后仍收到宿主节点变更', async () => {
  const { dom, element, view } = await sandbox()
  try {
    element.contentWindow.eval(installSource + ';installTavernNodeCompatibility(window)')
    let hits = 0
    const observer = new element.contentWindow.MutationObserver(() => { hits += 1 })
    observer.observe(view.parent.document.body, { childList: true, subtree: true })
    const added = dom.window.document.createElement('div')
    added.id = 'compat-probe'
    dom.window.document.body.append(added)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(hits > 0)
    observer.disconnect()
  } finally {
    dom.window.close()
  }
})
