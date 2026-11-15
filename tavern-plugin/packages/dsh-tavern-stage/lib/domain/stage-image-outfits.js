import {pluginAnchorInsertion} from '../../../../lib/domain/plugin-text-segments.js'
import {foldAssetPackEntries} from './stage-asset-pack-director.js'

// Match the same first paragraph as the stage's picture placement. Unanchored pictures close the round.
export function stageImageOutfits(direction, anchor) {
  const paragraphs = direction.body?.paragraphs || (direction.displayUnits || []).map((unit, index) => ({para:index + 1, text:unit.text}))
  const at = paragraphs.find(unit => pluginAnchorInsertion(String(unit.text || ''), anchor) >= 0)?.para
    ?? paragraphs.at(-1)?.para ?? Infinity
  const checked = direction.record || direction.preview
  const state = checked ? foldAssetPackEntries(checked, at) : direction.baseline
  return Object.values(state?.actors || {}).filter(actor => actor.figure?.figureId && actor.outfitKey)
    .map(actor => ({packId:actor.figure.packId, figureId:actor.figure.figureId, outfitKey:actor.outfitKey}))
}
