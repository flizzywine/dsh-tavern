import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {modSettingValue} from './settings.js'
const {modCheck:check,modShape:shape,modJson,modFreeze} = contract
const validatedDefaults = new WeakMap()

// Only identities change. Display text, short aliases and immutable executable bytes do not.
export function remapModIdentity(document, from, to, packIds = {}) {
  const value = structuredClone(document)
  function visit(item) {
    if (!item || typeof item !== 'object') return
    if (item.modId === from && (item.format === 'dsh-mod-pack' || (item.packId && item.kind && item.entryId) || item.library === 'mod')) item.modId = to
    if (item.packId && Object.hasOwn(packIds,item.packId) && item.modId === to) item.packId = packIds[item.packId]
    if (item.format === 'dsh-mod-pack' && Object.hasOwn(packIds,item.id)) item.id = packIds[item.id]
    for (const child of Object.values(item)) visit(child)
  }
  if (value.format === 'dsh-mod') {
    value.id = to
    for (const command of value.commands) if (command.op.startsWith('mod.' + from + '.')) command.op = 'mod.' + to + command.op.slice(('mod.' + from).length)
  }
  visit(value)
  return value
}

export function validateModDefaults(values, manifest) {
  if (validatedDefaults.get(values) === manifest) return values
  modJson(values)
  shape(values,manifest.settingsSchema.fields.map(field => field.key),[],'$.settings')
  for (const [key,value] of Object.entries(values)) check(modSettingValue(manifest.settingsSchema.fields.find(field => field.key === key),value,manifest.id), '$.settings.' + key, 'Invalid shared default')
  const result=modFreeze(structuredClone(values))
  validatedDefaults.set(result,manifest)
  return result
}
