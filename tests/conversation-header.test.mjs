import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/src/client/features/conversation-header.js', import.meta.url), 'utf8')
test('header owns popup dismissal, saves configured display and releases listeners on unmount', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => { Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); dom.window.close() })
  const saved = [], removed = []
  const remove = dom.window.document.removeEventListener.bind(dom.window.document)
  dom.window.document.removeEventListener = (name, ...args) => { removed.push(name); return remove(name, ...args) }
  const context = vm.createContext({ React, window: dom.window, document: dom.window.document,
    useTavernHeaderCatalog: () => [], useTavernHeaderItems: () => ({ display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] }),
    useTavernMobileHeader: () => true, TAVERN_HEADER_MOBILE_LIMIT: 3,
    tavernHeaderMobileFold: () => [], tavernHeaderMobileCapacity: () => 3,
    displayPreferences: { save: async value => saved.push(value) }, tavernErrorHub: { report: assert.fail },
  })
  vm.runInContext(source, context)
  const { HeaderItems } = context.createTavernHeaderFeature({ StatusAction: () => React.createElement('button', null, '状态'), ExportAction: () => null })
  const root = createRoot(dom.window.document.querySelector('main'))
  await act(async () => root.render(React.createElement(HeaderItems, { sessionId: 'a', sessions: { subagentAddress() {} }, ctx: {} })))
  const item = dom.window.document.querySelector('[data-header-item]')
  await act(async () => item.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 })))
  assert.ok(dom.window.document.querySelector('[role=menu]'))
  const removeButton = [...dom.window.document.querySelectorAll('[role=menuitem]')].find(node => node.textContent === '移除')
  await act(async () => removeButton.click())
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ headerItems: { display: 'icon-text', items: ['header:export'] } }])
  await act(async () => item.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true })))
  await act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(dom.window.document.querySelector('[role=menu]'), null)
  await act(async () => root.unmount())
  assert.ok(removed.includes('pointerdown'))
  assert.ok(removed.includes('keydown'))
})
