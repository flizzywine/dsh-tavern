// the host side of the 视频 asset kind (`videos`) - what a stage
// consumer (an entrance today; performances, CG movies, OP/ED and skins next) receives for an entry it references: the bundle to
// lease and its digest, the two files, and the playback facts. An entry that is off (关闭), missing or without its bundle
// projects to null; the consumer then plays without it (it never holds the stage).
export function projectStageVideo(pack, assetId) {
  const asset = pack?.manifest.assets.find(row => row.kind === 'videos' && row.id === assetId)
  const bundle = asset && pack.manifest.bundles[asset.bundleKey]
  if (!asset || asset.enabled !== true || bundle?.kind !== 'video') return null
  return {packId: pack.manifest.id, assetId, bundleKey: asset.bundleKey, hash: bundle.contentHash, entry: asset.entry, poster: asset.poster,
    durationMs: asset.durationMs, loop: asset.loop === true, audio: asset.audio ?? 'none', size: [...asset.size], fit: asset.fit ?? 'cover', volume: asset.volume ?? 1, ...(asset.loudness ? {loudness: {...asset.loudness}} : {})}
}