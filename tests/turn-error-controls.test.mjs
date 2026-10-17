import assert from 'node:assert/strict'
import test from 'node:test'
import { helperClient as client } from './fixtures/helper-host-harness.mjs'

class Element {
  constructor(text = '') { this.textContent = text; this.hidden = false; this.style = { display: '' }; this.children = []; this.attrs = {} }
  append(...children) { this.children.push(...children) }
  remove() { this.removed = true }
  getAttribute(key) { return this.attrs[key] || null }
  insertAdjacentElement(position, element) { assert.equal(position, 'afterend'); this.panel = element }
}
function setup(text, storage = new Map(), sessionId = 'a', options = {}) {
  const row = new Element(text); row.attrs['data-chat-turn'] = '8'
  const root = { ownerDocument: { createElement() { return new Element() } }, querySelectorAll() { return [row] } }
  const controls = client.createTurnErrorControls(root, { ...options, sessionId, storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } })
  return { row, root, controls }
}

test('已有回退投影的隐藏状态不被恢复按钮撤销', () => {
  const { row, controls } = setup('failure')
  row.hidden = true; row.style.display = 'none'; controls.apply()
  assert.equal(row.panel, undefined)
  row.hidden = false; row.style.display = ''; controls.apply()
  assert.equal(row.style.display, '')
  row.hidden = true; row.style.display = 'none'; controls.apply()
  assert.equal(row.panel.hidden, true)
})
