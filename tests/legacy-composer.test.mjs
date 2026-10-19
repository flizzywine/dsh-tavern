import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { helperClient } from './fixtures/helper-host-harness.mjs'

function mount(send, managed = false, extra = {}) {
  const nodes = []
  function element() {
    return { value: '', append(...items) { nodes.push(...items) }, setAttribute() {}, addEventListener(name, fn) { this[name] = fn } }
  }
  const document = { body: element(), createElement: element, getElementById(id) { return nodes.find(n => n.id === id) } }
  const html = helperClient.buildTavernFrameDocument({ token: 'send', content: '<p>opening</p>', helperContext: { messages: [] } })
  const source = html.match(/<script data-dsh-tavern-legacy-composer>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(source)
  vm.runInNewContext(source, { document, window: Object.assign(managed ? { submitTavernInput: send } : { triggerSlash: send }, extra), console: { error() {} } })
  return { nodes, area: document.getElementById('send_textarea'), button: document.getElementById('send_but') }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('failed legacy send retains payload, displays failure and permits retry', async () => {
  const { nodes, area, button } = mount(() => Promise.reject(new Error('发送失败')))
  area.value = '开始故事'; button.click(); await tick()
  assert.equal(area.value, '开始故事')
  assert.equal(button.disabled, false)
  assert.ok(nodes.some(n => /开局消息发送失败/.test(n.textContent)))
})

test('legacy textarea input fills the host composer through the bridge', async () => {
  const filled = []
  const { area } = mount(() => Promise.resolve(), false, {
    setTavernInputText(text, options) { filled.push([text, options]); return Promise.resolve() }
  })
  area.value = '梦境选项一'
  area.input()
  await tick()
  assert.deepEqual(filled.map(([text, options]) => [text, { ...options }]), [['梦境选项一', { mode: 'replace' }]])
})

test('legacy textarea falls back to /setinput when no composer bridge exists', async () => {
  const lines = []
  const { area } = mount(line => { lines.push(line); return Promise.resolve() })
  area.value = '旧写法'
  area.input()
  await tick()
  assert.deepEqual(lines, ['/setinput 旧写法'])
})
