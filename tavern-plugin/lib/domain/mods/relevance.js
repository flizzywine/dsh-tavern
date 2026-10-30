import { promptSection } from '../prompt-section.js'
import {modTurnActive} from './catalogue.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "; omission keeps this stage state."
})


export function selectModAdmission(manifests,catalogues) {
  return {mods:manifests.map(manifest=>{
    const catalogue=catalogues[manifest.id],selected=modTurnActive(manifest,catalogue)
    return {id:manifest.id,reason:selected ? manifest.admission.entryKinds.length ? 'lamp' : 'direct' : null,selected}
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)}
}

export function modKeepFragments(manifests,selection,stageState={}) {
  const selected=new Set(selection.mods.filter(row=>row.selected).map(row=>row.id))
  return manifests.filter(manifest=>!selected.has(manifest.id) && Object.values(stageState[manifest.id] || {}).some(value=>value!==null && value!==false && value!==''))
    .map(manifest=>({modId:manifest.id,id:'persistent-keep',type:'prompt',source:'stage.modState',
      text:promptSection('mod_state',manifest.id+': keep '+Object.keys(stageState[manifest.id]).join(',')+PROMPT_PROSE.p001),placement:{section:'director.rules.presentation',order:0}}))
}
