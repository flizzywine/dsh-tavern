import assert from 'node:assert/strict'
import { readFile } from "node:fs/promises"

import test from 'node:test'

import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

// Exercise the real save/read call sites with durable storage, not a copied implementation.

const settingsModuleSource = await readFile(new URL('../tavern-plugin/src/client/modules/global-settings.js', import.meta.url), 'utf8')

test('retired mode flags cannot be enabled and are removed on settings save', () => {
  const previous = { compatibilityMode: true, sillyModeEnabled: true, unknown: 'preserved' }
  const saved = applyTavernSettingsPatch(previous, {})
  assert.equal(saved.unknown, 'preserved')
  for (const key of ['compatibilityMode', 'sillyModeEnabled']) {
    assert.equal(Object.hasOwn(saved, key), false)
    assert.equal(Object.hasOwn(presentTavernSettings(previous, {}), key), false)
    assert.throws(() => applyTavernSettingsPatch(previous, { [key]: true }), /silly 模式已停用/)
  }
  assert.equal(previous.compatibilityMode, true)
})

test('全局写作 Skill 逐项保存，恢复开启不改动其他 Skill', () => {
  let document = applyTavernSettingsPatch({}, { defaultWritingSkill: { name: 'one', enabled: false } })
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'two', enabled: false } })
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: false } })
  assert.deepEqual(presentTavernSettings(document, {}).defaultDisabledWritingSkills, ['one', 'two'])
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: true } })
  assert.deepEqual(document.defaultDisabledWritingSkills, ['two'])
  assert.throws(() => applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: 'false' } }), /无效/)
})

test('BGM is one global stage switch (stageToggles.music), on by default, kept beside 舞台模式; only stage booleans are accepted', () => {
  assert.deepEqual(presentTavernSettings({}, {}).stageToggles, { stage: true, music: true, sfx: true, ambience: true, items: true, entrance: true })
  const off = applyTavernSettingsPatch({ castPresentation: true, stageToggles: { stage: false } }, { stageToggles: { music: false } })
  assert.deepEqual([off.castPresentation, presentTavernSettings(off, {}).stageToggles], [true, { stage: false, music: false, sfx: true, ambience: true, items: true, entrance: true }])
  assert.deepEqual(presentTavernSettings(applyTavernSettingsPatch(off, { stageToggles: { music: true } }), {}).stageToggles, { stage: false, music: true, sfx: true, ambience: true, items: true, entrance: true })
  // 物品 is the third switch, on by default.
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(off, { stageToggles: { items: false } }), {}).stageToggles.items, false)
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(off, { stageToggles: { sfx: false } }), {}).stageToggles.sfx, false)
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(off, { stageToggles: { ambience: false } }), {}).stageToggles.ambience, false)
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(off, { stageToggles: { entrance: false } }), {}).stageToggles.entrance, false)
  for (const bad of [{}, { music: 'on' }, { music: true, other: true }, null]) assert.throws(() => applyTavernSettingsPatch({}, { stageToggles: bad }), /舞台开关/)
})

test('舞台模式 › 可用演出 and 每轮上限 are global: every command on and 6 screen effects by default, a patch changes only what it names', () => {
  assert.deepEqual(presentTavernSettings({}, {}).stageDimensions, { scene: true, cast: true, acts: true, screenEffects: true })
  assert.deepEqual(presentTavernSettings({}, {}).stageActionCaps, { beat: 6 })
  let document = applyTavernSettingsPatch({}, { stageDimensions: { acts: false } })
  document = applyTavernSettingsPatch(document, { stageDimensions: { scene: false }, stageActionCaps: { beat: 2 } })
  assert.deepEqual(presentTavernSettings(document, {}).stageDimensions, { scene: false, cast: true, acts: false, screenEffects: true })
  assert.deepEqual(presentTavernSettings(document, {}).stageActionCaps, { beat: 2 })
  for (const bad of [{}, { acts: 'off' }, { music: false }, null]) assert.throws(() => applyTavernSettingsPatch({}, { stageDimensions: bad }), /可用演出/)
  for (const bad of [{}, { beat: 0 }, { beat: 257 }, { beat: 1.5 }, { act: 2 }]) assert.throws(() => applyTavernSettingsPatch({}, { stageActionCaps: bad }), /每轮上限/)
  // A stored value out of range reads as the default.
  assert.deepEqual(presentTavernSettings({ stageActionCaps: { beat: 999 } }, {}).stageActionCaps, { beat: 6 })
})

test('进入游戏时打开酒馆状态：默认开，可以关', () => {
  assert.equal(presentTavernSettings({}, {}).autoOpenStatusPanel, true)
  const off = applyTavernSettingsPatch({}, { autoOpenStatusPanel: false })
  assert.equal(presentTavernSettings(off, {}).autoOpenStatusPanel, false)
  assert.throws(() => applyTavernSettingsPatch({}, { autoOpenStatusPanel: 'no' }), /布尔值/)
})

test('系统提示词方案：切换时保存当前内容，生效内容始终在顶层字段', () => {
  let document = applyTavernSettingsPatch({ promptOverrides: { story: 'A' }, systemAppendEnabled: false }, { promptSet: { action: 'create', name: '快节奏' } })
  assert.equal(document.promptOverrides, undefined)
  assert.equal(document.systemAppendEnabled, true)
  document = applyTavernSettingsPatch(document, { systemPrompt: { name: 'story', text: 'B' } })
  const fast = document.activePromptSetId
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'select', id: 'default' } })
  assert.deepEqual(document.promptOverrides, { story: 'A' })
  assert.equal(document.systemAppendEnabled, false)
  assert.equal(presentTavernSettings(document, { story: 'def' }).systemPrompts[0].text, 'A')
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'select', id: fast } })
  assert.deepEqual(document.promptOverrides, { story: 'B' })
  assert.deepEqual(presentTavernSettings(document, {}).promptSets.sets.map(set => [set.name, set.active]), [['默认方案', false], ['快节奏', true]])
})

test('系统提示词方案：复制、重名加后缀、不能删除正在使用的方案', () => {
  let document = applyTavernSettingsPatch({ promptOverrides: { story: 'A' } }, { promptSet: { action: 'duplicate', name: '默认方案' } })
  assert.deepEqual(document.promptOverrides, { story: 'A' })
  assert.deepEqual(document.promptSets.map(set => set.name), ['默认方案', '默认方案 (2)'])
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'delete', id: document.activePromptSetId } })
  assert.equal(document.activePromptSetId, 'default', '删除正在使用的方案后切到剩下的方案')
  assert.deepEqual(document.promptOverrides, { story: 'A' })
  assert.equal(document.promptSets.length, 1)
  assert.throws(() => applyTavernSettingsPatch(document, { promptSet: { action: 'delete', id: 'default' } }), /至少保留一个/)
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'add', name: '导入', promptOverrides: { story: 'C' }, systemAppendEnabled: false } })
  assert.deepEqual(document.promptOverrides, { story: 'C' })
  assert.equal(document.systemAppendEnabled, false)
})

test('输入与输出走工具调用是两个独立开关：默认都关', () => {
  const settings = presentTavernSettings({}, {})
  assert.equal(settings.storyInputToolCall, false)
  assert.equal(settings.storyOutputToolCall, false)
  assert.equal(Object.hasOwn(settings, 'storyToolCall'), false)
  assert.equal(Object.hasOwn(settings, 'storyHistoryToolCall'), false)
})

test('旧的合并开关拆成输入与输出：开启的旧存档两边都开', () => {
  const merged = presentTavernSettings({ storyToolCall: true }, {})
  assert.equal(merged.storyInputToolCall, true)
  assert.equal(merged.storyOutputToolCall, true)
  const off = presentTavernSettings({ storyToolCall: false }, {})
  assert.equal(off.storyInputToolCall, false)
  assert.equal(off.storyOutputToolCall, false)
})

test('更早的「历史正文也走工具调用」只恢复输入侧', () => {
  const legacy = presentTavernSettings({ storyHistoryToolCall: true }, {})
  assert.equal(legacy.storyInputToolCall, true)
  assert.equal(legacy.storyOutputToolCall, false)
  // 两个旧字段同时存在时各管各的：合并开关只决定输出侧。
  const both = presentTavernSettings({ storyToolCall: false, storyHistoryToolCall: true }, {})
  assert.equal(both.storyInputToolCall, true)
  assert.equal(both.storyOutputToolCall, false)
})

test('改一边不会带上另一边；第一次改动就把旧字段折成明确的两项', () => {
  const fromMerged = applyTavernSettingsPatch({ storyToolCall: true }, { storyOutputToolCall: false })
  assert.deepEqual(fromMerged, { storyInputToolCall: true, storyOutputToolCall: false })
  assert.equal(presentTavernSettings(fromMerged, {}).storyInputToolCall, true)

  const fromHistory = applyTavernSettingsPatch({ storyHistoryToolCall: true }, { storyOutputToolCall: true })
  assert.deepEqual(fromHistory, { storyInputToolCall: true, storyOutputToolCall: true })

  const off = applyTavernSettingsPatch({ storyInputToolCall: true, storyOutputToolCall: true }, { storyInputToolCall: false })
  assert.deepEqual(off, { storyInputToolCall: false, storyOutputToolCall: true })

  const onlyInput = applyTavernSettingsPatch({}, { storyInputToolCall: true })
  assert.deepEqual(onlyInput, { storyInputToolCall: true, storyOutputToolCall: false })
  assert.throws(() => applyTavernSettingsPatch({}, { storyInputToolCall: 'yes' }), /输入走工具调用设置必须是布尔值/)
  assert.throws(() => applyTavernSettingsPatch({}, { storyOutputToolCall: 1 }), /输出走工具调用设置必须是布尔值/)
})

test('舞台模式 is one global switch (stageToggles.stage), on by default; only stage booleans are accepted', () => {
  assert.equal(presentTavernSettings({}, {}).stageToggles.stage, true)
  const off = applyTavernSettingsPatch({ castPresentation: true }, { stageToggles: { stage: false } })
  assert.deepEqual([off.castPresentation, presentTavernSettings(off, {}).stageToggles.stage], [true, false])
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(off, { stageToggles: { stage: true } }), {}).stageToggles.stage, true)
  for (const bad of [{}, { stage: 'on' }, { stage: true, other: true }, null]) assert.throws(() => applyTavernSettingsPatch({}, { stageToggles: bad }), /舞台开关/)
})

test('精修后台预审是全局开关，默认关闭，只接受布尔值', () => {
  assert.equal(presentTavernSettings({}, {}).polishPrereview, false)
  assert.equal(presentTavernSettings(applyTavernSettingsPatch({}, { polishPrereview: true }), {}).polishPrereview, true)
  assert.throws(() => applyTavernSettingsPatch({}, { polishPrereview: 'yes' }), /精修预审/)
})
