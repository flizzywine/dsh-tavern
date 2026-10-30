import {assetRefKey} from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {selectAssetVariant} from '../../packages/dsh-presentation-protocol/src/asset-variants.js'
import assetTags from '../../packages/dsh-presentation-protocol/src/asset-tags.cjs'
import {check} from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

export function coreItemCatalogue(catalogue, snapshots) {
  return (catalogue.candidates.props || []).map(({ref,asset}) => {
    const pack = snapshots.find(row => row.manifest.id === ref.packId)
    return {ref,asset,tagIcon:assetTags.icon(pack.manifest,asset.category)}
  })
}
export function selectCoreItem(catalogue, op, binding) {
  const row = catalogue.find(row => assetRefKey(row.ref) === assetRefKey(op.ref))
  check(row, '$.ref', 'Choose a recalled item handle.', 'REF_UNAVAILABLE')
  check(op.action === 'show' || binding?.source === 'mvu', '$.action', 'Bind the card inventory to MVU in variable bindings, or use show.', 'ITEM_BINDING_REQUIRED')
  const variant = selectAssetVariant(row.asset,op.variant), content = variant?.content || row.asset
  return {action:op.action,name:row.asset.name,ref:row.ref,...(variant ? {variant:variant.id,variantName:variant.name} : {}),
    category:assetTags.paths(row.asset.category),media:content.media || row.tagIcon,
    inventoryId:row.asset.inventoryId || null,
    binding:binding ? JSON.stringify(binding) : null,
    text:({show:'展示 ',gain:'获得 ',lose:'失去 '}[op.action])+row.asset.name}
}
