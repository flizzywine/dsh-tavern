// which 入场演出 (an `entrances` entry, dsh.entrance/1) plays
// when this card's stage opens. The one rule (AGENTS rule 10): only the card's own content packs, in binding order, then each
// pack's manifest order; the first entry that is on (蓝灯 - an entrance has no 绿灯). A global pack never plays it for every
// card. The global switch (舞台设置 › 基础设置「入场演出」, engine stageToggles.entrance) off, or no such entry: null - the stage
// keeps the skin loader or the engine's own veil. Never part of a prompt or the director catalogue.
import { cardContentPackIds } from '../../../../lib/domain/card-stage-settings.js'
import { projectStageVideo } from './stage-video.js'

export function selectStageEntrance(extension, packSnapshots, engine) {
  if (engine?.stageToggles?.entrance === false) return null
  for (const packId of cardContentPackIds(extension)) {
    const pack = packSnapshots.find(row => row?.manifest.id === packId)
    const asset = pack?.manifest.assets.find(row => row.kind === 'entrances' && row.enabled === true && row.recall.mode === 'constant')
    // media: the bundle of the files it draws (its baked plate) and that bundle's digest; the stage leases it like a skin's
    // loader art and keeps what it read for the page's lifetime under that digest.
    if (asset) return {ref: {packId, kind: 'entrances', assetId: asset.id}, document: structuredClone(asset.entrance),
      ...(asset.bundleKey ? {media: {bundleKey: asset.bundleKey, hash: pack.manifest.bundles[asset.bundleKey].contentHash}} : {}),
      // video: the 视频 entry its video layer plays (stage-video.js), or null when that entry is off or gone.
      ...(asset.entrance.layers.video ? {video: projectStageVideo(pack, asset.entrance.layers.video.asset)} : {})}
  }
  return null
}
