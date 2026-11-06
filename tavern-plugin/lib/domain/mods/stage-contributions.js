// Mods that take part in the director transaction contribute pure, synchronous hooks under their mod id. Core code
// reaches a mod's stage state only through these hooks and never names a mod; the installed mod list registers them
// once at load (lib/mod-builtins.js). Every hook is optional:
//   catalogue(view)                                  -> the mod's own catalogue view with its built-in resources
//   configFields(fields)                             -> its settings page fields beyond the manifest's settingsSchema
//   admitParams(command,params,state,context,metadata,check) -> canonical params for an admitted command
//   applyStageState(state,command,params,metadata)   -> next stage draft, or undefined when the command is generic
//   promptState(own,command)                         -> the saved state the director sees for an admitted command
//   sourceMarker                                     -> {op, valid(op,unit,aliases)}: a source marker op it owns
//   promptActors(own,actor)                          -> own state with actor ids mapped to model handles
//   stageControls                                    -> {[handler]: {apply, operation, choices(command), instanceId(state)}}
//   performanceUses                                  -> capability edges the core performance may consume
//   applyProgress(state,progress)                    -> stage draft with the turn's measured progress folded in
//   directorTurn(chat,turn)                          -> {facts?, progress?} for the turn about to be directed
//   facts                                            -> {section, id, field}: the prompt section for this turn's facts
const contributions = new Map()

export function registerModStageContribution(modId, contribution) {
  contributions.set(modId, Object.freeze({...contribution, modId}))
}
export const modStageContribution = modId => contributions.get(modId)
export const modStageContributions = () => [...contributions.values()]

// Each contributing mod's facts and measured progress for the turn about to be directed, keyed by mod id.
export function modStageTurn(chat, turn) {
  const rows = {}
  for (const contribution of contributions.values()) {
    const value = contribution.directorTurn?.(chat, turn)
    if (value) rows[contribution.modId] = value
  }
  return rows
}
