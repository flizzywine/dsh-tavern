import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function TavernMvuReceipt(props)')
const end = source.indexOf('function htmlPartHasPresentation(', start)
assert.ok(start >= 0 && end > start)
const sandbox = vm.createContext({ React: {
  createElement(type, props, ...children) { return { type, props, children } },
  useState(value) { return [value, () => {}] }
} })
vm.runInContext(source.slice(start, end), sandbox)

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  return typeof node === 'object' ? textOf(node.children) : String(node)
}

const change = path => ({ operation: 'set', path, before: '旧值', after: '新值' })
const internal = [
  change('/delta_data/航班'), change('/display_data/航班/安全带'),
  change('/schema/properties/人物/properties/祈婉琳'),
  change('/delta_data'), change('/display_data'), change('/schema')
]

test('更新记录只展示真实变量及脚本联动，过滤内部记录并保留原始 receipt', () => {
  const receipt = { status: 'updated', changes: [change('/stat_data/航班/安全带')],
    sideEffects: [...internal, change('/stat_data/航班/阶段')], failures: [] }
  const before = structuredClone(receipt)
  const text = textOf(sandbox.TavernMvuReceipt({ receipt }))
  assert.doesNotMatch(text, /\/delta_data|\/display_data|\/schema/)
  assert.match(text, /变量已更新 · 1 项 · 人物卡联动 1 项/)
  assert.match(text, /\/stat_data\/航班\/安全带/)
  assert.match(text, /人物卡脚本联动/)
  assert.match(text, /\/stat_data\/航班\/阶段/)
  assert.deepEqual(receipt, before)
})

test('只有内部变化时不展示联动标题或计数', () => {
  const node = sandbox.TavernMvuReceipt({ receipt: { status: 'unchanged', sideEffects: internal } })
  const text = textOf(node)
  assert.equal(node.type, 'div')
  assert.match(text, /本轮变量未更新/)
  assert.doesNotMatch(text, /联动|delta_data|display_data|schema/)
})

test('只过滤顶层保留字段，不误删同名业务变量或失败详情', () => {
  const receipt = { status: 'partial', changes: [change('/stat_data/位置')], sideEffects: [
    ...internal, change('/stat_data/display_data'), change('/display_data_extra')
  ], failures: [{ operation: 'replace', path: '/stat_data/年龄', message: '结构校验失败' }] }
  const text = textOf(sandbox.TavernMvuReceipt({ receipt }))
  assert.match(text, /1 项成功 · 1 项失败 · 人物卡联动 2 项/)
  assert.match(text, /\/stat_data\/display_data/)
  assert.match(text, /\/display_data_extra/)
  assert.match(text, /结构校验失败/)
  const errorText = textOf(sandbox.TavernMvuReceipt({ receipt: { ...receipt, status: 'error' } }))
  assert.match(errorText, /重试变量结算/)
})
