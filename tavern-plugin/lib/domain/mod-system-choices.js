import {isDeepStrictEqual as equal} from 'node:util'
import {rawData} from './card-preparation.js'
import {emptyCardMods,validateModSystem,modError} from './mod-system-contract.js'
import {resolveMods} from './mod-system.js'

// Copied card files can share an identity. Listing runs often: each copy is logged once.
const warnedDuplicates=new Set()
export function warnDuplicateCard(kept,skipped) {
  if(warnedDuplicates.has(skipped))return
  warnedDuplicates.add(skipped)
  console.warn('dsh-tavern: 人物卡身份重复，mod 设置只跟随第一张：',kept,skipped)
}

// Resolve a proposed card edit before the existing card owner publishes it.
export function planCardModChoices({previous=emptyCardMods(),card,global,manifests,authorized=[],enableDependencies=[]}) {
  validateModSystem('card',card)
  const draft=structuredClone(card)
  const roots=Object.keys(draft.mods).filter(id=>draft.mods[id]==='on' && previous.mods[id]!=='on')
  const resolve=()=>resolveMods({manifests,authorized,global,card:draft,autoEnable:roots})
  const proposed=resolve()
  const requested=new Set(proposed.confirmations.map(row=>row.dependency))
  for(const id of enableDependencies) {
    if(!requested.has(id))throw modError('MOD_INVALID','Only a requested card-disabled dependency can be confirmed',{id})
    draft.mods[id]='on';roots.push(id)
  }
  const resolution=enableDependencies.length?resolve():proposed
  return {card:resolution.card,resolution}
}

// No card files or extra index: use Card Preparation and the existing shared card lock/writer.
export function createManagedModCardOwner({cardPreparation,listPaths,readWorkspace,writeWorkspace,withCardLock}) {
  const paths=new Map()
  const value=workspace=>structuredClone(rawData(workspace.raw).extensions?.dsh_tavern?.modSystem ?? emptyCardMods())
  const revision=workspace=>workspace.meta.id+':'+String(workspace.meta.updatedAt ?? workspace.meta.importedAt)
  async function lookup(cardId) {
    const path=paths.get(cardId),workspace=path && await readWorkspace(path)
    if(workspace?.meta.id!==cardId)throw modError('MOD_MISSING','Card is not available',{cardId})
    return {path,workspace}
  }
  return Object.freeze({
    lookup,
    async list() {
      const rows=[],next=new Map()
      for(const path of await listPaths()) {
        const workspace=await readWorkspace(path)
        if(!workspace)continue
        // Copied card files can share an identity; the first keeps its mods, a copy is left out
        // (refusing the whole list would keep Tavern from starting).
        if(next.has(workspace.meta.id)){warnDuplicateCard(next.get(workspace.meta.id),path);continue}
        next.set(workspace.meta.id,path);rows.push({cardId:workspace.meta.id,revision:revision(workspace),value:value(workspace)})
      }
      paths.clear();for(const [id,path] of next)paths.set(id,path)
      return rows
    },
    async read({cardId}) {
      const {workspace}=await lookup(cardId)
      return {revision:revision(workspace),value:value(workspace)}
    },
    async compareAndSwap({cardId,expectedRevision,expectedValue,value:input}) {
      validateModSystem('card',input)
      const next=structuredClone(input)
      return withCardLock(cardId,async()=>{
        const {path,workspace}=await lookup(cardId)
        if(revision(workspace)!==expectedRevision || !equal(value(workspace),expectedValue))throw modError('MOD_REVISION_CONFLICT','Card mod choices changed; refresh before saving',{cardId})
        const prefix=rawData(workspace.raw)===workspace.raw?'':'/data'
        const change=cardPreparation.update({kind:'card',card:workspace,patch:{},rawOperations:[{op:'set',path:prefix+'/extensions/dsh_tavern/modSystem',value:next}]})
        if(change.changed) {
          change.card.meta.updatedAt=Math.max(Date.now(),Number(workspace.meta.updatedAt || 0)+1)
          await writeWorkspace(path,change.card)
        }
        return {revision:revision(change.card),value:value(change.card)}
      })
    },
  })
}
