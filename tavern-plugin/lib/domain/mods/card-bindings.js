import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {isModId,isModPackId} from './manifest.js'
const {modCheck:check,modShape:shape,modJson,modFreeze} = contract
const admitted=new WeakSet()

// This is the card-owner envelope. Manifest-specific field/slot checks belong to the mod library.
export function validateModCardBindings(input) {
  if (input===null || input===undefined) return null
  if (admitted.has(input)) return input
  modJson(input,1024*1024)
  shape(input,['version','mods'])
  check(input.version===1,'$.modBindings.version')
  shape(input.mods,Object.keys(input.mods || {}),[],'$.modBindings.mods')
  check(Object.keys(input.mods).length<=256,'$.modBindings.mods')
  for (const [modId,row] of Object.entries(input.mods)) {
    const at='$.modBindings.mods.'+modId
    check(isModId(modId),at)
    shape(row,['boundPackIds','packSettings'],['boundPackIds'],at)
    check(Array.isArray(row.boundPackIds) && row.boundPackIds.length<=4096 && row.boundPackIds.every(isModPackId) && new Set(row.boundPackIds).size===row.boundPackIds.length,at+'.boundPackIds')
    if (row.packSettings!==undefined) shape(row.packSettings,Object.keys(row.packSettings || {}),[],at+'.packSettings')
    for (const [packId,settings] of Object.entries(row.packSettings || {})) {
      check(isModPackId(packId),at+'.packSettings')
      shape(settings,Object.keys(settings || {}),[],at+'.packSettings.'+packId)
    }
  }
  const result=modFreeze(structuredClone(input))
  admitted.add(result)
  return result
}
