import { assertJson, check, shape, oneOf, object, text } from './asset-pack-json.js'
export { ASSET_PACK_ERROR_CODES } from './asset-pack-json.js'
export const ASSET_PACK_FORMAT = 'asset-packs-v1'
// CG is an independent image asset, never a background alias.
export const ASSET_KINDS = Object.freeze(['backgrounds', 'music', 'sfx', 'ambience', 'looks', 'widgets', 'skins', 'performances', 'cg', 'props', 'directions', 'audience', 'timers', 'entrances', 'videos'])
export const TIMES_OF_DAY = Object.freeze(['day', 'dusk', 'night'])
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
export const SHORT_ID_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$'
export const HASH_PATTERN = '^[0-9a-f]{64}$'
const reserved = ['__proto__', 'prototype', 'constructor']
export function validateUuid(value, path = '$') { check(typeof value === 'string' && new RegExp(UUID_PATTERN).test(value), path, 'Expected canonical lowercase UUID', 'INVALID_REF'); return value }
export function validateShortId(value, path = '$') { check(typeof value === 'string' && new RegExp(SHORT_ID_PATTERN).test(value) && !reserved.includes(value), path, 'Invalid short ID', 'INVALID_REF'); return value }
export function validateStateId(value, path = '$') { check(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,159}$/.test(value) && !reserved.includes(value), path, 'Invalid state ID', 'INVALID_REF'); return value }
export function validateHash(value, path = '$') { check(typeof value === 'string' && new RegExp(HASH_PATTERN).test(value), path, 'Expected lowercase SHA-256', 'INVALID_HASH'); return value }
export function validateTimeOfDay(value, path = '$') { oneOf(value, TIMES_OF_DAY, path); return value }
function freezeSchema(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeSchema); Object.freeze(value) }
  return value
}
const refSchema = properties => freezeSchema({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const uuidSchema = { type: 'string', pattern: UUID_PATTERN }
const shortSchema = { type: 'string', pattern: SHORT_ID_PATTERN, not: { enum: reserved } }
export const ASSET_REF_SCHEMA = refSchema({ packId: uuidSchema, kind: { enum: ASSET_KINDS }, assetId: shortSchema })
export const FIGURE_REF_SCHEMA = refSchema({ packId: uuidSchema, figureId: uuidSchema })
export const OUTFIT_REF_SCHEMA = refSchema({ ...FIGURE_REF_SCHEMA.properties, outfitKey: shortSchema })
export const TIME_OF_DAY_SCHEMA = Object.freeze({ enum: TIMES_OF_DAY })
export function validateAssetRef(value, path = '$', kind) {
  assertJson(value); shape(value, ['packId', 'kind', 'assetId'], ['packId', 'kind', 'assetId'], path)
  validateUuid(value.packId, path + '.packId'); oneOf(value.kind, kind ? [kind] : ASSET_KINDS, path + '.kind'); validateShortId(value.assetId, path + '.assetId')
  return value
}
export function validateFigureRef(value, path = '$') {
  assertJson(value); shape(value, ['packId', 'figureId'], ['packId', 'figureId'], path)
  validateUuid(value.packId, path + '.packId'); validateUuid(value.figureId, path + '.figureId'); return value
}
export function validateOutfitRef(value, path = '$') {
  assertJson(value); shape(value, ['packId', 'figureId', 'outfitKey'], ['packId', 'figureId', 'outfitKey'], path)
  validateFigureRef({ packId: value.packId, figureId: value.figureId }, path); validateShortId(value.outfitKey, path + '.outfitKey'); return value
}
// standalone skin entries carry no enabled flag; every imported skin is usable.
export function assetEntryEnabled(asset) { return Boolean(asset) && (asset.kind === 'skins' || asset.enabled === true) }
// Both the authorized service and its snapshot consumer use this exact resolution contract.
export function resolveAssetSnapshot(pack, ref) {
  const asset = pack?.manifest.assets.find(asset => asset.kind === ref.kind && asset.id === ref.assetId)
  return structuredClone({ref, value:asset || null, revision:pack?.revision ?? null, contentHash:pack?.manifest.contentHash ?? null,
    diagnostics:!asset ? ['asset-missing'] : !assetEntryEnabled(asset) ? ['asset-disabled'] : []})
}
export function resolveFigureSnapshot(pack, ref) {
  const figure = pack?.figures[ref.figureId]
  return structuredClone({ref, value:figure || null, voiceSpec:figure?.voice ? pack.manifest.voiceLibrary?.voices[figure.voice.voice] : null,
    revision:pack?.revision ?? null, contentHash:pack?.manifest.contentHash ?? null,
    diagnostics:!figure ? ['figure-missing'] : !figure.enabled ? ['figure-disabled'] : []})
}
export function assetRefKey(value) { validateAssetRef(value); return `${value.packId}/${value.kind}/${value.assetId}` }
export function validateSceneSelection(value, path = '$') {
  assertJson(value)
  shape(value, ['background', 'timeOfDay', 'variant'], ['background', 'timeOfDay'], path)
  validateAssetRef(value.background, path + '.background', 'backgrounds')
  if (value.timeOfDay !== null) validateTimeOfDay(value.timeOfDay, path + '.timeOfDay')
  if (value.variant !== undefined) validateShortId(value.variant,path + '.variant')
  return value
}
// Inert persistent identity slice. Reducers, candidate authorization and visual state remain P3/P4.
export function validateAssetPackState(value, path = '$') {
  assertJson(value)
  shape(value, ['format', 'scene', 'music', 'lighting', 'actors', 'soundscape', 'widgets', 'skin'], ['format', 'scene', 'music', 'lighting', 'actors', 'soundscape', 'widgets'], path)
  if (Object.hasOwn(value,'skin')) {
    shape(value.skin,['ref','level'],['ref'],path + '.skin')
    if (Object.hasOwn(value.skin,'level')) check(value.skin.ref !== null && [1,2,3].includes(value.skin.level),path + '.skin.level')
    if (value.skin.ref !== null) validateAssetRef(value.skin.ref,path + '.skin.ref','skins')
  }
  oneOf(value.format, [ASSET_PACK_FORMAT], path + '.format')
  if (value.scene !== null) {
    const s = value.scene
    shape(s, ['background', 'timeOfDay', 'timeLook', 'variant'], ['background', 'timeOfDay', 'timeLook'], path + '.scene')
    check(s.timeLook===null,path + '.scene.timeLook','Time lighting is global')
    validateSceneSelection({ background: s.background, timeOfDay: s.timeOfDay, ...(s.variant === undefined ? {} : {variant:s.variant}) }, path + '.scene')
  }
  if (value.music !== null) validateAssetRef(value.music, path + '.music', 'music')
  shape(value.lighting, ['time', 'mood'], ['time', 'mood'], path + '.lighting')
  shape(value.lighting.time, ['mode', 'ref'], ['mode', 'ref'], path + '.lighting.time')
  oneOf(value.lighting.time.mode, ['auto'], path + '.lighting.time.mode')
  check(value.lighting.time.ref === null,path + '.lighting.time.ref','Time lighting is global')
  if(value.lighting.mood !== null)validateAssetRef(value.lighting.mood,path + '.lighting.mood','looks')
  if (value.scene === null || value.scene.timeOfDay === null) check(value.lighting.time.ref === null, path + '.lighting.time.ref')
  for (const key of ['actors', 'soundscape', 'widgets']) check(object(value[key]), path + '.' + key)
  for (const [alias, actor] of Object.entries(value.actors)) {
    text(alias, path + '.actors', 160)
    shape(actor, ['figure', 'outfitKey'], ['figure', 'outfitKey'], path + '.actors.' + alias)
    if (actor.figure !== null) validateFigureRef(actor.figure)
    if (actor.outfitKey !== null) { check(actor.figure !== null, path + '.actors.' + alias); validateShortId(actor.outfitKey) }
  }
  for (const ref of Object.values(value.soundscape)) validateAssetRef(ref, path + '.soundscape', 'ambience')
  for (const widget of Object.values(value.widgets)) {
    shape(widget, ['ref', 'state'], ['ref', 'state'], path + '.widgets')
    validateAssetRef(widget.ref, path + '.widgets.ref', 'widgets'); check(object(widget.state), path + '.widgets.state')
  }
  return value
}
