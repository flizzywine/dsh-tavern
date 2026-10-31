import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const element = (type, props, ...children) => ({ type, props: props || {}, children })
const React = { createElement: element, Fragment: 'Fragment', memo: value => value, forwardRef: value => value, createContext: () => ({}) }
function loadClient() {
  let descriptor
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
  return descriptor.factory(name => name === 'react' ? React : {})
}

test('超出渲染深度的轮次：正文照常显示，卡片 HTML 换成一个「渲染此轮」按钮', () => {
  const client = loadClient()
  const projection = { parts: [
    { kind: 'markdown', text: '正文' },
    { kind: 'html', content: '<div style="color:red">状态栏</div>' },
    { kind: 'html', content: '<div style="color:blue">另一块</div>' },
  ] }
  let clicked = 0
  const deferred = client.renderTavernProjection(projection, { deferHtml: () => { clicked++ } })
  assert.equal(deferred.length, 3)
  assert.notEqual(deferred[0], null, 'prose stays')
  assert.equal(deferred[1].type, 'button')
  assert.deepEqual(deferred[1].children, ['渲染此轮'])
  assert.equal(deferred[2], null, 'one button per round')
  deferred[1].props.onClick()
  assert.equal(clicked, 1)
  const live = client.renderTavernProjection(projection, {})
  assert.ok(live.slice(1).every(part => part && part.type !== 'button'), 'within the depth the HTML renders')
})
