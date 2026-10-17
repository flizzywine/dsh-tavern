import test from 'node:test'
import assert from 'node:assert/strict'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'

const runtime = await UpstreamTemplateRuntime.create()
let nextUid = 1000
const entry = (ref, extra = {}) => ({ ref, sourceUid: nextUid++, title: ref, comment: ref, enabled: true, constant: false,
  primaryKeys: [], secondaryKeys: [], order: 100, content: '正文 ' + ref, ...extra })
const controller = (ref, content) => entry(ref, { constant: true, enabled: false, order: 500, content: '@@generate_before\n' + content })
const project = (entries, raw = {}) => createForegroundWorldbook({ bound: async () => ({ view: { displayName: '绑定书', entries, raw } }), runtime: async () => runtime, globalVariables: async () => ({}) })

test('主动激活仍受token 预算和既有冷却约束；重投影不重复累加变量', async () => {
  const entries = [controller('调度', '<% incvar("count"); for (const e of await getEnabledWorldInfoEntries()) if (!e.constant) await activewi("绑定书", e.uid, true); %>'),
    ...Array.from({ length: 6 }, (_, i) => entry('叶' + i, { order: 110 - i, content: '<%= getvar("count", {defaults:0}) %> 叶' + i }))]
  const run = project(entries, { token_budget: 20 })
  const first = await run({ chat: { messages: [{ role: 'assistant', turn: 1, text: '' }] }, card: {}, userText: '无关键词' })
  assert.equal(first.error, null)
  assert.equal(first.refs.length, 5, JSON.stringify({refs:first.refs, outputs:first.log.outputs}))
  assert.equal(first.log.entries.find(e => e.ref === '叶5').reason, 'budget')
  // Upstream generate-before controllers run before the native candidate projection; increments remain speculative.
  assert.ok(first.log.outputs.every(o => /^1 叶/.test(o.text)))
  const second = await run({ chat: { worldBookReads: first.reads, messages: [{ role: 'assistant', turn: 2, text: '' }] }, card: {}, userText: '无关键词' })
  assert.deepEqual(second.refs, ['叶5'])
  assert.equal(second.log.entries.find(e => e.ref === '叶0').reason, 'cooldown')
})
