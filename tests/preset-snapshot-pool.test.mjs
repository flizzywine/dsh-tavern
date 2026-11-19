import test from 'node:test'
import assert from 'node:assert/strict'
import { thinPresetSnapshot, materializeSnapshotDocuments } from '../tavern-plugin/lib/domain/preset-snapshot-pool.js'

const documents = () => ({
  compatibilityPreset: { valid: true, recognized: true, entries: [{ entryKey: 'main#1', content: '写故事' }] },
  compatibilityPresetDocument: { temperature: 0.8, prompts: [{ identifier: 'main', content: '写故事' }] }
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
