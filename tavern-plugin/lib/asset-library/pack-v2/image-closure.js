// Atomic authoring writes retire replaced images. Unused images are otherwise rejected.
export function trimAuthoringImages(manifest, files) {
  const used = new Set()
  const visit = value => {
    if (typeof value === 'string' && Object.hasOwn(manifest.blobs,value)) used.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(manifest.assets)
  for (const [hash, descriptor] of Object.entries(manifest.blobs)) if (descriptor.mime.startsWith('image/') && !used.has(hash)) {
    delete manifest.blobs[hash]
    files.delete('media/' + hash + '.' + descriptor.ext)
  }
}
