// The opening floor of a card played on the stage (it declares a page shown on entering the stage, e.g. a title page)
// carries a 进入舞台 bar, so a blank text-mode opening never reads as broken; other cards keep their opening as it is.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React, {act} from 'react'
import * as ReactDOM from 'react-dom'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require = createRequire(import.meta.url)
const {createStageViews} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/views.cjs')
function signal(value) { const listeners = new Set(); return {get: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, set(next) { value = next; for (const fn of listeners) fn() }} }

async function render(pages, enabled = true) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'https://example.test'}), {window} = dom, document = window.document
  const before = {window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis, {window, document, IS_REACT_ACT_ENVIRONMENT: true})
  const active = signal('')
  const navigation = {galStageAvailable: signal(true), galActive: active, galMenuRequest: {request() {}}, galEscapeLock() {}, galEnter: id => active.set(id),
    galCoverChat() {}, galUncover() {}, galLeave() {}, galLeaveNow() {}}
  const views = createStageViews({React, ReactDOM, window, document, navigation, GalStage: () => null, Icon: () => null, useGalEntryLoader: () => 'ready',
    useBubbles: () => ({cardPath: 'card', config: {enabled}}), usePages: () => pages})
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(views.OpeningEntry, {sessionId: 's'})))
  return {document, active, close() { views.dispose(); act(() => root.unmount()); window.close(); Object.assign(globalThis, {window: before.window, document: before.document, IS_REACT_ACT_ENVIRONMENT: before.act}) }}
}

test('a card with a stage title page: the opening floor enters the stage', async () => {
  const view = await render({pages: [{id: 'title', showOn: {event: 'stage-enter'}}, {id: 'map', shortcut: 'm'}], fresh: true})
  try {
    const bar = view.document.querySelector('.fork-gal-opening-entry')
    assert.ok(bar)
    const button = bar.querySelector('button')
    assert.equal(button.textContent, '进入舞台')
    await act(async () => button.click())
    assert.equal(view.active.get(), 's')
    assert.equal(view.document.querySelector('.fork-gal-opening-entry'), null, 'gone while the stage is on')
  } finally { view.close() }
})

test('no bar without a stage-enter page, while the pages read, or with the stage off for the card', async () => {
  for (const [pages, enabled] of [[{pages: [{id: 'map', shortcut: 'm'}], fresh: true}, true], [null, true], [undefined, true],
    [{pages: [{id: 'title', showOn: {event: 'stage-enter'}}], fresh: true}, false]]) {
    const view = await render(pages, enabled)
    try { assert.equal(view.document.querySelector('.fork-gal-opening-entry'), null) } finally { view.close() }
  }
})
