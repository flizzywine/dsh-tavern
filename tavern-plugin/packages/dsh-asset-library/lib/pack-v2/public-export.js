import performanceContract from '../shared/stage-performance.cjs'
// Keep referenced performance dependencies verifiable when exporting.
export async function assertPublicPackChain(pack, load, seen = new Map()) {
  if (seen.has(pack.manifest.id)) return
  seen.set(pack.manifest.id, pack)
  for (const document of [...Object.values(pack.performances || {}),...Object.entries(pack.variantDocuments || {}).filter(([key])=>key.startsWith('performances/')).flatMap(([,documents])=>Object.values(documents))]) {
    for (const {ref} of performanceContract.performanceReferences(document, pack.manifest.id)) {
      if (ref.packId === pack.manifest.id) continue
      const dependency = seen.get(ref.packId) || await load(ref.packId)
      if (!dependency?.manifest.assets.some(asset => asset.kind === ref.kind && asset.id === ref.assetId)) throw Object.assign(new Error('Cannot export an unverifiable performance dependency'), {code:'MISSING_DEPENDENCY', ref})
      await assertPublicPackChain(dependency, load, seen)
    }
  }
}
