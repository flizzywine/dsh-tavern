import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { fencedSegments } from '../tavern-plugin/lib/domain/html-fenced-segments.js'
import { helperClient as client } from './fixtures/helper-host-harness.mjs'

test('未标语言的代码块按 JS-Slash-Runner 规则：只有完整页面才渲染，<msg> 等协议片段保留为代码块', () => {
  assert.deepEqual(fencedSegments('前文\n```\n<msg>胡伟|顾绒绒|你好|09:00</msg>\n```\n').map(part => part.kind), ['text'])
  assert.deepEqual(fencedSegments('```\n<html><body>面板</body></html>\n```').map(part => part.kind), ['html'])
  assert.deepEqual(fencedSegments('```html\n<div>状态</div>\n```').map(part => part.kind), ['html'])
})

test('脚本拿到消息的静态副本；改写后副本替换原生显示，改写前原生变化会同步到副本', async () => {
  const dom = new JSDOM('<div id=native><p>正文</p><pre>&lt;msg&gt;胡伟|顾绒绒|你好|09:00&lt;/msg&gt;</pre></div><div id=layer data-dsh-script-layer data-session=s data-mesid=3></div>')
  const w = dom.window, native = w.document.getElementById('native'), layer = w.document.getElementById('layer')
  const events = []
  w.addEventListener('dsh-tavern-message-rendered', event => events.push(event.detail))
  const dispose = client.mountTavernScriptLayer({ native, layer, sessionId: 's', messageId: 3 })
  assert.equal(layer.hidden, true); assert.equal(native.hidden, false)
  assert.match(layer.querySelector('pre').textContent, /<msg>/)
  native.querySelector('p').textContent = '着色后的正文'
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(layer.querySelector('p').textContent, '着色后的正文')
  assert.equal(layer.hidden, true, '宿主自己的同步不算脚本改写')
  layer.querySelector('pre').replaceWith(w.document.createElement('div'))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(layer.hidden, false); assert.equal(native.hidden, true)
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(JSON.stringify(events), JSON.stringify([{ sessionId: 's', messageId: 3 }]))
  assert.equal(client.tavernScriptLayers(w.document, 's', 3)[0], layer)
  dispose()
  assert.equal(native.hidden, false); assert.equal(layer.childNodes.length, 0)
  w.close()
})
