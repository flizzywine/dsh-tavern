import assert from 'node:assert/strict'
import test from 'node:test'
import { createPresetLibrary } from '../tavern-plugin/lib/domain/preset-library.js'

const path = 'presets/写作.json'
function document() {
  return { prompts: [{ identifier: 'main', name: '正文', role: 'system', content: '写故事', enabled: true, unknown: { retain: 42 } }],
    prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }], unknown: { untouched: true },
    extensions: { regex_scripts: [null, { id: 'same', scriptName: '第一条', findRegex: '旧', replaceString: '新', placement: [2], disabled: false }, { id: 'same', scriptName: '第二条', findRegex: 'A', replaceString: 'B', placement: [2], disabled: true, unknown: 'retain' }] } }
}
function harness() {
  const files = new Map([[path, JSON.stringify(document())]]), state = new Map(), writes = [], warnings = []
  const resources = { absolute: value => '/fixture/' + value, list: async () => [...files.keys()],
    readText: async value => { if (value === 'presets/unreadable.json') throw new Error('fixture unreadable'); return files.get(value) },
    writeWorking: async (value, text) => { writes.push(value); files.set(value, text) },
    importText: async (_kind, prepared) => { const value = 'presets/' + prepared.name; files.set(value, prepared.text); return value } }
  function create() { return createPresetLibrary({ resources, state: {
    readJson: async key => structuredClone(state.get(key)),
    updateJson: async (key, update) => { const next = await update(structuredClone(state.get(key))); if (next !== undefined) state.set(key, structuredClone(next)); return structuredClone(state.get(key)) }
  }, prepareImport: value => value, logger: { warn: (...args) => warnings.push(args) } }) }
  return { create, files, state, writes, warnings }
}

test('目录、选择和重启使用同一预设；读取与选择不重写原文件', async () => {
  const h = harness(), library = h.create(), before = h.files.get(path)
  assert.equal((await library.read(path)).recognized, true)
  assert.equal((await library.catalog()).activePresetPath, '')
  assert.deepEqual(await library.select(path), { activePresetPath: path })
  const restored = h.create()
  assert.equal((await restored.catalog()).activePresetPath, path)
  const snapshot = await restored.runtime.fullSnapshot()
  assert.ok(JSON.stringify(snapshot).includes('写故事'))
  assert.equal(h.files.get(path), before)
  assert.deepEqual(h.writes, [])
  await assert.rejects(library.select('presets/missing.json'), /不是可运行/)
  assert.equal((await library.catalog()).activePresetPath, path)
  await library.select('')
  assert.equal((await library.catalog()).activePresetPath, '')
})

test('重复正则 ID 和空槽位映射到正确原文位置；编辑保留未知字段', async () => {
  const h = harness(), library = h.create()
  const detail = await library.detail(path)
  assert.deepEqual(detail.extractableRegexScripts.map(r => r.regexKey), ['same#1', 'same#2'])
  assert.equal(detail.extractableRegexScripts[1].edit.disabledPath, '/extensions/regex_scripts/2/disabled')
  await library.updateRegex(path, 'same#2', { enabled: true, replaceString: 'C' })
  await library.updateEntry(path, 'main#1', { content: '新规则' })
  const saved = JSON.parse(h.files.get(path))
  assert.deepEqual(saved.unknown, { untouched: true })
  assert.deepEqual(saved.prompts[0].unknown, { retain: 42 })
  assert.equal(saved.extensions.regex_scripts[2].unknown, 'retain')
  assert.equal(saved.extensions.regex_scripts[1].replaceString, '新')
  assert.equal(saved.extensions.regex_scripts[2].replaceString, 'C')
  assert.equal(saved.extensions.regex_scripts[2].disabled, false)
  assert.equal((await library.export(path)).text, h.files.get(path))
})

test('启动时把旧版启用的方案换成其源预设，并清除方案选择', async () => {
  const h = harness()
  h.state.set('bypass-plans.json', { activePlanId: 'p1', plans: [{ id: 'p1', name: '旧方案', source: { presetPath: path } }] })
  await h.create().migrate()
  assert.equal((await h.create().catalog()).activePresetPath, path)
  assert.equal(h.state.get('bypass-plans.json').activePlanId, '')
  assert.equal(h.state.get('bypass-plans.json').plans.length, 1)
})

test('方案退役后新开的对话被误绑旧方案时，恢复为跟随源预设 (#166)', async () => {
  const h = harness(), library = h.create()
  h.state.set('bypass-plans.json', { plans: [
    { id: 'stale', name: '旧对话 · 角色', source: { presetPath: path } },
    { id: 'orphan', name: '孤立', source: { presetPath: 'presets/deleted.json' } }
  ] })
  await library.updateEntry(path, 'main#1', { content: '新规则' })
  const created = Date.parse('2026-09-30T12:00:00+08:00')
  const chat = { id: 'new', createdAt: created, bypassPlanId: 'stale', runtimePresetPath: '', messages: [{ role: 'assistant', text: '正文' }],
    runtimePresetSnapshot: { planId: 'stale', text: '写故事' } }
  assert.equal(await library.restoreChat(chat), true)
  assert.equal(chat.bypassPlanId, '')
  assert.equal(chat.runtimePresetPath, path)
  assert.equal(chat.runtimePresetSnapshot.presetPath, path)
  assert.ok(JSON.stringify(chat.runtimePresetSnapshot).includes('新规则'))
  assert.deepEqual(chat.messages, [{ role: 'assistant', text: '正文' }])
  assert.equal(await library.restoreChat(chat), false)
  // 方案退役前的对话、源预设已删除的对话保持原样。
  const legacy = { id: 'legacy', createdAt: Date.parse('2026-08-27T12:00:00+08:00'), bypassPlanId: 'stale', runtimePresetSnapshot: { planId: 'stale' } }
  assert.equal(await library.restoreChat(legacy), false)
  const kept = { id: 'kept', createdAt: created, bypassPlanId: 'orphan', runtimePresetSnapshot: { planId: 'orphan' } }
  assert.equal(await library.restoreChat(kept), false)
  assert.equal(kept.bypassPlanId, 'orphan')
})

test('无效导入在写入前失败，导出保留原始文本', async () => {
  const h = harness(), library = h.create()
  await assert.rejects(library.import({ name: 'bad.json', text: '{' }))
  assert.equal(h.files.size, 1)
  const text = JSON.stringify(document(), null, 4)
  await library.import({ name: 'imported.json', text })
  assert.equal((await library.export('presets/imported.json')).text, text)
})

test('条目跨段与段内移动持久化到预设，重启后运行顺序一致且保留原文', async () => {
  const h = harness(), library = h.create()
  const original = { prompts: [
    { identifier: 'a', content: '甲', unknown: 1 },
    { identifier: 'b', content: '乙', enabled: false },
    { identifier: 'c', content: '丙' }
  ], extensions: { custom: { retain: true } }, dsh_tavern: { other: 42 } }
  h.files.set(path, JSON.stringify(original))
  let preset = await library.detail(path)
  preset = await library.moveEntry(path, 'c#1', 'front', 'a#1', preset.revision)
  assert.deepEqual(preset.dshPreset.front.map(e => e.content), ['丙', '甲', '乙'])
  await library.select(path)
  assert.equal((await library.runtime.fullSnapshot()).front.text, '丙\n\n甲')
  const stale = preset.revision
  preset = await library.moveEntry(path, 'a#1', 'middle', '', preset.revision)
  assert.deepEqual(preset.dshPreset.middle.map(e => e.content), ['甲'])
  await assert.rejects(library.moveEntry(path, 'b#1', 'back', '', stale), /预设已变化/)
  preset = await library.moveEntry(path, 'b#1', 'back', '', preset.revision)
  assert.equal(preset.dshPreset.back[0].enabled, false)
  const saved = JSON.parse(h.files.get(path))
  assert.deepEqual(saved.prompts, original.prompts)
  assert.deepEqual(saved.extensions, original.extensions)
  assert.equal(saved.dsh_tavern.other, 42)
  const restored = h.create()
  await restored.select(path)
  const snapshot = await restored.runtime.fullSnapshot()
  assert.equal(snapshot.front.text, '丙')
  assert.equal(snapshot.middle.text, '甲')
  assert.equal(snapshot.back.text, '')
  assert.deepEqual((await restored.detail(path)).dshPreset.back.map(e => e.content), ['乙'])
})

test('移动拒绝系统占位及无效分段，同名标识条目不会丢失', async () => {
  const h = harness(), library = h.create()
  h.files.set(path, JSON.stringify({ prompts: [{ identifier: 'same', content: '第一项' }, { identifier: 'same', content: '第二项' }, { identifier: 'chatHistory', marker: true }] }))
  let preset = await library.detail(path)
  await assert.rejects(library.moveEntry(path, 'chatHistory#1', 'back', '', preset.revision), /只能移动/)
  await assert.rejects(library.moveEntry(path, 'same#1', 'invalid', '', preset.revision), /无效/)
  preset = await library.moveEntry(path, 'same#2', 'back', '', preset.revision)
  assert.deepEqual(preset.dshPreset.front.map(e => e.content), ['第一项'])
  assert.deepEqual(preset.dshPreset.back.map(e => e.content), ['第二项'])
})
