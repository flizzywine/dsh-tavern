import {listEffectiveAssets} from './effective-assets.js'
// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "Extra staging guidance for this game:"
})

// Styles are equal pack lamp entries; retain library snapshot/manifest order within each scope.
export function directionStyles(snapshots = [], boundPackIds = [], globalEnabledPackIds = []) {
  const card = new Set(boundPackIds), player = new Set(globalEnabledPackIds)
  const styles = {card:[], player:[]}
  const effective = listEffectiveAssets({snapshots,boundPackIds,globalEnabledPackIds})
  for (const {manifest} of snapshots) {
    const group = player.has(manifest.id) ? 'player' : card.has(manifest.id) ? 'card' : null
    if (!group) continue
    for (const {asset} of effective.filter(row => row.ref.packId === manifest.id)) if (asset.kind === 'directions' && asset.enabled) {
      styles[group].push({ref:{packId:manifest.id,kind:'directions',assetId:asset.id},name:asset.name,text:asset.text,packName:manifest.name})
    }
  }
  return styles
}

export function directionStyleSections(styles) {
  if (!styles.card.length && !styles.player.length) return []
  const source = {kind:'engine',field:'directionStyles',placement:'constant'}
  const sections = [{key:'style.lead',title:'演出风格',text:PROMPT_PROSE.p001,source}]
  for (const group of ['card','player']) {
    for (const row of styles[group]) sections.push({key:`style.${group}.${row.ref.packId}.${row.ref.assetId}`,title:row.name,text:`### ${row.name}\n${row.text}`,
      source:{kind:'pack',packId:row.ref.packId,assetId:row.ref.assetId,scope:group === 'card' ? 'card' : 'global',placement:'constant'}})
  }
  return sections
}
