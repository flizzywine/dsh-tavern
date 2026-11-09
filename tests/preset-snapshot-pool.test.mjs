import test from 'node:test'
import assert from 'node:assert/strict'
import { createPresetSnapshotPool, thinPresetSnapshot, materializeSnapshotDocuments, snapshotNeedsDocuments } from '../tavern-plugin/lib/domain/preset-snapshot-pool.js'
import { createPresetLibrary } from '../tavern-plugin/lib/domain/preset-library.js'

const documents = () => ({
  compatibilityPreset: { valid: true, recognized: true, entries: [{ entryKey: 'main#1', content: '写故事' }] },
  compatibilityPresetDocument: { temperature: 0.8, prompts: [{ identifier: 'main', content: '写故事' }] }
})

test('快照只带走引用，兼容文档按 digest 归档一次', async () => {
  const writes = new Map()
  const pool = createPresetSnapshotPool({
    exists: async key => writes.has(key),
    read: async key => writes.get(key) || null,
    write: async (key, value) => { writes.set(key, value) }
  })
  const snapshot = { presetPath: 'presets/写作.json', presetName: '写作', regexScripts: [], front: { entries: [], text: '甲' }, text: '甲', ...documents(), digest: 'd1' }
  await pool.save('d1', documents())
  const thin = thinPresetSnapshot(snapshot, snapshot.digest)
  assert.equal(thin.presetSnapshotRef, 'd1')
  assert.equal(thin.compatibilityPreset, undefined)
  assert.equal(thin.compatibilityPresetDocument, undefined)
  assert.equal(thin.front.text, '甲', '游玩回合渲染用的阶段与正则必须留在快照里')
  assert.equal(writes.size, 1)
  // 同一 digest 再存不重复落盘：新开一局共用同一份文档。
  await pool.save('d1', documents())
  assert.equal(writes.size, 1)
  assert.ok(snapshotNeedsDocuments(thin))
  const restored = await materializeSnapshotDocuments(thin, { load: digest => pool.load(digest) })
  assert.deepEqual(restored.compatibilityPresetDocument, documents().compatibilityPresetDocument)
  assert.equal(restored.text, '甲')
})

test('三段齐全时不再落库拼接文本，回读按段重建', async () => {
  const phases = { front: { entries: [{ id: 'a', content: '甲' }], text: '甲' }, middle: { entries: [], text: '' }, back: { entries: [{ id: 'b', content: '乙' }], text: '乙' } }
  const snapshot = { presetPath: 'presets/写作.json', ...phases, text: '甲\n\n乙', ...documents(), digest: 'd2' }
  const thin = thinPresetSnapshot(snapshot, snapshot.digest)
  assert.equal(thin.text, undefined, 'text 是三段拼接的派生字段')
  assert.equal(thin.front.text, '甲')
  assert.equal(thin.back.text, '乙')
  assert.equal([thin.front.text, thin.middle.text, thin.back.text].filter(Boolean).join('\n\n'), '甲\n\n乙')
})

test('没有 digest 的快照保留内联文档；池里取不到时按预设路径重新读取', async () => {
  const inline = { presetPath: 'presets/写作.json', ...documents() }
  assert.equal(thinPresetSnapshot(inline), inline)
  const orphan = { presetPath: 'presets/写作.json', digest: 'gone', presetSnapshotRef: 'gone', text: '甲' }
  const reread = await materializeSnapshotDocuments(orphan, {
    load: async () => null,
    readPreset: async path => ({ path, revision: 'r1' }),
    readDocument: async () => ({ temperature: 0.5 })
  })
  assert.equal(reread.compatibilityPreset.revision, 'r1')
  assert.equal(reread.compatibilityPresetDocument.temperature, 0.5)
  // 预设也不在时保持引用形态，由 generate 自己报错，不让游玩回合失败。
  const unchanged = await materializeSnapshotDocuments(orphan, { load: async () => null, readPreset: async () => undefined })
  assert.equal(unchanged.compatibilityPreset, undefined)
  assert.equal(unchanged.presetSnapshotRef, 'gone')
})

const presetPath = 'presets/写作.json'
function harness(options = {}) {
  const document = { prompts: [{ identifier: 'main', name: '正文', role: 'system', content: '写故事', enabled: true }],
    prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }] }
  const files = new Map([[presetPath, JSON.stringify(document)]]), state = new Map(), writes = []
  const resources = { absolute: value => '/fixture/' + value, list: async () => [...files.keys()],
    readText: async value => files.get(value),
    writeWorking: async (value, text) => { files.set(value, text) },
    importText: async (_kind, prepared) => { const value = 'presets/' + prepared.name; files.set(value, prepared.text); return value } }
  const profileData = {
    readJson: async key => structuredClone(state.get(key)),
    writeJson: async (key, value) => { writes.push(key); state.set(key, structuredClone(value)) },
    size: async key => state.has(key) ? Buffer.byteLength(JSON.stringify(state.get(key))) : 0,
    remove: async key => { state.delete(key) },
    updateJson: async (key, update) => { const next = await update(structuredClone(state.get(key))); if (next !== undefined) state.set(key, structuredClone(next)); return structuredClone(state.get(key)) }
  }
  const library = createPresetLibrary({ resources, state: profileData, prepareImport: value => value, logger: { warn() {} }, ...options })
  return { library, files, state, writes }
}

test('开局快照只把兼容文档写进共享池一次，重开一局不再落盘', async () => {
  const h = harness()
  await h.library.select(presetPath)
  const first = await h.library.runtime.fullSnapshot()
  assert.ok(first.presetSnapshotRef, '快照带池引用')
  assert.equal(first.compatibilityPreset, undefined)
  assert.equal(first.compatibilityPresetDocument, undefined)
  assert.equal(first.presetRevision, (await h.library.read(presetPath)).revision, '预设文本摘要用于跟随预设编辑')
  const documentsWritten = () => h.writes.filter(key => key.startsWith('preset-snapshots/') && !key.endsWith('/index.json'))
  const indexed = () => Object.keys(h.state.get('preset-snapshots/index.json') || {})
  assert.equal(documentsWritten().length, 1, '每个 digest 只写一次：' + h.writes.join(','))
  assert.deepEqual(indexed(), [first.presetSnapshotRef], '新建条目时登记引用索引')
  // 第二局同一个预设：命中已有池条目，文档不再写入，索引也不动。
  await h.library.runtime.fullSnapshot()
  assert.equal(documentsWritten().length, 1)
  assert.deepEqual(indexed(), [first.presetSnapshotRef], '复用同一 digest 不重写索引')
  const hydrated = await h.library.snapshotDocuments.hydrate(first)
  assert.equal(hydrated.compatibilityPreset.valid, true)
  assert.equal(hydrated.compatibilityPresetDocument.prompts[0].content, '写故事')
})

test('编辑预设产生的新 digest 不会让文档池无限增长', async () => {
  const h = harness({ snapshotPoolLimit: 2 })
  const docs = index => ({ compatibilityPreset: { valid: true, recognized: true, entries: [], path: 'presets/写作.json', marker: index },
    compatibilityPresetDocument: { temperature: 0.1 * index } })
  for (const digest of ['d1', 'd2', 'd3']) await h.library.snapshotDocuments.save(digest, docs(digest.length))
  const kept = Object.keys(h.state.get('preset-snapshots/index.json')).sort()
  assert.deepEqual(kept, ['d2', 'd3'], '只保留最新的条目')
  assert.equal(h.state.has('preset-snapshots/d1.json'), false, '最旧的文档已回收')
  assert.ok(h.state.has('preset-snapshots/d3.json'))
})
