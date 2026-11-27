import { TAVERN_SETTINGS_PATH } from '../profile-data-store.js'
import { prompt as promptFile, SYSTEM_PROMPT_NAMES } from '../prompt-catalog.js'
import { applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from './tavern-settings.js'

export async function createTavernSettingsRuntime({ profileData, llm }) {
  let tavernSettingsDocument = await profileData.readJson(TAVERN_SETTINGS_PATH)

  function promptDefaults() {
    return Object.fromEntries(SYSTEM_PROMPT_NAMES.map(function (name) { return [name, promptFile(name)] }))
  }
  async function readTavernSettings() {
    return presentTavernSettings(await readRawTavernSettings(), promptDefaults())
  }
  // Import dedupe needs the stored overrides; the presented settings drop them for inactive sets.
  async function readRawTavernSettings() {
    tavernSettingsDocument = await profileData.readJson(TAVERN_SETTINGS_PATH)
    return tavernSettingsDocument
  }

  async function updateTavernSettings(patch, { beforeWrite } = {}) {
    if (patch && (Object.hasOwn(patch, 'backgroundModel') || Object.hasOwn(patch, 'backgroundTasks') || Object.hasOwn(patch, 'webSearchEnabled'))) throw new Error('后台配置已移至顶栏的本局设置')
    for (const name of ['defaultForegroundModel', 'defaultBackgroundModel', 'defaultWorkbenchModel', 'defaultCompactionModel']) {
      if (patch?.[name] != null) await llm.resolveCallConfig(patch[name])
    }
    tavernSettingsDocument = await profileData.updateJson(TAVERN_SETTINGS_PATH, async function (current) {
      const next = applyTavernSettingsPatch(current, patch)
      await beforeWrite?.(current)
      return next
    })
    return presentTavernSettings(tavernSettingsDocument, promptDefaults())
  }
  function runtimePrompt(name) {
    if (name === 'system-append' && tavernSettingsDocument?.systemAppendEnabled === false) return ''
    return resolveSystemPrompt(tavernSettingsDocument, name, promptFile)
  }

  return { readTavernSettings, readRawTavernSettings, updateTavernSettings, runtimePrompt,
    snapshot: () => tavernSettingsDocument }
}
