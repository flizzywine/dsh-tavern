import {modError} from './mod-system-contract.js'
import {assetContent} from '../../packages/dsh-presentation-protocol/src/asset-variant-content.js'

// Reference locations are declared by the field schema, never inferred from arbitrary strings.
export function managedConfigAssetReferences(manifest,values) {
  const references=[]
  function visit(schema,value,location) {
    if(value===null || typeof value!=='object')return
    if(schema['x-tavern-asset']) {
      if(Object.keys(value).length)references.push({ref:value,media:schema['x-tavern-asset'].media,path:location})
      return
    }
    if(Array.isArray(value)){value.forEach((entry,index)=>visit(schema.items || {},entry,location+'/'+index));return}
    for(const [key,entry] of Object.entries(value))visit(schema.properties?.[key] || (typeof schema.additionalProperties==='object'?schema.additionalProperties:{}),entry,location+'/'+key)
  }
  for(const [key,value] of Object.entries(values))if(Object.hasOwn(value,'fixed'))visit(manifest.config.schema.properties[key],value.fixed,key)
  return references
}

export function createManagedConfigAssetReader({getAssetLibrary,manifest,values}) {
  const declarations=managedConfigAssetReferences(manifest,Object.fromEntries(Object.entries(values).map(([key,fixed])=>[key,{fixed}]))),identity=ref=>JSON.stringify([ref.packId,ref.kind,ref.assetId])
  return async ref=>{
    const declaration=declarations.find(row=>identity(row.ref)===identity(ref))
    if(!declaration)throw modError('MOD_PERMISSION','Media reference is not part of this request configuration')
    const owner=getAssetLibrary(),pack=await owner.getPackSnapshot({packId:ref.packId})
    const asset=pack.manifest.assets.find(row=>row.id===ref.assetId && row.kind===ref.kind),hash=asset && assetContent(asset).media
    if(!hash)throw modError('MOD_MISSING','Configured media is no longer available',{ref})
    const {bytes,descriptor}=await owner.readMedia({packId:ref.packId,hash,expectedRevision:pack.revision})
    if(owner!==getAssetLibrary() || !descriptor.mime.startsWith(declaration.media+'/'))throw modError('MOD_REVISION_CONFLICT','Configured media changed during rendering')
    return {kind:declaration.media==='audio'?'sfx':'image',identity:identity(ref)+':'+hash,url:'data:'+descriptor.mime+';base64,'+Buffer.from(bytes).toString('base64')}
  }
}

export function createManagedConfigAssetValidator({getAssetLibrary}) {
  return async({manifest,values})=>{
    const references=managedConfigAssetReferences(manifest,values)
    if(!references.length)return
    const owner=getAssetLibrary()
    if(owner?.apiVersion!==2)throw modError('MOD_MISSING','Asset library is unavailable')
    const packs=new Map()
    for(const {ref,media,path} of references) {
      if(!packs.has(ref.packId))packs.set(ref.packId,await owner.getPackSnapshot({packId:ref.packId}))
      const pack=packs.get(ref.packId),asset=pack?.manifest.assets.find(row=>row.id===ref.assetId && row.kind===ref.kind)
      const content=asset && assetContent(asset),blob=content?.media && pack.manifest.blobs[content.media]
      if(!asset || !blob || !blob.mime.startsWith(media+'/'))throw modError('MOD_INVALID','Choose an installed asset of the declared media type',{path,ref})
    }
    if(owner!==getAssetLibrary())throw modError('MOD_REVISION_CONFLICT','Asset library changed; preview again')
  }
}
