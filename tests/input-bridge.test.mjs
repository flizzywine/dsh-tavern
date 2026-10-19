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
