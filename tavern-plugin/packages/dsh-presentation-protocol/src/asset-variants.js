// Flat variants: ingress, editors and production readers share one stable-key contract.
import variantTable from './asset-variant-table.cjs'
const {assetVariantRow}=variantTable
import {assertJson,check,shape,text,array,unique,oneOf,object} from './asset-pack-json.js'
import {ASSET_KINDS,ASSET_REF_SCHEMA,SHORT_ID_PATTERN,TIMES_OF_DAY,assetRefKey,validateShortId} from './asset-packs.js'

export const VARIANT_PARAMETER_SCHEMA = Object.freeze({type:'string',pattern:SHORT_ID_PATTERN})
export const VARIANT_SWITCH_SCHEMA = Object.freeze({type:'object',properties:Object.freeze({variant:VARIANT_PARAMETER_SCHEMA,ref:ASSET_REF_SCHEMA}),required:Object.freeze(['variant']),additionalProperties:false})
const identityFields=['kind','id','name','enabled','recall','directorNote','variants']

// The kind owner validates its closed payload and media references; no generic image coercion.
export function validateAssetVariants(kind,value,validateContent,path='$.variants') {
  oneOf(kind,[...ASSET_KINDS,'props'],'$.kind')
  check(!['figures','weather'].includes(kind),'$.kind','This kind has its own selection model')
  assertJson(value)
  shape(value,['default','entries'],['default','entries'],path)
  validateShortId(value.default,path+'.default')
  array(value.entries,path+'.entries',kind==='cg'?16:256)
  check(value.entries.length,path+'.entries','At least one variant is required')
  for(const [index,row] of value.entries.entries()) {
    const at=path+'.entries['+index+']'
    shape(row,['id','name','content'],['id','name','content'],at)
    validateShortId(row.id,at+'.id');text(row.name,at+'.name')
    check(row.name.trim(),at+'.name','Variant name must not be blank')
    check(object(row.content),at+'.content','Expected same-kind content')
    for(const key of identityFields)check(!Object.hasOwn(row.content,key),at+'.content.'+key,'Entry identity and recall stay outside variant content','UNKNOWN_FIELD')
    validateContent(kind,row.content,at+'.content')
  }
  unique(value.entries.map(row=>row.id),path+'.entries')
  check(value.entries.some(row=>row.id===value.default),path+'.default','Default variant is missing')
  return value
}

// Reads use already validated data. Explicit invalid keys never silently select the default.
export function selectAssetVariant(entry,id) {
  if(!entry.variants) {
    check(id===undefined,'$.variant','This entry has no variants','REF_UNAVAILABLE')
    return null
  }
  const row=assetVariantRow(entry.variants,id)
  check(row,'$.variant','Choose a listed variant id','REF_UNAVAILABLE')
  return row
}

export function variantTarget(active,ref) {
  if(ref===undefined) {
    check(active.length===1,'$.ref','Choose the full reference of one active entry','REF_UNAVAILABLE')
    return active[0]
  }
  const key=assetRefKey(ref),found=active.find(row=>assetRefKey(row)===key)
  check(found,'$.ref','Choose the full reference of an active entry','REF_UNAVAILABLE')
  return found
}

export function backgroundTimeVariant(entry,timeOfDay) {
  oneOf(timeOfDay,[...TIMES_OF_DAY,null],'$.timeOfDay')
  const id=timeOfDay!==null && entry.variants?.entries.some(row=>row.id===timeOfDay)?timeOfDay:undefined
  return selectAssetVariant(entry,id)
}

export function assetVariantCandidate(entry) {
  if (!entry.variants) return undefined
  return {default:entry.variants.default,entries:entry.variants.entries.map(({id,name})=>({id,name}))}
}
