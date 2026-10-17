import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { generateHelperRaw } from '../tavern-plugin/lib/domain/helper-generation.js'

const card = { name: '测试', first_mes: '首页', alternate_greetings: ['第二幕'] }
function fixture() {
  const document = { name: '本局世界书', entries: [{ id: 0, name: '选项', keys: [], content: '固定设定', enabled: false }] }
  const record = { source: { kind: 'card', cardPath: 'card' }, view: inspectWorldBookDocument(document) }
  return { record, service: createOpeningPreparation({ readCard: async () => structuredClone(card), worldBooks: { bound: async () => structuredClone(record) } }) }
}

test('过期世界书写入不覆盖新设置，返回值也不能直接修改草稿', async () => {
  const { service } = fixture()
  const draft = await service.create('card')
  const old = structuredClone(draft.worldbook.entries)
  draft.worldbook.entries[0].enabled = true
  await service.replaceWorldbook(draft.id, draft.worldbook.entries, old)
  await assert.rejects(service.replaceWorldbook(draft.id, old, old), /修改/)
  const current = service.get(draft.id)
  current.worldbook.entries[0].enabled = false
  assert.equal(service.get(draft.id).worldbook.entries[0].enabled, true)
})

import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'
for (const embedded of [false, true]) test('本局世界书的运行时读写与原始资源隔离：' + embedded, async () => {
  const h = await createHelperWorldbookHost(embedded)
  try {
    const before = await h.read()
    h.chat.openingWorldbookSnapshot = { version: 1, source: (await h.record()).source, document: structuredClone(before) }
    const { worldbook } = await h.adapter.getWorldbook('audit', '审计书')
    const entries = structuredClone(worldbook.entries)
    entries[0].enabled = false
    await h.adapter.replaceWorldbook('audit', '审计书', entries, worldbook.entries)
    assert.equal((await h.adapter.getWorldbook('audit', '审计书')).worldbook.entries[0].enabled, false)
    assert.deepEqual(await h.read(), before)
    const { worldInfo } = await h.adapter.loadWorldInfo('audit', '审计书')
    const updated = structuredClone(worldInfo)
    updated.entries[7].content = '只属于这局的新正文'
    await h.adapter.saveWorldInfo('audit', '审计书', updated, worldInfo)
    assert.equal((await h.adapter.loadWorldInfo('audit', '审计书')).worldInfo.entries[7].content, '只属于这局的新正文')
    assert.deepEqual(await h.read(), before)
  } finally { await h.cleanup() }
})

test('开场准备复用已读取的卡片和扩展，不重复加载资源', async () => {
  const service = createOpeningPreparation({ readCard: async () => { throw new Error('重复读取') },
    readRuntimeExtensions: async () => { throw new Error('重复准备扩展') }, worldBooks: { bound: async () => null } })
  const draft = await service.create('card', { card, extensions: { helperScripts: [] } })
  assert.ok(draft.id)
})

test('保留的开局草稿跨过原有效期仍可用，放弃立即释放，失联草稿仍过期', async () => {
  let now = 0
  const service = createOpeningPreparation({ now: () => now, readCard: async () => card, worldBooks: { bound: async () => null } })
  const retained = await service.create('card'), abandoned = await service.create('card')
  service.select(retained.id, 'alternate:0')
  now = 90 * 60 * 1000
  assert.deepEqual(service.retain(retained.id), { retained: true })
  now = 150 * 60 * 1000
  assert.equal(service.get(retained.id).openingId, 'alternate:0')
  assert.throws(() => service.retain(abandoned.id), /过期/)
  assert.deepEqual(service.release(retained.id), { released: true })
  assert.throws(() => service.get(retained.id), /过期/)
  assert.deepEqual(service.release(retained.id), { released: false })
})

test('opening stop/release/expiry cancels only its own pending generations and aborts provider signals', async t => {
  let now = 0
  const started = new Map(), signals = new Map()
  const service = createOpeningPreparation({ readCard: async () => card, worldBooks: { bound: async () => null }, now: () => now,
    generateRaw: async (config, context) => {
      signals.set(context.chat.id, context.signal)
      started.get(context.chat.id)?.()
      return generateHelperRaw(config, { ...context, callModel: async () => new Promise(() => {}) })
    } })
  t.after(() => service.dispose())
  const first = await service.create('card', { sourceChat: { sessionId: 'shared-source' } })
  const second = await service.create('card', { sourceChat: { sessionId: 'shared-source' } })
  const run = draft => {
    const ready = new Promise(resolve => started.set(draft.id, resolve))
    const pending = service.callRuntime(draft.id, 'generateTavernHelperRaw', { config: { generation_id: 'same-id', ordered_prompts: [{ role: 'user', content: 'wait' }] } })
    return { ready, rejected: assert.rejects(pending, { name: 'AbortError' }) }
  }
  const a = run(first), b = run(second)
  await Promise.all([a.ready, b.ready])
  assert.deepEqual(await service.callRuntime(first.id, 'stopTavernHelperGeneration', { generationId: 'same-id' }), { stopped: true })
  await a.rejected
  assert.equal(signals.get(first.id).aborted, true)
  assert.equal(signals.get(second.id).aborted, false)
  service.release(second.id)
  await b.rejected
  assert.equal(signals.get(second.id).aborted, true)
  const c = run(first)
  await c.ready
  now = 3 * 60 * 60 * 1000
  assert.throws(() => service.get(first.id), /过期/)
  await c.rejected
  assert.equal(signals.get(first.id).aborted, true)
})

test('opening stopAll remembers token-scoped pending admission without blocking a new incarnation', async t => {
  let calls = 0
  const service = createOpeningPreparation({ readCard: async () => card, worldBooks: { bound: async () => null }, generateRaw: async () => { calls++; return 'ok' } })
  t.after(() => service.dispose())
  const draft = await service.create('card')
  assert.deepEqual(await service.callRuntime(draft.id, 'stopAllTavernHelperGeneration', { pendingGenerations: [{ generationId: 'delayed', generationToken: 'old' }] }), { stopped: true, generationIds: ['delayed'] })
  await assert.rejects(service.callRuntime(draft.id, 'generateTavernHelperRaw', { generationToken: 'old', config: { generation_id: 'delayed' } }), { name: 'AbortError' })
  assert.equal(calls, 0)
  assert.deepEqual(await service.callRuntime(draft.id, 'generateTavernHelperRaw', { generationToken: 'new', config: { generation_id: 'delayed' } }), { text: 'ok' })
  assert.equal(calls, 1)
})
