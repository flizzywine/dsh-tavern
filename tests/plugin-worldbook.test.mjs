import test from 'node:test'
import assert from 'node:assert/strict'

import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { withPluginWorldbookEntries } from '../tavern-plugin/lib/domain/plugin-worldbook.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'

const runtime = await UpstreamTemplateRuntime.create()
const bound = () => ({ source: { kind: 'card' }, document: { entries: {} }, view: inspectWorldBookDocument({ entries: { 0: { uid: 0, key: ['钟楼'], content: '钟楼在镇中心。', order: 100 } } }) })
const plugin = (id, extra = {}) => ({ owner: 'narrative-anchor', source: 'session', id, title: '', content: id + ' 的设定', keys: [], secondaryKeys: [], constant: false, force: false, ...extra })

test('force 的插件条目不靠关键词也入选；constant 走常驻；没有绑定世界书时也能召回插件条目', async () => {
  const book = withPluginWorldbookEntries(null, [plugin('scene', { force: true }), plugin('rule', { constant: true, content: '常驻规则' })])
  assert.deepEqual(book.pluginActivationRequests, [{ ref: 'plugin:narrative-anchor/session/scene', force: true, sourceRef: '[PLUGIN:narrative-anchor]' }])
  const project = createForegroundWorldbook({ bound: async () => book, runtime: async () => runtime, globalVariables: async () => ({}) })
  const result = await project({ chat: { messages: [] }, card: {}, userText: '随便走走' })
  assert.ok(result.refs.includes('plugin:narrative-anchor/session/scene'))
  assert.match(result.context, /scene 的设定/)
})
