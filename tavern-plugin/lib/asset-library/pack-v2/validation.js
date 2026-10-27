// Pack integrity and bounded media validation.
import { assetContentMedia } from '../shared/asset-variant-content.js'
import { PACK_BUDGET } from './budget.js'
import { imageKind, audioKind, imageDimensions, pngSize, wavInfo, STAGE_IMAGE_MAX_BYTES } from './media.js'
import path from 'node:path'
import { BLOB_MIME_TYPES, validatePackIdentities, validatePackDocuments, computeContentHash, computeBundleHash, canonicalJson, parseJson, sha256 } from '../asset-packs/index.js'
import { check, relativePath, compareCodePoints } from '../asset-packs/common.js'
import { validateStageSkin, stageSkinFiles } from '../../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { validateSkinSvg } from './skin-svg.js'

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
  // A bundle's hash follows its files; an unchanged bundle keeps its sealed identity.
  for (const [key, bundle] of Object.entries(manifest.bundles || {})) {
    const prefix = `bundles/${key}/`, entries = manifest.files.filter(file => file.path.startsWith(prefix))
    const old = previous?.manifest.files.filter(file => file.path.startsWith(prefix))
    const same = previous?.manifest.bundles?.[key] && old.length === entries.length && old.every((file, i) => file.path === entries[i].path && file.size === entries[i].size && file.sha256 === entries[i].sha256)
    bundle.contentHash = same ? previous.manifest.bundles[key].contentHash : await computeBundleHash(entries.map(file => ({...file, path:file.path.slice(prefix.length)})))
  }
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
  // A skin is checked once, here, when its bundle is written: the document (dsh.skin/1: closed, legible), its identity and
  // the files it declares - each present and nothing else beside it. Images take the media checks (a static SVG the inert
  // markup check), the skin's own faces are WOFF2 within 16 MiB, its sounds at most three seconds. Reads never check again.
  for (const [key, bundle] of Object.entries(manifest.bundles)) {
    const prefix = `bundles/${key}/`, entry = prefix + bundle.entry, names = [...files.keys()].filter(name => name.startsWith(prefix))
    const owner = asset => asset.kind === 'skins' && asset.bundleKey === key
    if (names.every(unchanged) && previous?.manifest.bundles?.[key] && previous.manifest.assets.find(owner)?.id === manifest.assets.find(owner)?.id) continue
    // An unchanged document was checked when it was written: the stored one is read, not checked again.
    let skin = unchanged(entry) ? previous.skins?.[previous.manifest.assets.find(owner)?.id] : null
    if (!skin) {
      const bytes = files.get(entry)
      check(bytes instanceof Uint8Array, entry, 'Stored bytes unavailable', 'ASSET_UNAVAILABLE')
      check(bytes.length <= 32768, entry, 'Skin document exceeds 32 KiB', 'LIMIT_EXCEEDED')
      try { skin = validateStageSkin(readDocument(bytes)) } catch (error) { check(false, entry, error.message, error.code || 'INVALID_SKIN') }
    }
    for (const asset of manifest.assets) if (asset.kind === 'skins' && asset.bundleKey === key) check(asset.id === skin.id, entry, 'Skin identity differs from its entry', 'INVALID_SKIN')
    const base = prefix + (path.posix.dirname(bundle.entry) === '.' ? '' : path.posix.dirname(bundle.entry) + '/')
    const declared = new Set(stageSkinFiles(skin).map(file => base + file))
    for (const file of declared) check(files.has(file), entry, 'Missing skin file: ' + file.slice(base.length), 'MISSING_DEPENDENCY')
    for (const name of names) {
      if (name === entry) continue
      check(declared.has(name), name, 'Undeclared skin file', 'FILE_CLOSURE_MISMATCH')
      if (unchanged(name)) continue
      const data = files.get(name), ext = path.posix.extname(name).slice(1)
      check(data instanceof Uint8Array, name, 'Stored bytes unavailable', 'ASSET_UNAVAILABLE')
      if (ext === 'svg') { try { validateSkinSvg(data) } catch (error) { check(false, name, error.message, 'INVALID_SKIN') } continue }
      if (ext === 'woff2') { check(data.length >= 48 && data.length <= 16 * 1024 ** 2 && Buffer.from(data.subarray(0, 4)).toString('latin1') === 'wOF2', name, 'Skin font face is not a WOFF2 file within 16 MiB', 'INVALID_SKIN'); continue }
      const info = await inspectMedia(data, {ext, mime:BLOB_MIME_TYPES[ext], size:data.length}, decodeMedia)
      if (!['png', 'webp'].includes(ext)) check(info.durationMs <= 3000, name, 'Skin sound exceeds three seconds', 'LIMIT_EXCEEDED')
    }
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
