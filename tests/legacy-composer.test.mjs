import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { helperClient } from './fixtures/helper-host-harness.mjs'

function mount(send) {
  const nodes = []
  function element() {
    return { value: '', append(...items) { nodes.push(...items) }, setAttribute() {}, addEventListener(name, fn) { this[name] = fn } }
  }
  const document = { body: element(), createElement: element, getElementById(id) { return nodes.find(n => n.id === id) } }
  const html = helperClient.buildTavernFrameDocument({ token: 'send', content: '<p>opening</p>', helperContext: { messages: [] } })
  const source = html.match(/<script data-dsh-tavern-legacy-composer>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(source)
  vm.runInNewContext(source, { document, window: { triggerSlash: send }, console: { error() {} } })
  return { nodes, area: document.getElementById('send_textarea'), button: document.getElementById('send_but') }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('legacy DOM send preserves multiline payload and prevents duplicate submission', async () => {
  const calls = []; let finish
  const { area, button } = mount(line => { calls.push(line); return new Promise(resolve => { finish = resolve }) })
  area.value = '请开始故事\n{"name":"林州","value":"a|b"}'
  button.click(); button.click()
  await tick()
  assert.deepEqual(calls, ['/send ' + area.value + '|/trigger'])
  assert.equal(button.disabled, true)
  finish({ submitted: true }); await tick()
  assert.equal(area.value, '')
  assert.equal(button.disabled, false)
})

test('failed legacy send retains payload, displays failure and permits retry', async () => {
  const { nodes, area, button } = mount(() => Promise.reject(new Error('发送失败')))
  area.value = '开始故事'; button.click(); await tick()
  assert.equal(area.value, '开始故事')
  assert.equal(button.disabled, false)
  assert.ok(nodes.some(n => /开局消息发送失败/.test(n.textContent)))
})

test('preparation composer owns parent controls, submits once and ignores detached controls', async () => {
  const nodes = [], calls = []; let finish
  function element() { return { value: '', append(...items) { nodes.push(...items) }, remove() { this.removed = true }, addEventListener(name, fn) { this[name] = fn } } }
  const document = { body: element(), createElement: element, getElementById: id => nodes.find(n => n.id === id) }
  const release = helperClient.installOpeningHostComposer(document, text => { calls.push(text); return new Promise(resolve => { finish = resolve }) }, assert.fail)
  const area = document.getElementById('send_textarea'), button = document.getElementById('send_but')
  area.value = '建立角色\n名字：旅人 | 中立'; button.click(); button.click(); await tick()
  assert.deepEqual(calls, [area.value])
  finish(); await tick(); button.click(); await tick()
  assert.equal(calls.length, 1)
  release(); area.value = '过期开场'; button.click(); await tick()
  assert.equal(calls.length, 1)
})
