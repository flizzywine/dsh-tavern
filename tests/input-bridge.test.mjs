import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { helperClient } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('message frame exposes an explicit composer bridge', async () => {
  const html = helperClient.buildTavernFrameDocument({ token: 'input', content: '<p>card</p>', helperContext: { messages: [] } })
  const source = html.match(/<script data-dsh-tavern-input-bridge>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(source)
  const sent = [], listeners = new Map()
  const parent = { postMessage(message) { sent.push(message) } }
  const window = { parent, addEventListener(name, listener) { listeners.set(name, listener) }, console: { error() {} } }
  vm.runInNewContext(source, { window, parent, addEventListener: window.addEventListener, console: { error() {} } })
  assert.equal(typeof window.setTavernInputText, 'function')
  assert.equal(window.TavernHelper.setInput, window.setTavernInputText)
  assert.equal(typeof window.tavernInput.append, 'function')

  const result = window.tavernInput.append('选项文字')
  const call = sent.find(message => message.method === 'setTavernHelperInput')
  assert.ok(call)
  assert.deepEqual({ ...call.args }, { text: '选项文字', mode: 'append' })
  listeners.get('message')({ source: parent, data: { token: 'input', type: 'dsh-tavern-helper-response', requestId: call.requestId, ok: true, result: { drafted: true } } })
  assert.deepEqual({ ...await result }, { drafted: true })
})

test('trusted host composer mirrors the draft and fills on input', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const doc = dom.window.document
  let draft = '已有内容'
  let push = null
  const fills = [], errors = []
  const release = helperClient.installFrameHostComposer(doc, () => true,
    () => Promise.resolve(), error => errors.push(error),
    text => { fills.push(text); return Promise.resolve() },
    () => draft,
    handler => { push = handler; return () => { push = null } })
  try {
    const area = doc.getElementById('send_textarea')
    assert.ok(area)
    assert.ok(doc.getElementById('send_but'))
    const controls = area.parentElement
    assert.equal(controls.hasAttribute('hidden'), false)
    assert.match(controls.getAttribute('style'), /left:-10000px/)
    area.focus()
    assert.equal(area.value, '已有内容')
    assert.equal(typeof push, 'function')
    push('玩家新输入')
    assert.equal(area.value, '玩家新输入')
    // Native regex sequence: focus, read, append, fire input.
    const current = area.value
    area.value = current + (current.trim() ? '\n' : '') + '选项文字'
    area.dispatchEvent(new dom.window.Event('input'))
    await tick()
    assert.deepEqual(fills, ['玩家新输入\n选项文字'])
    assert.deepEqual(errors, [])
  } finally {
    release()
  }
  assert.equal(doc.getElementById('send_textarea'), null)
})
