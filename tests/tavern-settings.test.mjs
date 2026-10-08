import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

// Exercise the real save/read call sites with durable storage, not a copied implementation.
async function settingsHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-settings-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profileData = createProfileDataStore({ dataRoot: root })
  const context = {
    profileData, settingsPath: 'tavern-settings.json', tavernSettingsDocument: undefined,
    applyTavernSettingsPatch, presentTavernSettings,
    promptDefaults: () => ({ story: '默认正文' })
  }
  const start = serverSource.indexOf('async function readTavernSettings()')
  assert.ok(start >= 0)
  vm.runInNewContext(serverSource.slice(start, serverSource.indexOf('\n  function runtimePrompt', start)) +
    '; this.read = readTavernSettings; this.update = updateTavernSettings;', context)
  return { ...context, saved: () => profileData.readJson(context.settingsPath) }
}

const settingsModuleSource = await readFile(new URL('../tavern-plugin/src/client/modules/global-settings.js', import.meta.url), 'utf8')

test('设置界面不重复提供已并入外观的分色，不恢复旧兼容样式选项', () => {
  const context = { GlobalPlayDefaults: function GlobalPlayDefaults() {}, DisplayPreferencesSettings: function DisplayPreferencesSettings() {}, CandidatePreferencesSettings: function CandidatePreferencesSettings() {}, PromptTemplateSettingsEntry: function PromptTemplateSettingsEntry() {}, TavernConversationWritingSkills: function TavernConversationWritingSkills() {}, TavernDefaultModelSetting: function TavernDefaultModelSetting() {}, TavernTextColorSettings: function TavernTextColorSettings() {}, ContextCompactionSettings: function ContextCompactionSettings() {}, SceneImageSettings: function SceneImageSettings() {}, React: {
    useState: initial => [initial, () => {}],
    useEffect() {},
    createElement: (type, props, ...children) => ({ type, props, children })
  } }
  vm.runInNewContext(settingsModuleSource + '; this.render = createGlobalSettingsModule(this).TavernSettingsSection;', context)
  const root = context.render()
  const nodes = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    nodes.push(node)
    for (const child of node.children || []) visit(child)
  }
  visit(root)
  assert.equal(nodes.some(node => node.type === context.TavernTextColorSettings), false)
  const inputs = nodes.filter(node => node.type === 'input')
  assert.equal(inputs.length, 0)
  assert.doesNotMatch(JSON.stringify(root), /开放 silly 模式入口/)
  const select = nodes.find(node => node.type === 'select' && node.props['aria-label'] === '后台模型')
  assert.equal(select, undefined)
  assert.equal(nodes.some(node => node.type === 'textarea' || node.type === 'details'), false)
  assert.doesNotMatch(JSON.stringify(root), /兼容模式|受信任人物卡模式|SillyTavern 样式环境|Custom CSS/)
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

test('候选项默认发送后才隐藏，保存后持久化且不覆盖其他设置', async t => {
  const h = await settingsHarness(t)
  assert.equal((await h.read()).candidateDismissMode, 'after-send')
  await h.update({ systemAppendEnabled: true, candidateDismissMode: 'after-fill' })
  assert.equal((await h.read()).candidateDismissMode, 'after-fill')
  await h.update({ candidateDismissMode: 'after-send' })
  assert.equal((await h.read()).candidateDismissMode, 'after-send')
  assert.equal((await h.read()).systemAppendEnabled, true)
  await assert.rejects(h.update({ candidateDismissMode: 'invalid' }), /无效的候选项/)
  assert.equal((await h.read()).candidateDismissMode, 'after-send')
})

test('全局隐藏注入与思考设置可持久化和恢复，不改动其他配置', async t => {
  const h = await settingsHarness(t)
  assert.equal((await h.read()).hideContextAndReasoning, true)
  await h.update({ hideContextAndReasoning: true, candidateDismissMode: 'after-send' })
  assert.equal((await h.read()).hideContextAndReasoning, true)
  await h.update({ hideContextAndReasoning: false })
  assert.equal((await h.read()).hideContextAndReasoning, false)
  assert.equal((await h.read()).candidateDismissMode, 'after-send')
  await assert.rejects(h.update({ hideContextAndReasoning: 'true' }), /无效的对话显示设置/)
})

test('global play defaults merge individual switches without losing other defaults', () => {
  let saved = applyTavernSettingsPatch({}, { defaultPlaySettings: { playerName: '玩家', statusBarPlacement: 'body', backgroundTasks: { variables: false }, webSearchEnabled: true } })
  saved = applyTavernSettingsPatch(saved, { defaultPlaySettings: { backgroundTasks: { posture: false }, sceneImagesEnabled: true } })
  const defaults = presentTavernSettings(saved, {}).defaultPlaySettings
  assert.equal(defaults.playerName, '玩家')
  assert.equal(defaults.statusBarPlacement, 'body')
  assert.equal(defaults.backgroundTasks.variables, false)
  assert.equal(defaults.backgroundTasks.posture, false)
  assert.equal(defaults.webSearchEnabled, true)
  assert.equal(defaults.sceneImagesEnabled, true)
  assert.throws(() => applyTavernSettingsPatch(saved, { defaultPlaySettings: { webSearchEnabled: 'false' } }))
})

test('the global scene image Agent default model saves like the other defaults and is unset by default', async () => {
  const { applyTavernSettingsPatch, presentTavernSettings } = await import('../tavern-plugin/lib/domain/tavern-settings.js')
  assert.equal(presentTavernSettings({}, []).defaultImageModel, null)
  const saved = applyTavernSettingsPatch({}, { defaultImageModel: { provider: 'p', model: 'flash' } })
  assert.deepEqual(presentTavernSettings(saved, []).defaultImageModel, { provider: 'p', model: 'flash' })
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(saved, { defaultImageModel: null }), []).defaultImageModel, null)
})
