export * from './manifest.js'
export * from './hash.js'
export { ASSET_PACK_ERROR_CODES } from './common.js'
import { validatePackIdentities } from './manifest.js'
import { check } from './common.js'
// Whole-pack structural closure: every stored image is used by an entry. Byte checks belong to the storage service.
export function validatePackDocuments({ manifest }) {
  validatePackIdentities([manifest])
  const used = new Set()
  const visit = value => {
    if (typeof value === 'string' && Object.hasOwn(manifest.blobs, value)) used.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(manifest.assets)
  for (const [hash, descriptor] of Object.entries(manifest.blobs)) if (descriptor.mime.startsWith('image/')) check(used.has(hash), '$.blobs.' + hash, 'Unused image cannot be installed')
  return { manifest }
}
