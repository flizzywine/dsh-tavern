// Native items keep their existing director/renderer contract; the pack owns authorization and settings.
import contract from '../../src/client/widget-contracts.cjs'
import {activeWidgetKeys,widgetIsActive} from './widget-availability.js'
export const isItemWidget = document => document?.runtime === 'items'
export function itemWidgetSettings({packs=[],boundPackIds=[],allowedPackIds=[]}={}) {
  const active=activeWidgetKeys({packs,boundPackIds,allowedPackIds,widgetsEnabled:true})
  for(const pack of packs) for(const asset of pack.manifest.assets) {
    const document=pack.widgets?.[asset.id]
    if(asset.kind !== 'widgets' || !isItemWidget(document) || !widgetIsActive(active,{packId:pack.manifest.id,kind:'widgets',assetId:asset.id})) continue
    return {enabled:true,s4:contract.stageWidgetResolveSettings(document,asset.settingsDefaults).settings.inventoryNames === true}
  }
  return {enabled:false,s4:false}
}
export function cardItemWidget(raw,snapshots=[],globalEnabledPackIds=[]) {
  const boundPackIds=(raw?.data || raw)?.extensions?.dsh_tavern?.assetBindings?.boundPackIds || []
  return itemWidgetSettings({packs:snapshots,boundPackIds,allowedPackIds:[...boundPackIds,...globalEnabledPackIds]})
}
