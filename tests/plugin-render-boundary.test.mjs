import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const fragment = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

test('插件面板与媒体回调抛错时由局部边界接住，正文保持挂载', async t => {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  t.after(async () => {
    if (root) await act(() => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const reports = []
  const context = vm.createContext({ React, DshUi: null, useTavernUiExtensions() {}, tavernPluginAllowed: () => true, tavernErrorHub: { report: (_owner, error) => reports.push(error.message) } })
  vm.runInContext(fragment('let tavernPluginBoundaryClass = null', 'const tavernPluginMediaIndex ='), context)
  const ui = vm.runInContext(fragment('function createTavernUiExtensions()', 'const tavernUiExtensions = createTavernUiExtensions()') + '; createTavernUiExtensions()', context)
  context.tavernUiExtensions = ui
  const Media = vm.runInContext(fragment('function TavernPluginMediaItem(props)', 'function TavernPluginMarker(props)') + '; TavernPluginMediaItem', context)
  let tab
  ui.attachHost({ betterSidebar: { registerTab(input) { tab = input; return () => {} } } })
  ui.service.registerPanel({ id: 'broken', title: 'Broken', render() { throw new Error('panel failed') } })
  ui.service.registerMediaRenderer('example/broken', () => { throw new Error('media failed') })
  const container = document.getElementById('root')
  root = createRoot(container, { onCaughtError() {} })
  await act(() => root.render(React.createElement(React.Fragment, null,
    React.createElement('p', { id: 'story' }, '正文仍在'),
    React.createElement(tab.component, { scope: { sessionId: 'g' } }),
    React.createElement(Media, { sessionId: 'g', turn: 1, item: { id: 'm', kind: 'example/broken' } })
  )))
  assert.equal(container.querySelector('#story').textContent, '正文仍在')
  assert.match(container.querySelector('.dsh-tavern-plugin-panel-error').textContent, /面板出错/)
  assert.deepEqual(reports.sort(), ['media failed', 'panel failed'])
})
