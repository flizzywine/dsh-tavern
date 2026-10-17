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
test('长错误默认收起，可展开、单独隐藏和恢复，原始文本不变', () => {
  const text = '400: message content cannot be empty ' + 'PRIVATE'.repeat(200)
  const { row, controls } = setup(text)
  controls.apply()
  assert.equal(row.style.display, 'none')
  assert.match(row.panel.children[0].textContent, /消息内容不能为空/)
  row.panel.children[1].onclick()
  assert.equal(row.style.display, '')
  row.panel.children[2].onclick()
  assert.equal(row.style.display, 'none')
  assert.equal(row.panel.children[2].textContent, '恢复错误提示')
  row.panel.children[2].onclick()
  assert.equal(row.style.display, '')
  assert.equal(row.textContent, text)
  controls.dispose()
  assert.equal(row.style.display, '')
  assert.equal(row.panel.removed, true)
})

test('已有回退投影的隐藏状态不被恢复按钮撤销', () => {
  const { row, controls } = setup('failure')
  row.hidden = true; row.style.display = 'none'; controls.apply()
  assert.equal(row.panel, undefined)
  row.hidden = false; row.style.display = ''; controls.apply()
  assert.equal(row.style.display, '')
  row.hidden = true; row.style.display = 'none'; controls.apply()
  assert.equal(row.panel.hidden, true)
})
