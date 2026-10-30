import { defaultAssetEngineSettings } from '../../tavern-plugin/lib/domain/asset-engine-settings.js'
// New profiles start with 对话气泡 and 舞台模式 off. Suites that exercise the stage
// state that precondition explicitly with these settings; suites about the defaults use defaultAssetEngineSettings().
export const STAGE_ENABLED_TOGGLES = Object.freeze({ dialogue: true, stage: true })
export function stageEnabledEngineSettings() {
  const settings = defaultAssetEngineSettings()
  return { ...settings, stageToggles: { ...settings.stageToggles, ...STAGE_ENABLED_TOGGLES } }
}
