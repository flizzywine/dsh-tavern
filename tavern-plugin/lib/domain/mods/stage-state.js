import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {modStageContribution} from './stage-contributions.js'
const {modCheck:check,modJson,modPlain:plain}=contract

// A compiled state choice is folded in the native director transaction, not a late callback; a contributing mod folds
// its own admitted commands first.
export function applyModStageState(state,command,params,metadata={}) {
  const contributed=modStageContribution(command.modId)?.applyStageState?.(state,command,params,metadata)
  if(contributed)return contributed
  const change=command.admission?.state
  if(!change)return state
  const selected=change.choices.find(row=>row.value===params[change.parameter])
  check(selected,'$.params.'+change.parameter,'State choice is unavailable','MOD_PERMISSION_DENIED')
  check(plain(selected.patch),'$.state','Expected a state patch')
  modJson(selected.patch,16384)
  return {...state,modState:{...state.modState,[command.modId]:{...state.modState?.[command.modId],...structuredClone(selected.patch)}}}
}

// Omitted capabilities retain saved values without sending unusable choices or text.
export function modStagePromptState(state,commands=[]) {
  const selected={}
  for(const command of commands) {
    const own=state.modState?.[command.modId],change=command.admission?.state
    const contributed=own && modStageContribution(command.modId)?.promptState?.(own,command)
    if(contributed)Object.assign(selected[command.modId] ||= {},contributed)
    if(!own || !change)continue
    const fields=new Set(change.choices.flatMap(row=>Object.keys(row.patch)))
    for(const field of fields)if(Object.hasOwn(own,field)) (selected[command.modId] ||= {})[field]=own[field]
  }
  return Object.keys(selected).length?{mods:selected}:{}
}
