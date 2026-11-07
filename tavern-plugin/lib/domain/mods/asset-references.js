import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check}=contract

export function modPackAssetRefs(pack,manifest) {
  const refs=[]
  function visit(field,value) {
    if(value==null)return
    if(field.type==='asset-ref')refs.push(value)
    if(field.type==='object')for(const child of field.fields)visit(child,value[child.key])
    if(field.type==='list')for(const row of value)visit(field.item,row)
  }
  for(const field of manifest.packSchema?.fields || [])visit(field,pack.fields[field.key])
  for(const entry of pack.entries)for(const field of manifest.assetKinds.find(row=>row.id===entry.kind).fields.fields)visit(field,entry.fields[field.key])
  return refs
}
export async function validateModPackAssetRefs(pack,manifest,resolveAssets) {
  const refs=modPackAssetRefs(pack,manifest)
  if(!refs.length)return
  const rows=await resolveAssets({refs})
  check(rows.length===refs.length && rows.every(row=>row.value),'$.entries','Choose an existing background','MOD_RESOURCE_UNAVAILABLE')
}
