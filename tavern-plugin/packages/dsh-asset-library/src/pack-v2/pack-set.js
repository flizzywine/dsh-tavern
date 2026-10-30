// 素材包合集 — several whole packs in one transfer ZIP, the batch export of the
// 素材库 and an import of 「获取素材包」. Layout as in a card bundle: `packs/<packId>/manifest.json` plus that pack's files, and
// one root document listing the packs and the path/size closure. The outer list carries no digest: ZIP CRC covers
// transport corruption, the transfer is hashed once as a whole (the import's uploadHash / a download's archiveSha256) and
// every embedded pack is authenticated by importPack against its own manifest, exactly like a single-pack ZIP.
import { check, validateUuid, validateHash } from '../asset-packs/common.js'
import { jsonBytes, readDocument } from './validation.js'

export const PACK_SET_ROOT = 'dsh-tavern-pack-set.json'
const FORMAT = 'dsh-tavern-pack-set'

export const isPackSet = files => !files.has('manifest.json') && files.has(PACK_SET_ROOT)

// packs: [{manifest, files}] as exported (manifest.json is written from the manifest).
export function packSetFiles(packs) {
  const files = new Map()
  for (const pack of packs) {
    files.set(`packs/${pack.manifest.id}/manifest.json`, jsonBytes(pack.manifest))
    for (const [name, bytes] of pack.files) files.set(`packs/${pack.manifest.id}/${name}`, bytes)
  }
  const root = {format:FORMAT, schemaVersion:1, packs:packs.map(p => ({packId:p.manifest.id, contentHash:p.manifest.contentHash})), files:[...files].map(([path, bytes]) => ({path, size:bytes.length}))}
  files.set(PACK_SET_ROOT, jsonBytes(root))
  return files
}

// files: every entry of the outer ZIP (consumed). Returns [{manifest, files}] in the listed order, still unauthenticated.
export function readPackSet(files) {
  const root = readDocument(files.get(PACK_SET_ROOT)); files.delete(PACK_SET_ROOT)
  check(root?.format === FORMAT && root.schemaVersion === 1, '$', 'Unsupported pack set', 'INVALID_PATH')
  check(Object.keys(root).every(k => ['format','schemaVersion','packs','files'].includes(k)), '$', 'Unknown pack set field', 'UNKNOWN_FIELD')
  check(Array.isArray(root.packs) && root.packs.length > 0 && Array.isArray(root.files), '$.packs', 'Pack set lists no packs')
  check(files.size === root.files.length, '$.files', 'Pack set file closure mismatch', 'FILE_CLOSURE_MISMATCH')
  const seen = new Set()
  for (const item of root.files) {
    check(item && Object.keys(item).every(k => ['path','size'].includes(k)) && !seen.has(item.path), '$.files', 'Invalid file declaration')
    seen.add(item.path)
    check(files.get(item.path)?.length === item.size, item.path, 'Pack set file/size mismatch', 'FILE_CLOSURE_MISMATCH')
  }
  const ids = new Set(), packs = []
  for (const entry of root.packs) {
    check(entry && Object.keys(entry).every(k => ['packId','contentHash'].includes(k)), '$.packs', 'Invalid pack declaration')
    validateUuid(entry.packId); validateHash(entry.contentHash)
    check(!ids.has(entry.packId), '$.packs', 'Duplicate pack in set', 'DUPLICATE_ID'); ids.add(entry.packId)
    const prefix = `packs/${entry.packId}/`, data = new Map()
    for (const [name, bytes] of files) if (name.startsWith(prefix)) { data.set(name.slice(prefix.length), bytes); files.delete(name) }
    const manifest = readDocument(data.get('manifest.json') || new Uint8Array()); data.delete('manifest.json')
    check(manifest?.id === entry.packId && manifest.contentHash === entry.contentHash, '$.packs', 'Pack identity/hash mismatch', 'FILE_CLOSURE_MISMATCH')
    packs.push({manifest, files:data})
  }
  check(files.size === 0, '$', 'Undeclared pack set content', 'FILE_CLOSURE_MISMATCH')
  return packs
}
