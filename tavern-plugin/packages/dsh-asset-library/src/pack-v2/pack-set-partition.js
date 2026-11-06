// first-fit decreasing, counting the uncompressed ZIP envelope as well as its files.
// A pack is indivisible. Oversized packs get their own archive and retain the normal import safety budget.
import { packSetFiles } from './pack-set.js'

export const COLLECTION_BYTES = 512 * 1024 ** 2

export function packSetZipSize(packs) {
  let size = 22
  for (const [name, bytes] of packSetFiles(packs)) size += bytes.length + 76 + 2 * Buffer.byteLength(name)
  return size
}

export function partitionPackSets(packs, {bytes = COLLECTION_BYTES, entries = 20000} = {}) {
  const groups = []
  const ordered = packs.map((pack, index) => ({pack, index, size:packSetZipSize([pack])}))
    .sort((a, b) => b.size - a.size || a.index - b.index)
  for (const {pack} of ordered) {
    const group = groups.find(group => packSetFiles([...group, pack]).size <= entries && packSetZipSize([...group, pack]) <= bytes)
    if (group) group.push(pack)
    else groups.push([pack])
  }
  return groups
}
