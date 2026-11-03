import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from 'jsdom'

const source = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

function open() {
  const dom = new JSDOM('<button id="trigger">⤢</button><div id="home"><iframe style="height:180px"></iframe></div>', {runScripts: 'outside-only'})
  const win = dom.window
  win.eval(source('inline-field.js') + '\n' + source('ui/frame-sheet.js') + '\nwindow.openTavernFrameSheet = openTavernFrameSheet;')
  const frame = win.document.querySelector('iframe')
  win.document.getElementById('trigger').focus()
  win.openTavernFrameSheet(frame, {title: 'MVU 状态'})
  return {win, frame, doc: win.document}
}
function assertClosed({doc, frame}) {
  assert.equal(doc.querySelector('.dsh-tavern-frame-sheet'), null)
  assert.equal(frame.hasAttribute('data-dsh-tavern-expanded'), false)
  assert.equal(frame.getAttribute('style'), 'height:180px')
  assert.equal(frame.parentNode.id, 'home', 'the live frame never moves')
  assert.equal(doc.activeElement.id, 'trigger')
}

test('the expanded frame opens in a titled sheet with a focused 关闭 button', () => {
  const view = open()
  const sheet = view.doc.querySelector('.dsh-tavern-frame-sheet[role=dialog]')
  assert.equal(sheet.getAttribute('aria-label'), 'MVU 状态')
  assert.equal(sheet.querySelector('h2').textContent, 'MVU 状态')
  assert.equal(view.doc.activeElement.textContent, '关闭')
  assert.equal(view.frame.parentNode.id, 'home')
  assert.equal(view.frame.style.getPropertyValue('position'), 'fixed')
  view.win.close()
})

test('关闭, Esc and a press on the dimmed page each close the sheet', () => {
  for (const exit of [
    ({doc}) => doc.querySelector('.dsh-tavern-frame-sheet button').click(),
    ({doc, win}) => doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', {key: 'Escape', bubbles: true})),
    ({doc, win}) => doc.querySelector('.dsh-tavern-frame-sheet-scrim').dispatchEvent(new win.Event('pointerdown', {bubbles: true}))
  ]) {
    const view = open()
    exit(view)
    assertClosed(view)
    view.win.close()
  }
})

test('a press inside the sheet keeps it open', () => {
  const view = open()
  view.doc.querySelector('.dsh-tavern-frame-sheet h2').dispatchEvent(new view.win.Event('pointerdown', {bubbles: true}))
  assert.ok(view.doc.querySelector('.dsh-tavern-frame-sheet'))
  view.win.close()
})
