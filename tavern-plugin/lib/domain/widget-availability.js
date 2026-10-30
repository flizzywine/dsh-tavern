import {listEffectiveAssets} from './effective-assets.js'
const key = ref => JSON.stringify([ref.packId,ref.kind,ref.assetId])
export function activeWidgetKeys({packs=[],boundPackIds=[],allowedPackIds=[],widgetsEnabled=false}) {
  return new Set(widgetsEnabled ? listEffectiveAssets({snapshots:packs,boundPackIds:boundPackIds.filter(id=>allowedPackIds.includes(id)),globalEnabledPackIds:allowedPackIds})
    .filter(({pack,asset,ref}) => ref.kind === 'widgets' && asset.enabled && pack.widgets?.[asset.id] && pack.widgets[asset.id].namespace !== 'phone')
    .map(row => key(row.ref)) : [])
}
export const widgetIsActive = (active,ref) => active.has(key(ref))
