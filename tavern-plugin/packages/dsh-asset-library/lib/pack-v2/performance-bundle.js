// author documents share the pack's identity and closed dependency rules.
import contract from '../shared/stage-performance.cjs'
import {check} from '../asset-packs/common.js'
const {performanceReferences, performanceKeyframeFiles} = contract

export async function validatePerformanceKeyframeBundle(document, {prefix, files, inspectMedia, decodeMedia}) {
  const dependencies = new Set(performanceKeyframeFiles(document).map(name => prefix + name))
  let size = 0, pixels = 0
  for (const name of dependencies) {
    const bytes = files.get(name)
    check(bytes, name, 'Missing keyframe image', 'MISSING_DEPENDENCY')
    size += bytes.length
    check(bytes.length <= 6 * 1024 ** 2 && size <= 64 * 1024 ** 2, name, 'Keyframe image byte budget exceeded', 'LIMIT_EXCEEDED')
    const ext = name.endsWith('.png') ? 'png' : 'webp'
    const info = await inspectMedia(bytes, {ext, mime:'image/' + ext, size:bytes.length}, decodeMedia)
    pixels += info.width * info.height
    check(info.width <= 4096 && info.height <= 4096 && pixels <= 64 * 1024 ** 2, name, 'Keyframe image pixel budget exceeded', 'LIMIT_EXCEEDED')
  }
  return dependencies
}
export function validatePerformancePack(manifest, performances, skins) {
  const assets = manifest.assets.filter(asset => asset.kind === 'performances')
  if (!assets.length) return performances
  const themeIds = new Set(Object.keys(skins)), assetKeys = new Set(manifest.assets.map(asset => asset.kind + '/' + asset.id))
  for (const asset of assets) {
    // Structure was checked once when the changed bundle entered validation.
    const document = performances[asset.id]
    if (document.theme) {
      check(!themeIds.has(document.theme.id), '$.performances.' + asset.id, 'Ambiguous embedded theme identity', 'INVALID_PERFORMANCE')
      themeIds.add(document.theme.id)
    }
    check(document.id === asset.id, '$.performances.' + asset.id, 'Performance identity differs from asset', 'INVALID_PERFORMANCE')
    for (const {ref} of performanceReferences(document, manifest.id)) if (ref.packId === manifest.id) {
      check(assetKeys.has(ref.kind + '/' + ref.assetId), '$.performances.' + asset.id, 'Missing local performance reference: ' + ref.kind + '/' + ref.assetId, 'MISSING_DEPENDENCY')
    }
    for (const block of Object.values(document.timeline)) for (const event of block.events) if (event.do === 'skin' && event.level !== undefined) {
      const [alias, id] = event.ref.split(':')
      if (alias === 'self' || document.packs[alias] === manifest.id) {
        check((alias === 'self' && id === document.theme?.id ? document.theme : skins[id])?.levels?.[event.level], '$.performances.' + asset.id, 'Performance requests an undeclared skin level', 'INVALID_PERFORMANCE')
      }
    }
  }
  return performances
}
