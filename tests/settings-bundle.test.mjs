import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createUserPreferenceProfile } from '../tavern-plugin/lib/domain/user-preference-profile.js'

import { createSettingsTransfer } from '../tavern-plugin/lib/domain/settings-transfer.js'
import { createSystemPromptDocuments } from '../tavern-plugin/lib/domain/system-prompt-documents.js'

function memoryStore(initial) {
  let value = initial
  return { async readJson() { return structuredClone(value) }, async updateJson(_path, updater) { value = await updater(structuredClone(value)); return structuredClone(value) } }
}

const NAMES = ['story', 'system-append']
const DEFAULTS = { story: 'default story', 'system-append': '' }

function harness() {
  const presets = new Map()
  let activePreset = ''
  let settings = {}
  const profile = createUserPreferenceProfile({ store: memoryStore(), now: () => 100 })
  const deps = {
    importPreset: async payload => {
      if (presets.has(payload.name)) throw new Error('文件已存在: ' + payload.name)
      presets.set(payload.name, payload.text)
      return { path: payload.name, title: payload.name.replace(/\.json$/, ''), valid: true, recognized: Array.isArray(JSON.parse(payload.text).prompts) }
    },
    presetLibrary: {
      catalog: async () => ({ activePresetPath: activePreset }),
      select: async path => { activePreset = path },
      export: async path => ({ name: path, text: presets.get(path) })
    },
    readTavernSettings: async () => presentTavernSettings(settings, DEFAULTS),
    updateTavernSettings: async patch => { settings = applyTavernSettingsPatch(settings, patch); return presentTavernSettings(settings, DEFAULTS) },
    userPreferenceProfile: profile,
    prepareTextImport: payload => ({ ...payload, text: String(payload.text).trim() }),
    promptDocuments: createSystemPromptDocuments({ definitions: NAMES.map(name => ({ name, label: name })), prompt: name => DEFAULTS[name] })
  }
  const api = createSettingsTransfer(deps)
  return { ...api, presets, profile, active: () => activePreset, settings: () => settings }
}

test('导出的预设包在另一台机器导入后，三部分都作为新方案加入并设为使用中', async () => {
  const from = harness()
  from.presets.set('文风.json', JSON.stringify({ prompts: [{ identifier: 'main', content: 'x' }] }))
  const created = await from.profile.manage({ action: 'create', name: '我的偏好', content: '少写心理描写' })
  await from.profile.manage({ action: 'default', profileId: created.profileId })
  await from.importSettingsBundle({ payload: { name: 'seed.json', text: JSON.stringify({ spec: 'dsh-tavern.system-prompts', version: 1, name: '快节奏', prompts: { story: 'fast story' } }) } })
  const exported = await from.exportSettingsBundle({ include: { preset: true, systemPrompts: true, userProfile: true }, presetPath: '文风.json' })
  assert.match(exported.name, /\.dshpreset\.json$/)
  const bundle = JSON.parse(exported.text)
  assert.equal(bundle.spec, 'dsh-tavern.bundle')
  assert.equal(bundle.systemPrompts.name, '快节奏')
  assert.equal(bundle.userProfile.injectionText, '少写心理描写')

  const to = harness()
  to.presets.set('文风.json', '{"prompts":[]}')
  await to.profile.manage({ action: 'create', name: '我的偏好', content: '本机已有偏好' })
  const result = await to.importSettingsBundle({ payload: { name: exported.name, text: exported.text } })
  assert.equal(result.imported.preset.path, '文风 (2).json', '同名预设不覆盖')
  assert.equal(to.active(), '文风 (2).json')
  assert.equal(to.settings().promptOverrides.story, 'fast story')
  assert.equal(result.imported.userProfile.name, '我的偏好 (2)')
  const library = await to.profile.read()
  assert.equal(library.defaultProfileId, result.imported.userProfile.id)
  assert.equal((await to.profile.read(result.imported.userProfile.id)).confirmed.injectionText, '少写心理描写')
})
