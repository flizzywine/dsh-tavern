import { assertJson, check, shape, text, integer, bool, oneOf, array, unique, extensions, record, relativePath, validateUuid, validateShortId, validateHash, ASSET_KINDS } from './common.js'
import { validateFiles } from './hash.js'
import { ASSET_CONTENT_FIELDS, assetContentMedia } from '../shared/asset-variant-content.js'
// Canonical extensions only. Signatures/decoding and transport budgets belong to the storage service.
export const BLOB_MIME_TYPES = Object.freeze({ png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac' })
export function validateBlob(value, path = '$') {
  assertJson(value)
  shape(value, ['ext', 'mime', 'size'], ['ext', 'mime', 'size'], path)
  check(Object.hasOwn(BLOB_MIME_TYPES, value.ext) && value.mime === BLOB_MIME_TYPES[value.ext], path, 'Noncanonical blob ext/MIME')
  integer(value.size, path + '.size', 1); return value
}
// The lamp: constant is blue (always offered), keyword is green (offered when the story names it).
export function validateRecall(value, path = '$', minKeywordLength = 2) {
  assertJson(value)
  shape(value, ['mode', 'keywords', 'synonyms'], ['mode', 'keywords'], path)
  oneOf(value.mode, ['constant', 'keyword'], path + '.mode'); array(value.keywords, path + '.keywords', 16)
  for (const word of value.keywords) text(word, path + '.keywords', 40, minKeywordLength)
  unique(value.keywords, path + '.keywords')
  if (value.synonyms !== undefined) record(value.synonyms, path + '.synonyms', (words, p, key) => {
    check(value.keywords.includes(key), p, 'Synonym must belong to a keyword'); array(words, p, 6)
    words.forEach(word => text(word, p, 40, minKeywordLength)); unique(words, p)
  })
  return value
}
const metadata = ['description', 'category', 'aliases', 'author', 'license', 'credits', 'extensions']
function validateMetadata(value, path) {
  for (const key of ['description', 'author', 'license']) if (value[key] !== undefined) text(value[key], path + '.' + key, 4096, 0)
  if (value.category !== undefined) {
    // Categories are library tags.
    const tags = Array.isArray(value.category) ? value.category : [value.category]
    array(tags, path + '.category', 32); unique(tags, path + '.category')
    tags.forEach(tag => text(tag, path + '.category', 4096, 1))
  }
  if (value.aliases !== undefined) { array(value.aliases, path + '.aliases', 128); value.aliases.forEach(v => text(v, path + '.aliases', 160)) }
  if (value.credits !== undefined) { array(value.credits, path + '.credits', 128); value.credits.forEach(v => relativePath(v, path + '.credits')) }
  if (value.extensions !== undefined) extensions(value.extensions, path + '.extensions')
}
export function validateAsset(value, path = '$') {
  assertJson(value)
  const common = ['kind', 'id', 'name', 'enabled', 'recall', 'directorNote']
  check(value && ASSET_KINDS.includes(value.kind), path + '.kind')
  shape(value, [...common, 'remark', ...metadata.filter(field => !ASSET_CONTENT_FIELDS[value.kind].includes(field)), ...ASSET_CONTENT_FIELDS[value.kind]], common, path)
  validateShortId(value.id, path + '.id'); text(value.name, path + '.name'); bool(value.enabled, path + '.enabled')
  if (value.remark !== undefined) check(typeof value.remark === 'string', path + '.remark')
  validateRecall(value.recall, path + '.recall'); text(value.directorNote, path + '.directorNote', 300, 0); validateMetadata(value, path)
  validateAssetContent(value.kind, Object.fromEntries(ASSET_CONTENT_FIELDS[value.kind].filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])), path)
  return value
}
export function validateAssetContent(kind, content, path = '$') {
  check(Object.hasOwn(ASSET_CONTENT_FIELDS, kind), path, 'Unknown asset kind')
  shape(content, ASSET_CONTENT_FIELDS[kind], [], path)
  const value = {...content, kind}
  validateHash(value.media, path + '.media')
  if (value.usage !== undefined) text(value.usage, path + '.usage', 300, 0)
  if (value.tags !== undefined) { array(value.tags, path + '.tags', 32); value.tags.forEach(t => text(t, path + '.tags', 80)) }
  if (value.volume !== undefined) check(Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1, path + '.volume')
  if (value.loopStart !== undefined || value.loopEnd !== undefined) {
    check(Number.isFinite(value.loopStart) && value.loopStart >= 0, path + '.loopStart', 'Loop points require a nonnegative start in seconds')
    check(Number.isFinite(value.loopEnd) && value.loopEnd > value.loopStart, path + '.loopEnd', 'Loop end must follow loop start in seconds')
  }
  return content
}
// figures/sprites/bundles keep the portable pack format; their documents arrive with the cores that read them.
export function validatePackManifest(value, path = '$') {
  assertJson(value)
  const required = ['format', 'schemaVersion', 'id', 'name', 'contentHash', 'assets', 'figures', 'sprites', 'bundles', 'blobs', 'files']
  shape(value, [...required, ...metadata], required, path)
  oneOf(value.format, ['dsh-asset-pack'], path + '.format'); check([1,2].includes(value.schemaVersion), path + '.schemaVersion', 'Unsupported schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION')
  validateUuid(value.id, path + '.id'); text(value.name, path + '.name'); validateHash(value.contentHash, path + '.contentHash'); validateMetadata(value, path)
  array(value.assets, path + '.assets'); value.assets.forEach((asset, i) => validateAsset(asset, `${path}.assets[${i}]`))
  unique(value.assets.map(a => `${a.kind}/${a.id}`), path + '.assets')
  array(value.figures, path + '.figures'); check(!value.figures.length, path + '.figures', 'Figures are not stored yet', 'UNKNOWN_FIELD')
  record(value.sprites, path + '.sprites', (_file, p) => check(false, p, 'Sprites are not stored yet', 'UNKNOWN_FIELD'))
  record(value.bundles, path + '.bundles', (_bundle, p) => check(false, p, 'Bundles are not stored yet', 'UNKNOWN_FIELD'))
  record(value.blobs, path + '.blobs', (blob, p, hash) => { validateHash(hash, p); validateBlob(blob, p) })
  validateFiles(value.files, path + '.files')
  const files = new Map(value.files.map(file => [file.path, file]))
  check(!files.has('manifest.json'), path + '.files', 'Manifest cannot hash itself', 'FILE_CLOSURE_MISMATCH')
  const declared = file => check(files.has(file), path + '.files', 'Missing declared file: ' + file, 'FILE_CLOSURE_MISMATCH')
  const mediaFiles = new Set()
  for (const [hash, blob] of Object.entries(value.blobs)) {
    const file = `media/${hash}.${blob.ext}`; declared(file); mediaFiles.add(file)
    check(files.get(file).sha256 === hash && files.get(file).size === blob.size, path + '.blobs.' + hash, 'Blob/file mismatch', 'FILE_CLOSURE_MISMATCH')
  }
  for (const file of files.keys()) {
    const [root] = file.split('/')
    check(root === 'credits' && file.startsWith('credits/') || root === 'media' && mediaFiles.has(file), path + '.files', 'Undeclared file namespace: ' + file, 'FILE_CLOSURE_MISMATCH')
  }
  if (value.credits) value.credits.forEach(declared)
  const blobRef = (hash, type) => { const blob = value.blobs[hash]; check(blob && (!type || blob.mime.startsWith(type)), path + '.assets', 'Missing or wrong-kind blob: ' + hash, 'MISSING_DEPENDENCY') }
  for (const asset of value.assets) {
    for (const {hash, type} of assetContentMedia(asset)) blobRef(hash, type)
    asset.credits?.forEach(declared)
  }
  return value
}
export function validatePackIdentities(manifests) {
  array(manifests, '$'); manifests.forEach(value => validatePackManifest(value))
  unique(manifests.map(value => value.id), '$.packIds')
  return manifests
}
