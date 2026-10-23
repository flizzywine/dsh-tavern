// Pack integrity and bounded media validation.
import { assetContentMedia } from '../shared/asset-variant-content.js'
import { PACK_BUDGET } from './budget.js'
import { imageKind, audioKind, imageDimensions, pngSize, wavInfo, STAGE_IMAGE_MAX_BYTES } from './media.js'
import { BLOB_MIME_TYPES, validatePackIdentities, validatePackDocuments, computeContentHash, canonicalJson, parseJson, sha256 } from '../asset-packs/index.js'
import { check, relativePath, compareCodePoints } from '../asset-packs/common.js'

export const PACK_LIMITS = Object.freeze({ entries:20000, entrySize:512 * 1024 ** 2, ...PACK_BUDGET })
export const jsonBytes = value => Buffer.from(canonicalJson(value))
export const readDocument = bytes => parseJson(new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes))
// Internal references are never accepted from uploads; they retain validated stored identities.
export class StoredFile {
  constructor(size) { this.length = size; Object.freeze(this) }
}
export function budget(files, limits) {
  check(files instanceof Map && files.size <= limits.entries, '$.files', 'File count budget exceeded', 'LIMIT_EXCEEDED')
  let total = 0
  for (const [name, bytes] of files) {
    relativePath(name)
    check((bytes instanceof Uint8Array || bytes instanceof StoredFile) && Number.isSafeInteger(bytes.length) && bytes.length >= 0 && bytes.length <= limits.entrySize, name, 'File size budget exceeded', 'LIMIT_EXCEEDED')
    total += bytes.length
  }
  check(total <= limits.totalSize, '$.files', 'Pack budget exceeded', 'LIMIT_EXCEEDED')
  return total
}
// The built-in structural validator (media.js decodeMedia) checks compressed codecs.
export async function inspectMedia(input, descriptor, decodeMedia) {
  const bytes = Buffer.from(input), ext = imageKind(bytes) || audioKind(bytes)
  check(ext && descriptor.ext === ext && descriptor.mime === BLOB_MIME_TYPES[ext] && descriptor.size === bytes.length, '$.blobs', 'Media signature/ext/MIME mismatch')
  const image = descriptor.mime.startsWith('image/')
  check(bytes.length <= (image ? STAGE_IMAGE_MAX_BYTES : 60 * 1024 ** 2), '$.media', 'Media byte limit', 'LIMIT_EXCEEDED')
  const dimensions = image ? imageDimensions(bytes, ext) : null
  if (dimensions) check(dimensions.every(n => Number.isInteger(n) && n > 0 && n <= 8192) && dimensions[0] * dimensions[1] <= 32 * 1024 ** 2, '$.media', 'Image dimensions exceed limit', 'LIMIT_EXCEEDED')
  let decoded
  if (ext === 'png' && !(bytes[28] === 1 && decodeMedia)) decoded = pngSize(bytes)
  else if (ext === 'wav') decoded = wavInfo(bytes)
  else {
    check(typeof decodeMedia === 'function', '$.media', 'A trusted media validator is required for ' + ext, 'ASSET_UNAVAILABLE')
    decoded = await decodeMedia(bytes, {...descriptor})
  }
  if (image) check(decoded && decoded.width === dimensions[0] && decoded.height === dimensions[1], '$.media', 'Validated image dimensions mismatch')
  else check(Number.isFinite(decoded?.durationMs) && decoded.durationMs > 0, '$.media', 'Invalid audio duration')
  return decoded
}
// `hashed` (path -> sha256) holds digests the same edit just computed from these exact bytes (CAS names); they are reused, not recomputed.
export async function sealPack(manifest, files, previous, hashed) {
  const prior = new Map((previous?.manifest.files || []).map(file => [file.path, file]))
  const listed = new Set((manifest.files || []).map(file => file.path))
  const names = [...listed].filter(name => files.has(name)).concat([...files.keys()].filter(name => !listed.has(name)).sort(compareCodePoints))
  manifest.files = await Promise.all(names.map(async path => previous?.files.get(path) === files.get(path) && prior.has(path) ? prior.get(path) : {path, size:files.get(path).length, sha256:hashed?.get(path) ?? await sha256(files.get(path))}))
  manifest.contentHash = await computeContentHash(manifest)
  return {manifest, files}
}
// Every write is sealed by the service from the bytes themselves; only new or changed media is opened again.
export async function verifyBytes(manifest, files, {limits = PACK_LIMITS, decodeMedia, previous} = {}) {
  const total = budget(files, limits)
  validatePackIdentities([manifest])
  const manifestSize = jsonBytes(manifest).length
  check(files.size + 1 <= limits.entries, '$.files', 'File count budget exceeded', 'LIMIT_EXCEEDED')
  check(manifestSize <= limits.entrySize, 'manifest.json', 'File size budget exceeded', 'LIMIT_EXCEEDED')
  check(total + manifestSize <= limits.totalSize, '$.files', 'Pack budget exceeded', 'LIMIT_EXCEEDED')
  validatePackDocuments({manifest})
  const unchanged = name => previous?.files.has(name) && previous.files.get(name) === files.get(name)
  for (const [hash, descriptor] of Object.entries(manifest.blobs)) {
    const name = `media/${hash}.${descriptor.ext}`, bytes = files.get(name)
    if (descriptor.mime.startsWith('image/')) check(bytes.length <= STAGE_IMAGE_MAX_BYTES, name, 'Stage media byte limit', 'LIMIT_EXCEEDED')
    if (!unchanged(name) || !previous.manifest.blobs[hash] || canonicalJson(previous.manifest.blobs[hash]) !== canonicalJson(descriptor)) {
      check(bytes instanceof Uint8Array, name, 'Stored bytes unavailable', 'ASSET_UNAVAILABLE')
      await inspectMedia(bytes, descriptor, decodeMedia)
    }
  }
  for (const [name, bytes] of files) if (name.startsWith('credits/')) {
    check(bytes.length <= 16 * 1024 ** 2, name, 'Reference text limit', 'LIMIT_EXCEEDED')
    if (!unchanged(name)) new TextDecoder('utf-8', {fatal:true}).decode(bytes)
  }
  // Retain the established per-use byte limits in addition to the aggregate cap.
  for (const asset of manifest.assets) if (asset.kind === 'backgrounds') for (const {hash} of assetContentMedia(asset)) check(manifest.blobs[hash].size <= 4 * 1024 ** 2, '$.backgrounds', 'Background byte limit', 'LIMIT_EXCEEDED')
  return {manifest, files}
}
export function packDiff(before, after) {
  const changes = (left, right, key) => {
    const a = new Map(left.map(v => [key(v), v])), b = new Map(right.map(v => [key(v), v]))
    return {added:[...b.keys()].filter(k => !a.has(k)), removed:[...a.keys()].filter(k => !b.has(k)), changed:[...b.keys()].filter(k => a.has(k) && canonicalJson(a.get(k)) !== canonicalJson(b.get(k)))}
  }
  return {metadataChanged:before?.contentHash !== after?.contentHash, assets:changes(before?.assets || [], after?.assets || [], a => a.kind + '/' + a.id), files:changes(before?.files || [], after?.files || [], f => f.path), affectedCards:{status:'unknown'}}
}
