import assert from 'node:assert/strict'
import { readFile } from "node:fs/promises"

import test from 'node:test'

import { applyTavernSettingsPatch, normalizePlayDefaults, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

// Exercise the real save/read call sites with durable storage, not a copied implementation.

const settingsModuleSource = await readFile(new URL('../tavern-plugin/src/client/modules/global-settings.js', import.meta.url), 'utf8')

test('全局写作 Skill 逐项保存，恢复开启不改动其他 Skill', () => {
  let document = applyTavernSettingsPatch({}, { defaultWritingSkill: { name: 'one', enabled: false } })
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'two', enabled: false } })
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: false } })
  assert.deepEqual(presentTavernSettings(document, {}).defaultDisabledWritingSkills, ['one', 'two'])
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: true } })
  assert.deepEqual(document.defaultDisabledWritingSkills, ['two'])
  assert.throws(() => applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: 'false' } }), /无效/)
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

test('新游戏统一主动检索，旧默认值归一化且严格校验', () => {
  assert.equal(normalizePlayDefaults({}).worldbookStrategy, 'native-skills')
  const saved = applyTavernSettingsPatch({}, { defaultPlaySettings: { worldbookStrategy: 'legacy' } })
  assert.equal(presentTavernSettings(saved, {}).defaultPlaySettings.worldbookStrategy, 'native-skills')
  const updated = applyTavernSettingsPatch(saved, { defaultPlaySettings: { playerName: '旅人' } })
  assert.equal(updated.defaultPlaySettings.worldbookStrategy, 'native-skills')
  assert.throws(() => applyTavernSettingsPatch({}, { defaultPlaySettings: { worldbookStrategy: 'unknown' } }), /默认世界书策略无效/)
})
