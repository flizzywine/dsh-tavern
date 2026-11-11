import { defaultAssetEngineSettings } from '../../tavern-plugin/lib/domain/asset-engine-settings.js'

// New profiles start with 对话气泡 and 舞台模式 off; both are four-state (card-stage-settings.js).
// Suites that exercise the stage state that precondition explicitly: globally (these settings) or on the fixture card
// (stage.enabled, 本卡开启, via stageEnabledExtension); suites about the defaults use defaultAssetEngineSettings().
export const STAGE_ENABLED_TOGGLES = Object.freeze({ dialogue: true, stage: true })
export const CARD_STAGE_ENABLED = Object.freeze({ enabled: true })

export function stageEnabledEngineSettings() {
  const settings = defaultAssetEngineSettings()
  return { ...settings, stageToggles: { ...settings.stageToggles, ...STAGE_ENABLED_TOGGLES } }
}

export function stageEnabledExtension(extension) {
  return { ...extension, stage: { ...(extension?.stage || {}), ...CARD_STAGE_ENABLED } }
}
