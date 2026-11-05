import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
const start = source.indexOf('function TavernMoreActions(')
const component = source.slice(start, source.indexOf('// @include variable-receipt.js', start))

test('Portal menu supports focus, keyboard navigation, outside click and stage scheme', async t => {
  const dom = new JSDOM('<div data-dsh-card-stage-scheme="dark"><div id="root"></div></div><button id="outside">outside</button>')
  const previous = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const root = createRoot(document.getElementById('root'))
  t.after(async () => {
    await act(() => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  })
  const button = (name, disabled = false) => () => React.createElement('button', { disabled }, name)
  const Menu = vm.runInNewContext(component + ';TavernMoreActions', {
    React, ReactDOM, window, document, MutationObserver: window.MutationObserver,
    TavernStopBackgroundAction: button('stop', true), TavernEditBodyAction: button('edit'),
    TavernRollbackAction: button('rollback'), TavernUndoRollbackAction: button('undo'),
    TavernDebugButton: button('debug'), TavernCompactionAction: button('compact')
  })
  await act(() => root.render(React.createElement(Menu, { sessionId: 'game' })))
  const trigger = document.querySelector('[data-fork-action="more"]')
  const key = async value => act(() => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
  trigger.focus()
  await act(() => trigger.click())
  const menu = document.querySelector('[role="menu"]')
  assert.ok(!document.getElementById('root').contains(menu), 'real body portal')
  assert.equal(document.activeElement.textContent, 'edit')
  assert.equal(menu.closest('[data-dsh-card-stage-scheme]')?.getAttribute('data-dsh-card-stage-scheme'), 'dark')
  await key('ArrowDown'); assert.equal(document.activeElement.textContent, 'rollback')
  await key('End'); assert.equal(document.activeElement.textContent, 'compact')
  await key('ArrowDown'); assert.equal(document.activeElement.textContent, 'edit')
  await key('Home'); assert.equal(document.activeElement.textContent, 'edit')
  await key('Escape')
  assert.equal(document.activeElement, trigger)
  assert.equal(document.querySelector('[role="menu"]'), null)
  await act(() => trigger.click())
  await act(() => document.activeElement.click())
  assert.equal(document.activeElement, trigger)
  await act(() => trigger.click())
  await key('Tab')
  assert.equal(document.querySelector('[role="menu"]'), null)
  await act(() => trigger.click())
  const outside = document.getElementById('outside')
  outside.focus()
  await act(() => outside.dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
  assert.equal(document.activeElement, outside)
  assert.equal(document.querySelector('[role="menu"]'), null)
})
