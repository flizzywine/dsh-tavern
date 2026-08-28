import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

async function loadPreviewBuilder() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { descriptor = value } } },
    console
  }
  vm.runInNewContext(source, sandbox)
  const client = descriptor.factory(function () { return {} })
  return client.buildOpeningPreviewDocument
}

const buildOpeningPreviewDocument = await loadPreviewBuilder()

test('HTML 开场白在隔离文档中保持原始 UI 并缓存外部静态资源', () => {
  const opening = `<div style="text-align:center;background-image:url('https://files.catbox.moe/zle6vq.gif')">
<img src="https://files.catbox.moe/ykgazx.png" width="30%">
<a href="https://example.com">查看更新</a>
</div>`
  const document = buildOpeningPreviewDocument(opening)

  assert.match(document, /<!doctype html>/)
  assert.match(document, /static-assets\?url=https%3A%2F%2Ffiles\.catbox\.moe%2Fzle6vq\.gif/)
  assert.match(document, /static-assets\?url=https%3A%2F%2Ffiles\.catbox\.moe%2Fykgazx\.png/)
  assert.match(document, /data-dsh-tavern-static-cache/)
  assert.match(document, /img-src https: http: data: blob:/)
  assert.match(document, /style-src 'unsafe-inline' https: http:/)
  assert.match(document, /script-src 'unsafe-inline' 'unsafe-eval' https: http: data: blob:/)
  assert.match(document, /connect-src https: http: ws: wss: data: blob:/)
  assert.match(document, /<base target="_blank">/)
  assert.doesNotMatch(document, /&lt;div/)
})

test('纯文本开场白转义后保持换行，不会被当作 HTML', () => {
  const document = buildOpeningPreviewDocument('第一行\n1 < 2 & 3 > 2')

  assert.match(document, /class="dsh-tavern-greeting-text"/)
  assert.match(document, /第一行\n1 &lt; 2 &amp; 3 &gt; 2/)
})

test('混合开场白保留普通文本节点的换行，不改写自带 HTML', () => {
  const opening = `第一段。\n\n第二段。
<style>.status{color:red}</style><div class="status">状态面板</div>`
  const document = buildOpeningPreviewDocument(opening)

  assert.match(document, /data-dsh-preserve-lines/)
  assert.match(document, /第一段。\n\n第二段。/)
  assert.match(document, /<style>\.status\{color:red\}<\/style><div class="status">状态面板<\/div>/)
})
