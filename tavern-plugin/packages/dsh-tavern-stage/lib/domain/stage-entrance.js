// 入场演出 is part of the card's opening setting (stage.defaultEntrance, like its opening figures and background):
// no switch, no global default, never a lamp-based recall. Absent (or null) = none.
import { cardContentPackIds, cardStageSkin } from '../../../../lib/domain/card-stage-settings.js'
import { projectStageVideo } from './stage-video.js'

export function stageEntranceChoices(extension, packSnapshots, engine) {
  const skin = cardStageSkin(extension, engine, packSnapshots.map(pack => pack.manifest)).skin
  const ids = new Set([...cardContentPackIds(extension), ...(skin?.packId ? [skin.packId] : [])])
  return packSnapshots.filter(pack => ids.has(pack.manifest.id)).flatMap(pack =>
    pack.manifest.assets.filter(asset => asset.kind === 'entrances').map(asset => ({
      value:{packId:pack.manifest.id, kind:'entrances', assetId:asset.id}, label:asset.name
    })))
}

export function selectStageEntrance(extension, packSnapshots, engine) {
  const ref = extension?.stage?.defaultEntrance
  if (!ref || !stageEntranceChoices(extension, packSnapshots, engine).some(row => row.value.packId === ref.packId && row.value.assetId === ref.assetId)) return null
  const pack = packSnapshots.find(row => row.manifest.id === ref.packId)
  const asset = pack.manifest.assets.find(row => row.kind === 'entrances' && row.id === ref.assetId)
  return {ref:structuredClone(ref), document:structuredClone(asset.entrance),
    ...(asset.bundleKey ? {media:{bundleKey:asset.bundleKey, hash:pack.manifest.bundles[asset.bundleKey].contentHash}} : {}),
    ...(asset.entrance.layers.video ? {video:projectStageVideo(pack, asset.entrance.layers.video.asset)} : {})}
}
