// optional emotion images share the same validated still-image contract.
import { check, validateHash, validateStateId } from '../asset-packs/common.js'
import { validateSpriteManifest } from '../asset-packs/sprite.js'

export function createSimpleSprite({images, name = 'Figure'}, blobs) {
  check(images && typeof images === 'object' && !Array.isArray(images) && Object.keys(images).length > 0, '$.images', 'At least one emotion image required')
  const assets = {}, emotions = {}
  for (const [emotion, image] of Object.entries(images)) {
    validateStateId(emotion); validateHash(image?.hash)
    const descriptor = blobs[image.hash]
    check(descriptor && ['png', 'webp'].includes(descriptor.ext), '$.images.' + emotion, 'Existing PNG/WebP blob required')
    const src = 'assets/' + emotion + '.' + descriptor.ext
    assets[src] = image.hash
    emotions[emotion] = {stage:{src, width:image.width, height:image.height}}
  }
  const manifest = {version:2, kind:'layered-static-sprites', character:{id:'figure', name}, closedBehavior:'restore-base', emotions}
  validateSpriteManifest(manifest)
  return {manifest, assets}
}
