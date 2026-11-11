// Opt-in Card Preparation helpers. No direct raw/resource writes or runtime registration.
import { validateCardVariableBindings } from './variable-bindings/index.js'
import { rawData } from './card-preparation.js'
import { validateCardStage } from './card-stage-settings.js'
import { validateCardOpenings } from './card-opening-scenes.js'
import { assertJson, check, shape, text, version, array, unique, object, cloneJson, canonicalJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import { validateUuid } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
export function validateCardAssetExtension(value, path = '$.dsh_tavern') {
  assertJson(value); check(object(value), path); version(value.schemaVersion, path + '.schemaVersion')
  // retired character data is rejected, not preserved as an opaque extension.
  check(!Object.hasOwn(value, 'emotions'), path + '.emotions', 'Emotions belong to figures', 'UNKNOWN_FIELD')
  // Other Card Preparation fields are opaque and must survive export unchanged.
  check(!Object.hasOwn(value, 'characters'), path + '.characters', 'Card cast is removed; migrate explicitly', 'UNKNOWN_FIELD')
  // the per-card 读音词典 is removed; readings are global presets (dsh-tts).
  check(!Object.hasOwn(value, 'readings'), path + '.readings', 'Card readings are removed; migrate explicitly', 'UNKNOWN_FIELD')
  const bindings = value.assetBindings
  shape(bindings, ['boundPackIds'], ['boundPackIds'], path + '.assetBindings')
  if(value.modConfigPackId!==undefined){validateUuid(value.modConfigPackId);check(bindings.boundPackIds.includes(value.modConfigPackId),path+'.modConfigPackId','Config pack must be bound','UNBOUND_PACK')}
  if (value.variableBindings !== undefined) validateCardVariableBindings(value.variableBindings)
  array(bindings.boundPackIds, path + '.assetBindings.boundPackIds'); bindings.boundPackIds.forEach(id => validateUuid(id)); unique(bindings.boundPackIds, path + '.assetBindings.boundPackIds')
  // The card's skin value may name any pack skin (本卡皮肤 also offers globally enabled packs'); one whose pack is off or missing
  // falls back when it is drawn (cardStageSkin), never here.
  if (value.stage !== undefined) validateCardStage(value.stage, path + '.stage')
  if (value.openings !== undefined) validateCardOpenings(value.openings, path + '.openings')
  return value
}
export function cardAssetExtensionPointer(raw) { return (rawData(raw) === raw ? '' : '/data') + '/extensions/dsh_tavern' }
export function readCardAssetExtension(raw) {
  assertJson(raw)
  const data = rawData(raw)
  if (data.extensions === undefined) return undefined
  check(object(data.extensions), '$.extensions')
  if (!Object.hasOwn(data.extensions, 'dsh_tavern')) return undefined
  // The stage was checked when it was written or imported; a read keeps fields this version does not know.
  return cloneJson(data.extensions.dsh_tavern)
}
export function cardAssetRawOperations(raw, patch) {
  assertJson(raw); assertJson(patch)
  shape(patch, ['assetBindings', 'stage', 'openings', 'variableBindings','modConfigPackId'], [], '$.patch')
  if (Object.hasOwn(patch, 'stage')) validateCardStage(patch.stage)
  const data = rawData(raw), pointer = cardAssetExtensionPointer(raw)
  if (data.extensions !== undefined) check(object(data.extensions), '$.extensions')
  const existing = data.extensions?.dsh_tavern
  // An extension the mod system opened (modSystem only) has no schemaVersion yet; this write stamps it.
  if (existing !== undefined) { check(object(existing), pointer); if (existing.schemaVersion !== undefined) version(existing.schemaVersion, pointer + '.schemaVersion') }
  // the retired per-card director commands (stage.dimensions) cannot be written —
  // a stage patch may only carry an old card's stored value through unchanged (stage patches replace the whole object).
  if (patch.stage?.dimensions !== undefined) check(canonicalJson(patch.stage.dimensions) === canonicalJson(existing?.stage?.dimensions ?? null),
    '$.patch.stage.dimensions', 'Director commands are a global setting', 'UNKNOWN_FIELD')
  const next = { schemaVersion: 1, ...(existing || {}), ...cloneJson(patch) }
  // Asset lamp edits do not unbind the card's private config storage.
  if(existing?.modConfigPackId && patch.assetBindings && !Object.hasOwn(patch,'modConfigPackId'))next.assetBindings.boundPackIds=[...new Set([...next.assetBindings.boundPackIds,existing.modConfigPackId])]
  // New opt-ins have no legacy stage behavior to preserve. Stage patches replace
  // the whole preference object so omitting an override restores inheritance.
  validateCardAssetExtension(next)
  return data.extensions === undefined
    ? [{ op: 'set', path: pointer.slice(0, -'/dsh_tavern'.length), value: { dsh_tavern: next } }]
    : [{ op: 'set', path: pointer, value: next }]
}
