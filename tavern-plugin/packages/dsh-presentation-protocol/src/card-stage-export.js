// A card leaves this install with its stage declaration only (core card-stage-settings.js cardStageChoice, card-stage-mode.cjs). The one
// projection for both card exports (.dshcard dsh-card-export.js and the card bundle ZIP, stage card-bundle.js exportRaw):
// - an older dialogue / stage pair that one value expresses becomes stage.enabled;
// - a card bound to packs that leaves its stage to the global switch declares it (stage.enabled: true), so the stage
//   comes on wherever it is imported; an explicit 本卡关闭 (false) stays;
// - the card layer of the other switches (stage.switches) stays with this install.
// Mutates the dsh_tavern extension; returns whether the card declares its stage (dsh.json defaults.stage).
export function exportStageDeclaration(extension) {
  if (!extension) return false
  if (!extension.stage && !extension.assetBindings?.boundPackIds?.length) return false
  const stage = extension.stage ??= {}
  delete stage.switches
  if (stage.enabled === undefined && (stage.dialogue !== undefined || stage.stage !== undefined) && !(stage.dialogue === true && stage.stage !== true)) {
    stage.enabled = stage.dialogue === true
    delete stage.dialogue
    delete stage.stage
  }
  if (stage.enabled === undefined && stage.dialogue === undefined && stage.stage === undefined && extension.assetBindings?.boundPackIds?.length) stage.enabled = true
  return stage.enabled === true
}
