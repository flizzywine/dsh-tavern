import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/src/client/html-sketch.js', import.meta.url), 'utf8')
const { split, documentOf } = new Function(source.slice(0, source.indexOf('function TavernHtmlSketch(')) + ';return {split:splitTavernHtmlSketches,documentOf:tavernSketchDocument}')()

test('卡片工作台只把闭合的 html 围栏拆成草图，其余保持 Markdown', () => {
  const text = '风格 A：\n```html\n<div class="a">雨夜</div>\n```\n风格 B 用 css：\n```css\n.a{}\n```\n```html\n<b>未闭合'
  assert.deepEqual(split(text), [
    { kind: 'markdown', text: '风格 A：\n' },
    { kind: 'sketch', html: '<div class="a">雨夜</div>' },
    { kind: 'markdown', text: '\n风格 B 用 css：\n```css\n.a{}\n```\n```html\n<b>未闭合' }
  ])
  assert.deepEqual(split('无草图'), [{ kind: 'markdown', text: '无草图' }])
})

test('草图文档禁用脚本与外部资源', () => {
  const html = documentOf('<script>alert(1)</script>')
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"/)
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'))
})
