import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareWorldBookRecall } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { withPluginWorldbookEntries } from '../tavern-plugin/lib/domain/plugin-worldbook.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'

const runtime = await UpstreamTemplateRuntime.create()
const bound = () => ({ source: { kind: 'card' }, document: { entries: {} }, view: inspectWorldBookDocument({ entries: { 0: { uid: 0, key: ['钟楼'], content: '钟楼在镇中心。', order: 100 } } }) })
const plugin = (id, extra = {}) => ({ owner: 'narrative-anchor', source: 'session', id, title: '', content: id + ' 的设定', keys: [], secondaryKeys: [], constant: false, force: false, ...extra })

test('插件条目进入条目池，按关键词召回，与卡内条目同一套规则', () => {
  const book = withPluginWorldbookEntries(bound(), [plugin('letter', { title: '未署名的信', keys: ['那封信'] }), plugin('quiet', { keys: ['不会出现'] })])
  assert.equal(book.view.entries.length, 3)
  assert.equal(book.document.entries[1], undefined, '人物卡世界书文档不变')
  const result = prepareWorldBookRecall({ worldBook: book, turn: 2, chat: { messages: [] }, userText: '我拆开那封信，再去钟楼' })
  assert.deepEqual(result.refs.sort(), ['entry:0', 'plugin:narrative-anchor/session/letter'])
  assert.match(result.context, /letter 的设定/)
  const reads = result.recordReads({})
  assert.ok(reads['plugin:narrative-anchor/session/letter'], '插件条目也记入已读，按冷却规则处理')
})

test('force 的插件条目不靠关键词也入选；constant 走常驻；没有绑定世界书时也能召回插件条目', async () => {
  const book = withPluginWorldbookEntries(null, [plugin('scene', { force: true }), plugin('rule', { constant: true, content: '常驻规则' })])
  assert.deepEqual(book.pluginActivationRequests, [{ ref: 'plugin:narrative-anchor/session/scene', force: true, sourceRef: '[PLUGIN:narrative-anchor]' }])
  const project = createForegroundWorldbook({ bound: async () => book, runtime: async () => runtime, globalVariables: async () => ({}) })
  const result = await project({ chat: { messages: [] }, card: {}, userText: '随便走走' })
  assert.ok(result.refs.includes('plugin:narrative-anchor/session/scene'))
  assert.match(result.context, /scene 的设定/)
})

test('没有插件条目时原样返回', () => {
  const record = bound()
  assert.equal(withPluginWorldbookEntries(record, []), record)
  assert.equal(withPluginWorldbookEntries(null, []), null)
})
