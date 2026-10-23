import { assertJson, shape, oneOf, check } from './asset-pack-json.js'
export { ASSET_PACK_ERROR_CODES } from './asset-pack-json.js'
// The entry kinds the built-in stage reads today. Further kinds arrive with the core that reads them.
export const ASSET_KINDS = Object.freeze(['backgrounds', 'music'])
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
export const SHORT_ID_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$'
export const HASH_PATTERN = '^[0-9a-f]{64}$'
const reserved = ['__proto__', 'prototype', 'constructor']
export function validateUuid(value, path = '$') { check(typeof value === 'string' && new RegExp(UUID_PATTERN).test(value), path, 'Expected canonical lowercase UUID', 'INVALID_REF'); return value }
export function validateShortId(value, path = '$') { check(typeof value === 'string' && new RegExp(SHORT_ID_PATTERN).test(value) && !reserved.includes(value), path, 'Invalid short ID', 'INVALID_REF'); return value }
export function validateHash(value, path = '$') { check(typeof value === 'string' && new RegExp(HASH_PATTERN).test(value), path, 'Expected lowercase SHA-256', 'INVALID_HASH'); return value }
function freezeSchema(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeSchema); Object.freeze(value) }
  return value
}
const refSchema = properties => freezeSchema({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const uuidSchema = { type: 'string', pattern: UUID_PATTERN }
const shortSchema = { type: 'string', pattern: SHORT_ID_PATTERN, not: { enum: reserved } }
export const ASSET_REF_SCHEMA = refSchema({ packId: uuidSchema, kind: { enum: ASSET_KINDS }, assetId: shortSchema })
export function validateAssetRef(value, path = '$', kind) {
  assertJson(value); shape(value, ['packId', 'kind', 'assetId'], ['packId', 'kind', 'assetId'], path)
  validateUuid(value.packId, path + '.packId'); oneOf(value.kind, kind ? [kind] : ASSET_KINDS, path + '.kind'); validateShortId(value.assetId, path + '.assetId')
  return value
}
// An entry is on (blue: constant, green: keyword recall) or off (enabled false).
export function assetEntryEnabled(asset) { return Boolean(asset) && asset.enabled === true }
// Both the service and its snapshot consumers use this exact resolution contract.
export function resolveAssetSnapshot(pack, ref) {
  const asset = pack?.manifest.assets.find(asset => asset.kind === ref.kind && asset.id === ref.assetId)
  return structuredClone({ref, value:asset || null, revision:pack?.revision ?? null, contentHash:pack?.manifest.contentHash ?? null,
    diagnostics:!asset ? ['asset-missing'] : !assetEntryEnabled(asset) ? ['asset-disabled'] : []})
}
export function assetRefKey(value) { validateAssetRef(value); return `${value.packId}/${value.kind}/${value.assetId}` }
