import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from './fixtures/client-vm.mjs'

// The host's MarkdownText keeps its streaming parser only while `labels` keeps its
// identity (dsh-client-ui-primitives: `streamLabelsRef.current !== labels` rebuilds
// StreamingRenderer and re-parses the whole reply). A fresh object literal per render
// silently turns every streamed frame into a full markdown parse, so the labels handed
// to it must be stable, shared variants.
const bundle = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const source = readFileSync(new URL('../tavern-plugin/src/client/ui/message-frame.js', import.meta.url), 'utf8')

function labelHelpers() {
  const start = bundle.indexOf('const tavernCodeLabelVariants')
  const end = bundle.indexOf('function renderTavernProjection(')
  assert.ok(start >= 0 && end > start, '构建产物缺少标签变体缓存')
  const context = vm.createContext({})
  vm.runInContext(bundle.slice(start, end) + '\nthis.tavernCodeLabels = tavernCodeLabels; this.tavernMarkdownLabels = tavernMarkdownLabels', context)
  return context
}

test('代码块标签按译文复用同一个对象', () => {
  const context = labelHelpers()
  const translate = key => (key === 'copy' ? '复制' : key === 'copied' ? '已复制' : key)
  const first = context.tavernCodeLabels(translate)
  const second = context.tavernCodeLabels(translate)
  assert.equal(first, second, '相同译文必须复用同一对象')
  assert.deepEqual({ ...first }, { copyLabel: '复制', copiedLabel: '已复制' })
  const english = context.tavernCodeLabels(key => (key === 'copy' ? 'Copy' : 'Copied'))
  assert.notEqual(english, first, '译文变化时换新对象')
  assert.equal(english, context.tavernCodeLabels(key => (key === 'copy' ? 'Copy' : 'Copied')))
})

test('markdown labels 按 codeLabels 复用同一个对象', () => {
  const context = labelHelpers()
  const translate = key => (key === 'copy' ? '复制' : '已复制')
  const codeLabels = context.tavernCodeLabels(translate)
  const first = context.tavernMarkdownLabels(codeLabels)
  const second = context.tavernMarkdownLabels(codeLabels)
  assert.equal(first, second, '每帧新建 labels 会让宿主丢弃流式解析缓存')
  assert.equal(first.code, codeLabels)
  assert.equal(first.footnotes, '脚注')
  assert.notEqual(context.tavernMarkdownLabels(undefined), first)
})

test('正文渲染点不再传 labels 字面量', () => {
  assert.equal((bundle.match(/labels: \{ code:/g) || []).length, 0, '构建产物里仍有每帧新建的 labels 字面量')
  assert.equal((source.match(/labels: \{ code:/g) || []).length, 0, '源码里仍有每帧新建的 labels 字面量')
  const sites = (bundle.match(/labels: tavernMarkdownLabels\(/g) || []).length
  assert.ok(sites >= 3, `正文渲染点应统一走 tavernMarkdownLabels，实际 ${sites} 处`)
  assert.ok(/const codeLabels = (?:input\.codeLabels \|\| )?tavernCodeLabels\(translate\)/.test(bundle), 'codeLabels 未走缓存')
})

// A streaming reply keeps its quote colours live (each streamed commit refreshes them), so there is no streaming
// suspension to check (it was 53c96d280, ae0f16fe3).
