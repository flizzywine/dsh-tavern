// read-only figure picker projection, independent of director recall and pack enablement.
import {normalizeCatalogueText, codepointCompare} from './asset-pack-lexical.js'
import {selectFigureAvatar} from './pack-avatar.cjs'

export function searchPackFigures({packs, query, boundPackIds, globalEnabledPackIds, current}) {
  const needle = normalizeCatalogueText(query), groups = [], diagnostics = []
  for (const pack of packs) {
    if (pack.error) { diagnostics.push({code:'PACK_UNAVAILABLE',packId:pack.packId}); continue }
    const {manifest,figures,sprites,revision} = pack
    const rows = manifest.figures.flatMap(figureId => {
      const figure = figures[figureId]
      if (needle && ![figure.name,...(figure.aliases || []),manifest.name].some(text => normalizeCatalogueText(text).includes(needle))) return []
      const outfit = figure.outfits.find(outfit => outfit.enabled)
      const avatar = selectFigureAvatar(figure,sprites)
      return [{ref:{packId:manifest.id,figureId}, name:figure.name, enabled:figure.enabled,
        current:current?.packId === manifest.id && current.figureId === figureId,
        forms:['live2d','spine','sprite'].filter(form => outfit?.[form]),
        ...(figure.imageColor ? {imageColor:figure.imageColor} : {}),
        ...(figure.autoColor ? {autoColor:figure.autoColor} : {}),
        ...(avatar ? {avatar:{hash:avatar.hash,crop:avatar.crop}} : {})}]
    })
    if (!rows.length) continue
    rows.sort((a,b) => Number(b.current)-Number(a.current) || Number(b.enabled)-Number(a.enabled) || codepointCompare(a.name,b.name) || codepointCompare(a.ref.figureId,b.ref.figureId))
    groups.push({packId:manifest.id, name:manifest.name, revision,
      state:boundPackIds.includes(manifest.id) ? 'bound' : globalEnabledPackIds.includes(manifest.id) ? 'global' : 'off', figures:rows})
  }
  const rank = {bound:0,global:1,off:2}
  groups.sort((a,b) => Number(b.packId === current?.packId)-Number(a.packId === current?.packId) || rank[a.state]-rank[b.state] ||
    (a.state === 'bound' ? boundPackIds.indexOf(a.packId)-boundPackIds.indexOf(b.packId) : 0) || codepointCompare(a.name,b.name) || codepointCompare(a.packId,b.packId))
  return {groups,diagnostics}
}
