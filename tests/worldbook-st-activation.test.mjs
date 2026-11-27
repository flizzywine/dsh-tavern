import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareWorldBookRecall } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'

const runtime = await UpstreamTemplateRuntime.create()

const e = (uid, key, extra = {}) => ({ uid, key: [key], content: '设定' + uid, order: 100, ...extra })
const book = (entries, settings = {}) => ({ view: inspectWorldBookDocument({ ...settings, entries: Object.fromEntries(entries.map(entry => [entry.uid, entry])) }) })
const recall = (entries, options = {}, settings = {}) => prepareWorldBookRecall({ worldBook: book(entries, settings), turn: 2, chat: { messages: [] }, ...options })

test('常驻条目可触发递归；未入选条目不能把隐藏正文带入扫描', async () => {
  const entries = [e(0, '', { constant: true, content: 'Alice' }), e(1, 'Alice')]
  assert.deepEqual(recall(entries, {}, { recursive_scanning: true }).refs, ['entry:1'])
  const overflow = Array.from({ length: 6 }, (_, uid) => e(uid, 'start', { order: uid, content: uid === 0 ? 'hidden' : '普通内容' }))
  overflow.push(e(9, 'hidden', { order: 999 }))
  const result = recall(overflow, { userText: 'start' }, { recursive_scanning: true, token_budget: 25 })
  assert.equal(result.refs.length, 5)
  assert.ok(!result.refs.includes('entry:9'))
  assert.equal(result.diagnostics.find(item => item.ref === 'entry:0').reason, 'budget')
})
test('包含组支持优先级、权重、计分和多个组，不会重复入选', async () => {
  const entries = [e(0, 'Alice', { group: '角色', groupOverride: true, order: 10 }), e(1, 'Alice', { group: '角色', order: 200 })]
  assert.deepEqual(recall(entries, { userText: 'Alice' }).refs, ['entry:0'])
  entries[0].groupOverride = false
  entries[0].groupWeight = 0
  assert.deepEqual(recall(entries, { userText: 'Alice', random: () => 0.4 }).refs, ['entry:1'])
  entries[0].key = ['Alice', 'Bob']; entries[0].useGroupScoring = true; entries[0].groupWeight = 100
  entries[1].useGroupScoring = true
  assert.deepEqual(recall(entries, { userText: 'Alice Bob' }).refs, ['entry:0'])
  entries[0].group = '角色, 人物'
  entries.push(e(2, 'Alice', { group: '人物', useGroupScoring: true }))
  assert.deepEqual(recall(entries, { userText: 'Alice Bob' }).refs, ['entry:0'])
})

test('失败的 EJS 不泄露源码、不消耗冷却；静态资料预算耗尽时退回标题提醒', async () => {
  const entries = Array.from({ length: 6 }, (_, uid) => e(uid, uid > 2 ? 'script' : 'player', { order: uid }))
  entries.push(e(9, 'player', { content: '<% if ( %>', order: 999 }))
  const project = createForegroundWorldbook({ bound: async () => book(entries, { token_budget: 15 }), runtime: async () => runtime, globalVariables: async () => ({}), scanText: () => 'script' })
  const result = await project({ chat: { messages: [] }, card: {}, userText: 'player' })
  assert.equal(result.refs.length, 1)
  assert.match(result.automaticContext, /设定[0-9]/)
  assert.match(result.titleHints, /可能用到的世界书条目：/)
  assert.doesNotMatch(result.titleHints, /设定[0-9]/)
  assert.equal(result.reads['entry:9'], undefined)
  assert.equal(result.virtualState.automatic.entries['entry:9'], undefined)
  assert.doesNotMatch(result.context, /<%/)
  assert.equal(result.diagnostics[0].code, 'syntax-error')
})
