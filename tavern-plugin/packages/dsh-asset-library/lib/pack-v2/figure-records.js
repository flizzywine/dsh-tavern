import {sha256, computeContentHash} from '../asset-packs/index.js'
import {figureNameKey} from '../asset-packs/figure-names.js'

// A figure whose name, 触发词 and outfit names live in a character record (the host's figureRecords option: the 配图
// 人物库) is stored without them. Reads put the record's identity back, so everything above storage sees whole
// figures; writes hand each whole figure to the host, which keeps its identity in the record and returns the document
// to store. The manifest hashes the whole figure, never the stored bytes.
export const FIGURE_DOCUMENT = /^packs\/([0-9a-f-]{36})\/figures\/([0-9a-f-]{36})\.json$/
// A stored identity-less figure read while its record cannot be read: shown under this name, never written back.
export const FIGURE_RECORD_UNAVAILABLE = 'dsh.record-unavailable'
export const UNAVAILABLE_FIGURE_NAME = '人物资料不可用'

/** The whole figure of a stored identity-less document: identity {name, aliases, outfits:{key: label}} or null. */
export function figureWithIdentity(stored, identity) {
  const name = identity?.name || UNAVAILABLE_FIGURE_NAME, seen = new Set([figureNameKey(name)]), aliases = []
  for (const word of [...identity?.aliases || [], ...stored.aliases || []]) {
    const value = String(word).trim(), key = figureNameKey(value)
    if (key && !seen.has(key)) { seen.add(key); aliases.push(value) }
  }
  const {aliases:_, ...rest} = stored
  return {...rest, name, ...(aliases.length ? {aliases} : {}),
    outfits:stored.outfits.map(outfit => ({...outfit, label:identity?.outfits?.[outfit.key] || outfit.key})),
    ...(identity ? {} : {extensions:{...stored.extensions, [FIGURE_RECORD_UNAVAILABLE]:true}})}
}

export const isStoredWithoutIdentity = figure => figure.name === undefined

/** Manifest rows of the figures `restored` holds whole again, so the manifest names what readers see. */
export async function freshenFigureRows(manifest, files, restored) {
  if (![...files.values()].some(bytes => restored.has(bytes))) return false
  let changed = false
  manifest.files = await Promise.all(manifest.files.map(async file => {
    const bytes = files.get(file.path)
    if (!bytes || !restored.has(bytes)) return file
    const digest = await sha256(bytes)
    if (digest === file.sha256 && bytes.length === file.size) return file
    changed = true
    return {path:file.path, size:bytes.length, sha256:digest}
  }))
  if (changed) manifest.contentHash = await computeContentHash(manifest)
  return changed
}
