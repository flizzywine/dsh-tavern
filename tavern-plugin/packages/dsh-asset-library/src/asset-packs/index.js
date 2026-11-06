export * from './manifest.js'
export * from './keyword-hygiene.js' // explicit authoring gate
export * from './figure.js'
export * from './sprite.js'
export * from './hash.js'
export { ASSET_PACK_ERROR_CODES } from './common.js'
import { validatePackIdentities } from './manifest.js'
import { validateFigureClosure } from './figure.js'
import { verifyContentHash, computeBundleHash } from './hash.js'
import { check } from './common.js'
import {groupBundleFiles} from './bundle-files.js'
export function validatePackDocuments({ manifest, figures, sprites }) {
  validatePackIdentities([manifest])
  return validateFigureClosure(manifest, figures, sprites)
}
export async function verifyPackDocuments(pack) {
  validatePackDocuments(pack)
  await verifyPackHashes(pack.manifest)
  return pack
}
export async function verifyPackHashes(manifest) {
  await verifyContentHash(manifest)
  const grouped = groupBundleFiles(manifest.files)
  for (const [key, bundle] of Object.entries(manifest.bundles)) {
    const prefix = `bundles/${key}/`
    const files = (grouped.get(key) || []).map(file => ({ ...file, path: file.path.slice(prefix.length) }))
    check(await computeBundleHash(files) === bundle.contentHash, '$.bundles.' + key, 'Bundle content hash mismatch', 'CONTENT_HASH_MISMATCH')
  }
}
