import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { helperClient } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('trusted host composer reads the draft on focus and fills on input', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const doc = dom.window.document
  const draft = '已有内容'
  const fills = [], errors = []
  const release = helperClient.installFrameHostComposer(doc, () => true,
    () => Promise.resolve(), error => errors.push(error),
    text => { fills.push(text); return Promise.resolve() },
    () => draft)
  try {
    const area = doc.getElementById('send_textarea')
    assert.ok(area)
    assert.ok(doc.getElementById('send_but'))
    const controls = area.parentElement
    assert.equal(controls.hasAttribute('hidden'), false)
    assert.match(controls.getAttribute('style'), /left:-10000px/)
    assert.equal(area.getAttribute('inputmode'), 'none', '屏幕外输入框被聚焦时不弹出手机键盘')
    area.focus()
    assert.equal(area.value, '已有内容')
    // Native regex sequence: focus, read, append, fire input.
    const current = area.value
    area.value = current + (current.trim() ? '\n' : '') + '选项文字'
    area.dispatchEvent(new dom.window.Event('input'))
    await tick()
    assert.deepEqual(fills, ['已有内容\n选项文字'])
    assert.deepEqual(errors, [])
  } finally {
    release()
  }
  assert.equal(doc.getElementById('send_textarea'), null)
})

test('multiple mounted cards still fill the shared draft from a native option click', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const doc = dom.window.document
  const first = [], second = [], errors = []
  const releaseFirst = helperClient.installFrameHostComposer(doc, () => false,
    () => Promise.resolve(), error => errors.push(error),
    text => { first.push(text); return Promise.resolve() },
    () => '')
  const releaseSecond = helperClient.installFrameHostComposer(doc, () => false,
    () => Promise.resolve(), error => errors.push(error),
    text => { second.push(text); return Promise.resolve() },
    () => '')
  try {
    // The native script focuses the offscreen textarea before the host sees the
    // iframe focus, so no owner is focused when the input event arrives.
    const area = doc.getElementById('send_textarea')
    area.value = '选项文字'
    area.dispatchEvent(new dom.window.Event('input'))
    await tick()
    assert.deepEqual([...first, ...second], ['选项文字'])
    assert.deepEqual(errors, [])
  } finally {
    releaseFirst()
    releaseSecond()
  }
  assert.equal(doc.getElementById('send_textarea'), null)
})

test('story message frame commits a native input/change pair once without replacing its document', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
  dom.window.TextEncoder = TextEncoder
  dom.window.TextDecoder = TextDecoder
  const fills = []
  const executeSlash = (line, sessionId) => { fills.push({ line, sessionId }); return Promise.resolve({ drafted: true }) }
  const props = { sessionId: 'story-session', content: '<div>顶部渲染</div><button>尾部选项</button>', turn: 2,
    trustedCardMode: true, executeSlash }
  const lifecycle = helperClient.createTavernMessageFrameLifecycle(props, { window: dom.window, rpc: async () => ({}) })
  const before = lifecycle.snapshot().visibleDocument
  const stop = lifecycle.start(() => {})
  try {
    const area = dom.window.document.getElementById('send_textarea')
    area.value = '选择尾部选项'
    area.dispatchEvent(new dom.window.Event('input'))
    area.dispatchEvent(new dom.window.Event('change'))
    await tick()
    assert.deepEqual(fills, [{ line: '/setinput 选择尾部选项', sessionId: 'story-session' }])
    assert.strictEqual(lifecycle.snapshot().visibleDocument, before, '填写草稿不得替换尾部 iframe 文档')
    lifecycle.update({ ...props })
    assert.strictEqual(lifecycle.snapshot().visibleDocument, before, '父级因草稿重渲染也不得替换尾部 iframe 文档')
  } finally {
    stop()
    dom.window.close()
  }
})
