// lamp policy and the figure's single name list participate in the three-way merge.
import { isDeepStrictEqual } from 'node:util'
import { validatePackDocuments } from '../asset-packs/index.js'
import { sealPack, jsonBytes } from '../pack-v2/validation.js'
function rows(pack) {
  return new Map([
    ...pack.manifest.assets.map(a=>['asset/'+a.kind+'/'+a.id,a]),
    ...Object.values(pack.figures).flatMap(f=>[['figure/'+f.id,f],...f.outfits.map(o=>['outfit/'+f.id+'/'+o.key,o])])
  ])
}
const mergeFields = key => key.startsWith('figure/') ? ['enabled','recall','aliases'] : ['enabled','recall']
export function baseMetadata(pack) {
  return Object.fromEntries([...rows(pack)].map(([key,row])=>[key,Object.fromEntries(mergeFields(key).filter(k=>Object.hasOwn(row,k)).map(k=>[k,structuredClone(row[k])]))]))
}
export async function mergeMetadata(incoming,current,base) {
  const manifest=structuredClone(incoming.manifest), figures=structuredClone(incoming.figures), files=new Map(incoming.files)
  const result={...incoming,manifest,figures,files}, nextRows=rows(result), local=baseMetadata(current), preserved=[], removedEdited=[]
  for(const [key,old] of Object.entries(local)) {
    const target=nextRows.get(key), prior=base?.[key]
    if(!target) { if(!base || !isDeepStrictEqual(old,prior)) removedEdited.push(key); continue }
    let kept=false
    for(const field of mergeFields(key)) {
      if(!base || !isDeepStrictEqual([Object.hasOwn(old,field),old[field]],[!!prior && Object.hasOwn(prior,field),prior?.[field]])) {
        if(Object.hasOwn(old,field)) target[field]=structuredClone(old[field]); else delete target[field]
        kept=true
      }
    }
    if(kept) preserved.push(key)
  }
  // Trusted metadata changes require document relationships, not another media scan.
  validatePackDocuments({manifest,figures,sprites:incoming.sprites})
  for(const [id,figure] of Object.entries(figures)) files.set(`figures/${id}.json`,jsonBytes(figure))
  await sealPack(manifest,files,incoming)
  return {pack:result,merge:{preserved,removedEdited,withoutBaseline:!base,wholePackReplacement:true}}
}
