// 对话气泡 and 舞台模式 are the card's own declaration (extensions.dsh_tavern.stage). Suites that exercise the stage
// state that precondition on their fixture card with this; an ordinary card never has a stage.
export const STAGE_ENABLED_TOGGLES = Object.freeze({ enabled: true })
export function stageEnabledExtension(extension) {
  return { ...extension, stage: { ...(extension?.stage || {}), ...STAGE_ENABLED_TOGGLES } }
}
