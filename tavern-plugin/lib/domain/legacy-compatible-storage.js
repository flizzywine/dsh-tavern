import {rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
import {createConversationPageStore} from './conversation-page-store.js'
import {createIncrementalJsonState} from './incremental-json-state.js'

const FORMAT='legacy-compatible-json-v1'
const failure=(code,message)=>Object.assign(new Error(message),{code})
const pointer=parts=>parts.length?'/'+parts.map(part=>String(part).replace(/~/g,'~0').replace(/\//g,'~1')).join('/'):''

/** Lossless storage adapter for the existing Chat contract. Business fields are
 * opaque: pending MVU/native delivery, rollback, scripts and extensions retain
 * their exact shape. An active target is never replaced by a stale backup.
 */
export function createLegacyCompatibleStorage({dataRoot,onIO}){
 const promotion=createDurableFilePromotion({writeLockStaleMs:Number.MAX_SAFE_INTEGER})
 function pages(id){marker(id);return createConversationPageStore({root:path.join(dataRoot,'compatible-conversations',id),onIO})}
 function marker(id){
  if(typeof id!=='string'||!id||id==='.'||id==='..'||/[\\/\0]/.test(id))throw Error('Invalid chat id')
  return path.join(dataRoot,'chats',id,'storage-format.json')
 }
 function tree(id,target){return createIncrementalJsonState({read:ref=>pages(id).readRecord(target,ref),write:value=>pages(id).writeRecord(target,value)})}
 async function status(id){
  const bytes=await promotion.read(marker(id))
  if(bytes===undefined)return null
  const value=JSON.parse(bytes.toString())
  if(value.version!==1||!['legacy','compatible'].includes(value.mode)
   ||((value.mode==='compatible'||value.target!==undefined)&&!/^[a-f0-9]{64}$/.test(value.target))
   ||(value.historyTargets!==undefined&&(!Array.isArray(value.historyTargets)||value.historyTargets.some(target=>!/^[a-f0-9]{64}$/.test(target)))))throw failure('CHAT_STORAGE_FORMAT','Unknown or invalid Chat storage format')
  return value
 }
 async function lock(id,operation){
  marker(id)
  let result
  await promotion.update(path.join(dataRoot,'.conversation-locks',id),async()=>{result=await operation();return undefined})
  return result
 }
 async function head(id,history=false){
  const active=await status(id)
  if(active?.mode!=='compatible'&&!(history&&active?.target))return null
  const view=await pages(id).openConversation(active.target,{limit:1})
  if(!view||view.metadata?.format!==FORMAT||view.metadata.chatId!==id)throw failure('CHAT_STORAGE_DAMAGED','Active compatible Chat is missing or corrupt; retained legacy backup is not current')
  return {active,view}
 }
 async function version(id){
  const value=await head(id)
  return value?'compatible:'+value.active.target+':'+value.view.snapshotCursor.snapshotId:null
 }
 async function read(id,revision=Infinity){
  const value=await head(id,revision!==Infinity)
  if(!value)return null
  const {active}=value
  let {view}=value,target=active.target
  if(revision<view.metadata.initialRevision){
   for(const previous of active.historyTargets??[]){
    const candidate=await pages(id).openConversation(previous,{limit:1})
    if(!candidate||candidate.metadata?.format!==FORMAT||candidate.metadata.chatId!==id)throw failure('CHAT_STORAGE_DAMAGED','Archived compatible history is missing or corrupt')
    if(revision>=candidate.metadata.initialRevision&&revision<=candidate.state.revision){view=candidate;target=previous;break}
   }
  }
  if(active.mode==='legacy'&&revision>view.state.revision)return null
  if(revision<view.metadata.initialRevision)return null // Pre-cutover revisions remain in the original journal.
  let root=view.state.root
  if(revision!==Infinity&&revision!==view.state.revision){
   if(revision===view.metadata.initialRevision)root=view.metadata.initialRoot
   else root=(await pages(id).readEntries(target,['revision:'+revision],{snapshotId:view.snapshotCursor.snapshotId}))['revision:'+revision]
   if(!root)throw failure('DSH_TAVERN_REVISION_NOT_FOUND','Compatible Chat revision not found: '+revision)
  }
  const chat=await tree(id,target).get(root)
  if(chat?.id!==id||!Number.isSafeInteger(chat._storageRevision)||(revision!==Infinity&&chat._storageRevision!==revision)
   ||(revision===Infinity&&chat._storageRevision!==view.state.revision))throw failure('CHAT_STORAGE_DAMAGED','Invalid compatible Chat root')
  return {chat,revision:chat._storageRevision,compatible:{target,pageRevision:view.revision,root},legacy:false,
   snapshot:null,open:null,openFrameCount:0,openValidBytes:0,openInvalidLine:0}
 }
 // Caller holds the shared lock and checks that the original files have not changed.
 async function migrate(id,chat,sourceVersion,assertSource){
  const active=await status(id)
  if(active?.mode==='compatible'){await head(id);return {status:'compatible',alreadyActive:true}}
  const target=createHash('sha256').update(id+'\0'+sourceVersion).digest('hex')
  let view=await pages(id).openConversation(target,{limit:1})
  if(!view){
   const root=await tree(id,target).create(chat)
   await pages(id).create(target,{state:{root,revision:chat._storageRevision},metadata:{format:FORMAT,chatId:id,initialRevision:chat._storageRevision,initialRoot:root}})
   view=await pages(id).openConversation(target,{limit:1})
  }
  const restored=await tree(id,target).get(view.state.root)
  if(view.metadata?.format!==FORMAT||view.metadata.chatId!==id||view.state.revision!==chat._storageRevision||JSON.stringify(restored)!==JSON.stringify(chat))throw failure('CHAT_MIGRATION_VERIFY','Legacy Chat round-trip verification failed')
  await assertSource()
  await promotion.write(marker(id),JSON.stringify({version:1,mode:'compatible',target,sourceVersion,sourceRevision:chat._storageRevision,historyTargets:[...new Set([...(active?.target?[active.target]:[]),...(active?.historyTargets??[])])]}))
  return {status:'compatible',alreadyActive:false,sourceRevision:chat._storageRevision,target}
 }
 async function write(id,state,next,changes,assertCurrent){
  const {target,pageRevision}=state.compatible,t=tree(id,target)
  let root=state.compatible.root
  for(const change of changes){
   const p=pointer(change.path)
   try{
   if(change.op==='set')root=(await t.apply(root,[{op:'set',path:p,value:change.value}])).nextRoot
   else if(change.op==='delete')root=(await t.apply(root,[{op:'remove',path:p}])).nextRoot
   else if(change.op==='splice'){
    // The legacy contract permits arbitrary splices. Tail append is bounded;
    // historical replacement remains an explicit compatibility materialization.
    const length=await t.size(root,p)
    if(change.index===length&&change.deleteCount===0){
     for(const item of change.items)root=(await t.apply(root,[{op:'set',path:p+'/-',value:item}])).nextRoot
    }else{
     const array=await t.get(root,p)
     array.splice(change.index,change.deleteCount,...change.items)
     root=(await t.apply(root,[{op:'set',path:p,value:array}])).nextRoot
    }
   }else throw Error('Unsupported legacy mutation')
   }catch(error){
    if(error.code!=='STATE_DELTA_INVALID')throw error
    // Old JSON writes may extend an array with null-filled gaps. Preserve that
    // contract via explicit full JSON normalization, not a lossy partial patch.
    root=await t.create(JSON.parse(JSON.stringify(next)))
    break
   }
  }
  if(await t.get(root,'/id')!==id||await t.get(root,'/_storageRevision')!==next._storageRevision)throw failure('CHAT_MIGRATION_VERIFY','Invalid compatible update')
  assertCurrent?.()
  const committed=await pages(id).commit(target,{expectedRevision:pageRevision,state:{root,revision:next._storageRevision},records:[['revision:'+next._storageRevision,root]]})
  return {...state,chat:next,revision:next._storageRevision,compatible:{target,pageRevision:committed.revision,root}}
 }
 async function deactivate(id){await promotion.write(marker(id),JSON.stringify({...await status(id),version:1,mode:'legacy',explicitRestore:true}))}
 async function remove(id){marker(id);await rm(path.join(dataRoot,'compatible-conversations',id),{recursive:true,force:true})}
 return Object.freeze({status,lock,version,read,migrate,write,deactivate,remove})
}
