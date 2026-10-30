// conversion only at archive ingress and explicit installed-pack migration.
export function migrateCgFigures(manifest) {
  if (!Array.isArray(manifest?.assets)) return manifest
  const assets = manifest.assets.map(asset => {
    if (asset?.kind !== 'cg' || !Object.hasOwn(asset, 'depicts')) return asset
    const next = {...asset}; delete next.depicts; return next
  })
  return assets.every((asset, i) => asset === manifest.assets[i]) ? manifest : {...manifest, assets}
}
