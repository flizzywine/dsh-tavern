import {rawData} from './domain/card-preparation.js'
import {cardAssetWorkspaceRevision} from './card-asset-bindings.js'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}

// The asset owner takes its publication gate before the existing Card Preparation
// queue; do not hold a card lock across a pack call (bundle imports use that order).
export function createModConfigCardPacks({listCards,readCard,getPacks}) {
  const paths=new Map()
  async function lookup(cardId) {
    let path=paths.get(cardId),workspace=path && await readCard(path)
    if(workspace?.meta.id!==cardId) {
      for(const item of await listCards())paths.set(item.workspace.meta.id,item.path)
      path=paths.get(cardId);workspace=path && await readCard(path)
    }
    if(workspace?.meta.id!==cardId)fail('NOT_FOUND','Card is unavailable: '+cardId)
    return {path,workspace,packId:rawData(workspace.raw).extensions?.dsh_tavern?.modConfigPackId || null}
  }
  async function read(args) {
    const card=await lookup(args.cardId),packs=await getPacks()
    const value=card.packId?await packs.readModPrivate({packId:card.packId,modId:args.modId}):{revision:null,config:null}
    return {revision:JSON.stringify([cardAssetWorkspaceRevision(card.workspace),value.revision]),config:value.config}
  }
  async function write(args) {
    const card=await lookup(args.cardId)
    if(!card.packId && args.config===null)return read(args)
    const [expectedCardRevision,expectedRevision]=JSON.parse(args.expectedRevision)
    const copyOnWrite=!!card.packId && (await listCards()).some(row=>row.workspace.meta.id!==args.cardId && rawData(row.workspace.raw).extensions?.dsh_tavern?.modConfigPackId===card.packId)
    await (await getPacks()).writeCardModPrivate({path:card.path,packId:card.packId,modId:args.modId,expectedCardRevision,expectedRevision,copyOnWrite,
      ...(Object.hasOwn(args,'config')?{config:args.config}:{}),...(args.file?{file:args.file,bytes:args.bytes}:{})})
    return read(args)
  }
  return Object.freeze({lookup,read,write,upload:write,async readFile(args) {
    const card=await lookup(args.cardId)
    return card.packId?(await (await getPacks()).readModPrivate({packId:card.packId,modId:args.modId,path:args.path})).bytes:null
  }})
}
