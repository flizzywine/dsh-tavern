import { buildSettingsBundle, readSettingsBundle, safeExportFileName, SETTINGS_BUNDLE_PARTS } from './settings-bundle.js'
import { uniqueName } from './tavern-settings.js'

const str = value => typeof value === 'string' ? value : (value == null ? '' : String(value))

/** Transfer selected settings as independent resources; never overwrite a local preset. */
export function createSettingsTransfer({ importPreset, presetLibrary, readTavernSettings, updateTavernSettings, userPreferenceProfile, prepareTextImport, promptDocuments }) {
  async function importPresetAsNew(preset) {
    const base = str(preset.name).replace(/^.*[\\/]/, '').replace(/\.json$/i, '').trim() || '导入的预设'
    for (let index = 1; index < 100; index += 1) {
      try { return await importPreset({ name: (index === 1 ? base : base + ' (' + index + ')') + '.json', text: preset.text }) }
      catch (error) { if (!/文件已存在/.test(str(error && error.message))) throw error }
    }
    throw new Error('同名预设过多，请先整理预设库')
  }
  async function exportSettingsBundle(args) {
    const include = Object.assign({}, args && args.include)
    if (!SETTINGS_BUNDLE_PARTS.some(part => include[part] === true)) throw new Error('请至少选择一项导出内容')
    const parts = {}
    if (include.preset === true) {
      const path = str(args.presetPath) || (await presetLibrary.catalog()).activePresetPath
      if (!path) throw new Error('没有选中的预设，无法导出')
      parts.preset = await presetLibrary.export(path)
    }
    if (include.systemPrompts === true) parts.systemPrompts = promptDocuments.export(await readTavernSettings())
    if (include.userProfile === true) {
      const library = await userPreferenceProfile.read()
      const profile = await userPreferenceProfile.read(str(args.userProfileId) || library.defaultProfileId || library.profileId)
      if (!profile.confirmed || !str(profile.confirmed.injectionText).trim()) throw new Error('该长期偏好还没有确认的内容，无法导出')
      parts.userProfile = { name: profile.name, summary: profile.confirmed.summary, injectionText: profile.confirmed.injectionText }
    }
    const name = str(args && args.name).trim() || (parts.preset ? parts.preset.name.replace(/\.json$/i, '') : parts.systemPrompts ? parts.systemPrompts.name : parts.userProfile.name)
    const bundle = buildSettingsBundle({ name, ...parts })
    return { name: safeExportFileName(bundle.name, 'dsh-tavern-preset') + '.dshpreset.json', text: JSON.stringify(bundle, null, 2) + '\n' }
  }
  async function importSettingsBundle(args) {
    const prepared = prepareTextImport(args && args.payload, '导入文件为空')
    const parts = readSettingsBundle(prepared.text, prepared.name)
    const include = Object.assign({ preset: true, systemPrompts: true, userProfile: true }, args && args.include)
    // Parse everything first so a bad part does not leave a half-applied import.
    const promptSet = parts.systemPrompts && include.systemPrompts !== false ? promptDocuments.import(parts.systemPrompts, parts.name) : null
    const imported = {}
    if (parts.preset && include.preset !== false) {
      const preset = await importPresetAsNew(parts.preset)
      const runnable = preset.valid === true && preset.recognized === true
      if (runnable) await presetLibrary.select(preset.path)
      imported.preset = { path: preset.path, title: preset.title || preset.path, selected: runnable }
    }
    if (promptSet) {
      const settings = await updateTavernSettings({ promptSet })
      imported.systemPrompts = { name: (settings.promptSets.sets.find(set => set.active) || {}).name || promptSet.name }
    }
    if (parts.userProfile && include.userProfile !== false) {
      const library = await userPreferenceProfile.read()
      const name = uniqueName(library.profiles.map(item => item.name), parts.userProfile.name || '导入的长期偏好')
      const created = await userPreferenceProfile.manage({ action: 'create', name, content: parts.userProfile.injectionText, summary: parts.userProfile.summary })
      await userPreferenceProfile.manage({ action: 'default', profileId: created.profileId })
      imported.userProfile = { id: created.profileId, name }
    }
    if (Object.keys(imported).length === 0) throw new Error('没有选择要导入的内容')
    return { kind: parts.kind, imported }
  }
  return Object.freeze({ exportSettingsBundle, importSettingsBundle })
}
