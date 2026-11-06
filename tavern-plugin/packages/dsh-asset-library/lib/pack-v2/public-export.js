import {assetContents,assetDocument} from '../shared/asset-variant-content.js'
import performanceContract from '../shared/stage-performance.cjs'
// Sharing/export is not an internal backup. Never silently strip a referenced dependency.
export function assertPublicPack(pack) {
  for (const [path,bytes] of pack.files || []) if (path.endsWith('.json')) {
    let document
    try {document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))} catch {continue}
    if (document?.license?.privateUse || document?.meta?.privateUse || document?.meta?.dsh?.privateUse) throw Object.assign(new Error('Private-use resource cannot be publicly exported'),{code:'PRIVATE_ASSET_NOT_EXPORTABLE',packId:pack.manifest.id,path})
  }
  for (const asset of pack.manifest.assets) if (['skins','performances'].includes(asset.kind)) {
    for (const [index,content] of assetContents(asset).entries()) {
      const document = assetDocument(pack,asset,asset.variants?.entries[index].id) || JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(pack.files.get('bundles/'+content.bundleKey+'/'+content.entry)))
      if (document.license?.privateUse) throw Object.assign(new Error('This pack contains private-use assets and cannot be publicly exported'),{code:'PRIVATE_ASSET_NOT_EXPORTABLE',packId:pack.manifest.id,assetId:asset.id})
    }
  }
}
export async function assertPublicPackChain(pack, load, seen = new Map()) {
  if (seen.has(pack.manifest.id)) return
  seen.set(pack.manifest.id, pack)
  assertPublicPack(pack)
  for (const document of [...Object.values(pack.performances || {}),...Object.entries(pack.variantDocuments || {}).filter(([key])=>key.startsWith('performances/')).flatMap(([,documents])=>Object.values(documents))]) {
    for (const {ref} of performanceContract.performanceReferences(document, pack.manifest.id)) {
      if (ref.packId === pack.manifest.id) continue
      const dependency = seen.get(ref.packId) || await load(ref.packId)
      if (!dependency?.manifest.assets.some(asset => asset.kind === ref.kind && asset.id === ref.assetId)) throw Object.assign(new Error('Cannot export an unverifiable performance dependency'), {code:'MISSING_DEPENDENCY', ref})
      await assertPublicPackChain(dependency, load, seen)
    }
  }
}
