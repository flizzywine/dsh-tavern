import {createHash} from 'node:crypto'
import {ScenePrefixHash} from './scene-prefix-hash.js'
import {projectTavernHelperContext,projectTavernHelperMessage} from './tavern-helper-context.js'
import {projectSessionMessage,projectChatSessionState,projectSceneImageState,projectDisplayRuntimeState} from './chat-session-state.js'
import {createScopedMessages} from './scoped-messages.js'
import {markStageRead,stageReadHeaderFields,stageReadIdentityFields,stageReadDisplayFields,stageReadRecordFields,stageReadFloorFields,stageReadCurrentFields,stageReadChainFields,stageReadEarlierOmitted} from './stage-read-projection.js'
import {createBufferedJsonRecords} from './buffered-json-records.js'
import path from 'node:path'
import {createConversationPageStore} from './conversation-page-store.js'
import {createConversationState} from './conversation-state.js'
import {createIncrementalJsonState,createDecodedJsonCache} from './incremental-json-state.js'
import {diffJson,applyJsonChangesShared} from './json-mutation.js'

const pointer=parts=>parts.length?'/'+parts.map(part=>String(part).replace(/~/g,'~0').replace(/\//g,'~1')).join('/'):''
const failure=(code,message)=>Object.assign(new Error(message),{code})
const header=({messages,...value})=>value
const CHANGE_WINDOW=64

// The page store bounds physical I/O across these independent decoders. Keep
// logical workers bounded too, and install results in the original order.
// Message lists go newest first: maintenance lays a head's blocks out in that order
// and older floors mostly reuse subtrees the newer ones already decoded.
async function mapRead(values,read,newestFirst=false){
 const result=new Array(values.length)
 let next=0
 await Promise.all(Array.from({length:Math.min(8,values.length)},async()=>{
  while(next<values.length){const index=newestFirst?values.length-1-next++:next++;result[index]=await read(values[index])}
 }))
 return result
}

/** Native pages/current-state storage behind the existing runtime Chat API.
 * Chat is a detached projection, never an authoritative monolithic disk blob.
 * Existing MVU receipts, sessions and undo metadata remain owned by the runtime;
 * this bridge publishes their changed rows and current world in ONE head CAS.
 * Full read/update remain explicit compatibility materializations. Migration
 * creates a verified head and retains pre-cutover revisions in legacy storage.
 */
export function createNativeConversationStorage({dataRoot,onIO}){
 const pages=createConversationPageStore({root:path.join(dataRoot,'chats'),onIO})
 const domain=createConversationState({store:pages})
 const summaryCache=new Map(),summaryLoads=new Map()
 let summaryBytes=0
 async function sessionSummaries(id,view){
  const key=JSON.stringify([id,view.snapshotCursor.snapshotId])
  const cached=summaryCache.get(key)
  if(cached){summaryCache.delete(key);summaryCache.set(key,cached);return cached}
  if(summaryLoads.has(key))return summaryLoads.get(key)
  const loading=(async()=>{
   const messages=new Array(view.messageCount),t=tree(id)
   let cursor=view.snapshotCursor,pending=null,bytes=messages.length*8
   while(cursor){
    const page=await pages.readHistoryPage(id,{cursor,limit:500})
    for(const {position,message} of [...page.messages].reverse()){
     const summary=message.session || sessionSummary(await t.get(message.runtimeRef))
     messages[position]=projectSessionMessage(summary.message)
     bytes+=48+JSON.stringify(messages[position]).length*2
     if(pending===null&&summary.pending)pending=summary.pending
    }
    cursor=page.previousCursor
   }
   const value={messages,pending,bytes}
   if(bytes<=8*1024*1024){
    while(summaryCache.size && (summaryCache.size>=4 || summaryBytes+bytes>16*1024*1024)){
     const oldest=summaryCache.keys().next().value;summaryBytes-=summaryCache.get(oldest).bytes;summaryCache.delete(oldest)
    }
    summaryCache.set(key,value);summaryBytes+=bytes
   }
   return value
  })()
  summaryLoads.set(key,loading)
  try{return await loading}finally{summaryLoads.delete(key)}
 }
 // Immutable content-addressed records can survive a head revision change.
 // Share one bounded decoded cache across conversations; sidebar/background
 // reads must not evict the active game's entire decoder. Public reads remain
 // detached and every request resolves the authoritative head from disk.
 const decodedCache=createDecodedJsonCache(128*1024*1024)
 function tree(id){
  // Tree operations never mutate stored nodes. Reuse the page store's bounded
  // immutable cache; only the resulting public JSON projection is detached.
  // Each tree() serves one operation, so its shared-subtree memo ends with it.
  return createIncrementalJsonState({decodedCache,shareSubtrees:true,
   read:ref=>pages.readRecord(id,ref,{shared:true}),write:value=>pages.writeRecord(id,value)})
 }
 async function head(id,snapshotId){
  const view=await pages.readHead(id,snapshotId?{snapshotId}:{})
  if(view&&(view.metadata?.format!=='conversation-state-v2'||view.metadata.settings?.runtimeLayout!==1))throw failure('CHAT_STORAGE_FORMAT','Unsupported native runtime layout')
  return view
 }
 async function version(id){const view=await head(id);return view?'native:'+view.snapshotCursor.snapshotId:null}
 async function readRevisionMetadata(id){
  const view=await head(id)
  return view?{revision:view.state.chatRevision,messageCount:view.messageCount,stamp:'native:'+view.snapshotCursor.snapshotId}:null
 }
 function result(chat,view){return {chat,revision:chat._storageRevision,native:{view},legacy:false,snapshot:null,open:null,openFrameCount:0,openInvalidLine:0}}
 async function headAtRevision(id,revision=Infinity){
  if(revision!==Infinity&&(!Number.isSafeInteger(revision)||revision<1))throw failure('DSH_TAVERN_REVISION_NOT_FOUND','Invalid native Chat revision')
  let view=await head(id)
  if(!view)return null
  if(revision!==Infinity&&revision<view.metadata.settings?.legacyInitialRevision)return null
  if(revision!==Infinity&&revision!==view.state.chatRevision){
   const ref=(await pages.readEntries(id,['chat-revision:'+revision],{snapshotId:view.snapshotCursor.snapshotId}))['chat-revision:'+revision]
   if(!ref)throw failure('DSH_TAVERN_REVISION_NOT_FOUND','Native Chat revision not found: '+revision)
   try{view=await head(id,ref)}catch(error){
    // compact() drops unretained revision heads but keeps their index entries.
    if(error.code==='ENOENT')throw failure('DSH_TAVERN_REVISION_NOT_FOUND','Native Chat revision was compacted: '+revision)
    throw error
   }
  }
  return view
 }
 async function read(id,revision=Infinity,snapshotId){
  const view=snapshotId?await head(id,snapshotId):await headAtRevision(id,revision)
  if(!view)return null
  const started=performance.now(),t=tree(id),chat=await selectedHeader(id,view)
  onIO?.({kind:'phase',name:'chat.native.header',chatId:id,durationMs:performance.now()-started})
  const historyStarted=performance.now(),messages=new Array(view.messageCount)
  let cursor=view.snapshotCursor
  while(cursor){
   const page=await pages.readHistoryPage(id,{cursor,limit:500})
   const decoded=await mapRead(page.messages,row=>t.get(row.message.runtimeRef),true)
   page.messages.forEach((row,index)=>{messages[row.position]=decoded[index]})
   cursor=page.previousCursor
  }
  chat.messages=messages
  onIO?.({kind:'phase',name:'chat.native.messages',chatId:id,durationMs:performance.now()-historyStarted})
  if(chat.id!==id||chat._storageRevision!==view.state.chatRevision)throw failure('CHAT_STORAGE_DAMAGED','Native Chat revision mismatch')
  return result(chat,view)
 }
 async function selectedHeader(id,view,fields){
  const t=tree(id),root=view.state.chatHeaderRef
  // Cache resource fields independently: a new task revision must not retain
  // another whole header containing the same large card and evict the card.
  const complete=!Array.isArray(fields)&&fields!=='settlement'
  const result={}
  const paths=Array.isArray(fields)?fields:await t.keys(root)
  const selected=paths.map(field=>({field,parts:complete?[field]:String(field).split('.').filter(Boolean)}))
   .filter(({parts})=>parts.length&&parts[0]!=='messages'&&(complete||!parts.some(part=>['__proto__','prototype','constructor'].includes(part))))
  const values=await mapRead(selected,async({field,parts})=>{
   let value
   if(fields==='settlement'&&field==='timeline'&&await t.type(root,'/timeline')==='object'){
    value={}
    for(const key of await t.keys(root,'/timeline'))if(key!=='checkpoints')Object.defineProperty(value,key,{value:await t.get(root,pointer(['timeline',key])),enumerable:true,writable:true,configurable:true})
    value.checkpoints=[]
   }else value=await t.get(root,pointer(parts))
   return value
  })
  for(const [index,{parts}] of selected.entries()){
   const value=values[index]
   if(value===undefined)continue
   let target=result
   for(const key of parts.slice(0,-1))target=target[key]??={}
   Object.defineProperty(target,parts.at(-1),{value,enumerable:true,writable:true,configurable:true})
  }
  return result
 }
 // A window is explicitly NOT a writable Chat: coordinates refer to the pinned
 // full archive, while chat.messages contains only this bounded page.
 async function readWindow(id,{limit=48,before,revision,includeCheckpoints=false,requirePartial=false,fields,messageFields}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('Invalid history window limit')
  const view=await headAtRevision(id,revision??Infinity)
  if(!view)return null
  const end=before??view.messageCount
  if(!Number.isSafeInteger(end)||end<0||end>view.messageCount)throw Error('Invalid history window cursor')
  const from=Math.max(0,end-limit)
  // Opening callers fall back to the complete view when no history is omitted.
  // Reject using pinned metadata before materializing the card and worldbook.
  if(requirePartial && from===0)return null
  const chat=await selectedHeader(id,view,fields ?? (includeCheckpoints?undefined:'settlement')),t=tree(id)
  const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:end},limit})
  chat.messages=[]
  const paths=messageFields?.map(field=>pointer(field.split('.')))
  chat.messages=await mapRead(page.messages,row=>paths===undefined
   ? t.get(row.message.runtimeRef) : t.getFields(row.message.runtimeRef,paths),true)
  return {chat,messageCount:view.messageCount,from,to:end-1,revision:view.state.chatRevision,worldMessage:view.state.worldMessage??null,
   ...(messageFields===undefined?{}:{messageFields:[...messageFields]})}
 }
 // One pinned native head supplies identity headers and the requested prefix, not historical payloads.
 // chainOnly: earlier floors carry the record identity, not the record (stageReadChainFields); readStageFloors reads
 // the earlier floors a history consumer names.
 async function readStageView(id,{turn,configOnly=false,stateOnly=false,sourceOnly=false,chainOnly=false}={}){
  const view=await head(id)
  if(!view)return null
  const chat=await selectedHeader(id,view,sourceOnly?['id','sessionId','_storageRevision','timeline.branchId','timeline.revision']:stageReadHeaderFields),t=tree(id)
  const summaries=(await sessionSummaries(id,view)).messages
  chat.messages=structuredClone(summaries)
  if(stateOnly){
   for(let position=chat.messages.length-1;position>=0;position--){
    if(chat.messages[position].role!=='assistant')continue
    const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:position+1},limit:1})
    const record=await t.get(page.messages[0].message.runtimeRef,'/stageDirectionAssetPacks')
    if(record){chat.messages[position].stageDirectionAssetPacks=record;break}
   }
   return markStageRead(chat,{stateOnly:true})
  }
  const requested=Number(turn)||Math.max(0,...summaries.filter(row=>row.role==='assistant').map(row=>Number(row.turn || (row.greeting?1:0))))
  const target=row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===requested
  const index=sourceOnly?summaries.findLastIndex(target):summaries.findIndex(target)
  const latestAssistant=summaries.findLastIndex(row=>row.role==='assistant'),latestUser=summaries.findLastIndex(row=>row.role==='user')
  const indices=configOnly?[latestAssistant,latestUser].filter(i=>i>=0).sort((a,b)=>a-b):Array.from({length:index+1},(_,i)=>i)
  const references=new Map()
  // Page metadata is small and already contains original coordinates; payload reads stop at the target.
  for(let start=0;start<indices.length;start+=500){
   const batch=indices.slice(start,start+500),from=batch[0],end=batch.at(-1)+1
   for(let before=end;before>from;before-=500){
    const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before},limit:Math.min(500,before-from)})
    for(const row of page.messages)references.set(row.position,row.message.runtimeRef)
   }
  }
  const values=await mapRead(indices,async position=>{
   const ref=references.get(position)
   if(sourceOnly){
    // Prefix hashing consumes the preferred source, not duplicate display text or inactive swipes.
    const row=await t.getFields(ref,(position===index?['id','role','turn','greeting','swipeId','stageDirectionGeneration','sourceText']:['role','turn','sourceText']).map(field=>'/'+field))
    if(row.sourceText==null){const text=await t.get(ref,'/text');if(text!==undefined)row.text=text}
    if(position===index){
     const swipe=Math.max(0,Number(row.swipeId)||0),selected=await selectedSceneSwipe(t,ref,swipe)
     if(selected!==undefined)row.swipes={[swipe]:selected}
    }
    return row
   }
   if(chainOnly&&position!==index){
    const row=await t.getFields(ref,[...stageReadChainFields,...stageReadFloorFields].map(field=>pointer(field.split('.'))))
    if(row.sourceText==null){const text=await t.get(ref,'/text');if(text!==undefined)row.text=text}
    return row
   }
   const fields=configOnly?[...stageReadIdentityFields,'stageDirectionAssetPacks.stats.judge.probabilities']:
    [...stageReadIdentityFields,...stageReadDisplayFields,...stageReadRecordFields,...stageReadFloorFields,...(position===index?stageReadCurrentFields:[])]
   return t.getFields(ref,fields.map(field=>pointer(field.split('.'))))
  })
  indices.forEach((position,i)=>{chat.messages[position]={...chat.messages[position],...values[i]}})
  return markStageRead(chat,{turn:requested,index,configOnly,...(sourceOnly?{sourceOnly:true}:{}),...(chainOnly?{chainOnly:true,full:[]}:{})})
 }
 // The earlier floors (indices) a chain-only view's consumer names, at `revision`: by default each as a stage view
 // reads an earlier floor in full, its record without the judge probabilities (stageReadEarlierOmitted); `fields`
 // selects others (the record alone, or each beat's ops). One page-metadata read per 500 floors, then each floor by
 // sub-path.
 async function readStageFloors(id,indices,{revision,fields=[...stageReadIdentityFields,...stageReadDisplayFields,...stageReadRecordFields,...stageReadFloorFields]}={}){
  const view=await headAtRevision(id,revision??Infinity)
  if(!view)return null
  const t=tree(id),sorted=[...new Set(indices)].sort((a,b)=>a-b),references=new Map()
  for(let start=0;start<sorted.length;){
   let end=start
   while(end+1<sorted.length&&sorted[end+1]-sorted[start]<500)end++
   const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:sorted[end]+1},limit:sorted[end]+1-sorted[start]})
   for(const row of page.messages)references.set(row.position,row.message.runtimeRef)
   start=end+1
  }
  const paths=fields.map(field=>pointer(field.split('.'))),omitted=stageReadEarlierOmitted.map(field=>pointer(field.split('.')))
  return mapRead(indices,position=>references.has(position)?t.getFields(references.get(position),paths,omitted):undefined,true)
 }
 // Floor summaries (role, turn, greeting, MVU flags) of the latest `count` floors, from
 // the page entries' inline summaries: never the bodies, never the whole history.
 async function readRecentSummaries(id,count){
  const view=await head(id)
  if(!view)return null
  const start=Math.max(0,view.messageCount-Math.max(0,Number(count)||0)),messages=new Array(view.messageCount-start),t=tree(id)
  let cursor=view.snapshotCursor
  while(cursor&&cursor.before>start){
   const page=await pages.readHistoryPage(id,{cursor,limit:Math.min(500,cursor.before-start)})
   for(const {position,message} of page.messages){
    if(position<start)continue
    messages[position-start]=projectSessionMessage((message.session||sessionSummary(await t.get(message.runtimeRef))).message)
   }
   cursor=page.previousCursor
  }
  return {messageCount:view.messageCount,from:start,messages}
 }
 async function readSlice(id,indices=[],fields,pinned){
  const view=pinned||await head(id)
  if(!view)return null
  if(indices.some(index=>index>=view.messageCount))return undefined
  if(indices.some(index=>!Number.isSafeInteger(index)||index<0))throw Error('消息楼层不存在')
  const chat=await selectedHeader(id,view,fields),t=tree(id)
  chat.messages=[]
  const sorted=[...new Set(indices)].sort((a,b)=>a-b),references=new Map()
  for(let start=0;start<sorted.length;){
   let end=start
   while(end+1<sorted.length&&sorted[end+1]-sorted[start]<500)end++
   const selected=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:sorted[end]+1},limit:sorted[end]-sorted[start]+1})
   for(const row of selected.messages)references.set(row.position,row.message.runtimeRef)
   start=end+1
  }
  chat.messages=await mapRead(indices,position=>t.get(references.get(position)))
  return {chat,messageCount:view.messageCount,denseMessages:true}
 }
 // Revision-bounded change records; callers of rare operations may look further back.
 async function changeCoverage(id,revision,limit=CHANGE_WINDOW){
  const view=await head(id)
  if(!view)return null
  const current=view.state.chatRevision
  if(!Number.isSafeInteger(revision)||revision<1||revision>current||current-revision>limit)return undefined
  const keys=Array.from({length:current-revision},(_,i)=>'chat-change:'+(revision+i+1))
  const refs=await pages.readEntries(id,keys,{snapshotId:view.snapshotCursor.snapshotId})
  const indices=new Set();let tail=view.messageCount,layoutFrom=view.messageCount,layoutChanged=false
  for(let i=0;i<keys.length;i++){
   if(!refs[keys[i]])return undefined
   const frame=await pages.readRecord(id,refs[keys[i]])
   if(frame.baseRevision!==revision+i||frame.revision!==revision+i+1)return undefined
   for(const index of frame.indices)if(index<view.messageCount)indices.add(index)
   if(frame.tail!==null)tail=Math.min(tail,frame.tail)
   if(frame.layoutFrom!==null){layoutChanged=true;layoutFrom=Math.min(layoutFrom,frame.layoutFrom)}
  }
  for(let index=tail;index<view.messageCount;index++)indices.add(index)
  return {view,indices:[...indices].sort((a,b)=>a-b),baseRevision:revision,revision:current,layoutChanged,layoutFrom}
 }
 async function readChangedSlice(id,revision,fields,indicesOnly=false,limit){
  const coverage=await changeCoverage(id,revision,limit)
  if(!coverage)return coverage
  const {view,...changes}=coverage
  if(indicesOnly)return {indices:changes.indices,baseRevision:changes.baseRevision,revision:changes.revision}
  if(revision===changes.revision)return undefined
  return {...changes,...await readSlice(id,changes.indices,fields,view)}
 }
 // A transaction pins one immutable head; only explicit reads populate rows.
 async function readSettlementBase(id){
  const view=await head(id)
  if(!view)return null
  const chat=await selectedHeader(id,view,'settlement'),t=tree(id),rows=new Map(),references=new Map()
  const count=view.messageCount
  let tail=Promise.resolve()
  async function pageFor(position){
   const start=Math.floor(position/64)*64,end=Math.min(count,start+64)
   if(!references.has(position)){
    const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:end},limit:end-start})
    for(const row of page.messages)references.set(row.position,row.message)
   }
   return references.get(position)
  }
  async function ensure(indices){
   const ids=indices===undefined?Array.from({length:count},(_,i)=>i):[...new Set(indices)]
   for(const index of ids)if(!Number.isSafeInteger(index)||index<0||index>=count)throw Error('消息楼层不存在: '+index)
   const pending=tail.then(async()=>{for(const index of ids)if(!rows.has(index)){
    const reference=await pageFor(index)
    rows.set(index,await t.get(reference.runtimeRef))
   }})
   tail=pending.catch(()=>{})
   return pending
  }
  chat.messages=createScopedMessages(count,[],index=>{
   if(!rows.has(index))throw Object.assign(Error('MVU history floor is not loaded: '+index),{code:'MVU_HISTORY_NOT_LOADED'})
   return rows.get(index)
  })
  async function previousMvu(before){
   for(let index=before-1;index>=0;index--){
    const reference=await pageFor(index)
    let valid=reference.session?.mvuSnapshot
    // Old native pages have no flag. Inspect only the selected variable shape,
    // never materialize their body or unrelated variable values.
    if(typeof valid!=='boolean'){
     const swipe=await t.get(reference.runtimeRef,'/swipeId')||0
     const path='/variables/'+swipe
     const keys=await t.type(reference.runtimeRef,path)==='object'?await t.keys(reference.runtimeRef,path):[]
     valid=keys.includes('stat_data')&&keys.includes('schema')
    }
    if(valid){await ensure([index]);return index}
   }
   return -1
  }
  return {chat,messageCount:count,denseMessages:true,ensure,previousMvu}
 }
 // Helper owns a read projection, not an editable runtime Chat. Bind header
 // and every page to one immutable head, even while another writer appends.
 async function readHelperContext(id,range){
  const view=await headAtRevision(id,range?.revision??Infinity)
  if(!view)return null
  const chat=await selectedHeader(id,view,range?['id','sessionId','_storageRevision','backgroundConfigVersion','conversationFeaturesVersion']:'settlement'),t=tree(id)
  const from=range?Math.max(0,Number(range.from)||0):0
  const to=range?Math.min(view.messageCount-1,Number.isSafeInteger(Number(range.to))?Number(range.to):view.messageCount-1):view.messageCount-1
  if(!Number.isSafeInteger(from))throw Error('消息楼层不存在: '+from)
  const messages=[],turnMessageIds={}
  const fields=['role','tavernRole','tavernHidden','name','turn','greeting','swipeId','swipes','sourceText','text','variables','tavernPluginData']
  for(let start=from;start<=to;start+=500){
   const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:Math.min(to+1,start+500)},limit:Math.min(500,to-start+1)})
   for(const {position,message} of page.messages){
    const source={}
    for(const field of fields){
     const value=await t.get(message.runtimeRef,'/'+field)
     if(value!==undefined)source[field]=value
    }
    const projected=projectTavernHelperMessage(source,position)
    messages.push(projected)
    const turn=Math.max(0,Number(source.turn)||(source.greeting===true?1:0))
    if(projected.role==='assistant'&&turn>0)turnMessageIds[String(turn)]=position
   }
  }
  const context={...projectTavernHelperContext({...chat,messages:[]}),messages,turnMessageIds}
  return {chat,context,from,to}
 }
 async function selectedSceneSwipe(t,ref,swipe){
  const type=await t.type(ref,'/swipes')
  if(type==='array'&&(!Number.isInteger(swipe)||swipe<0||swipe>=await t.size(ref,'/swipes')))return undefined
  return type==='array'||type==='object'?t.get(ref,'/swipes/'+swipe):undefined
 }
 // Persist the exact legacy scene-key prefix and a turn lookup. Only explicit
 // body/history edits rebuild a suffix; variable-only writes reuse this index.
 async function updateSceneIndex(id,view,encoded,count,start,t,sources=new Map()){
  const oldRows=new Map()
  async function oldRow(index){
   if(!oldRows.has(index)){
    const end=Math.min(view.messageCount,Math.floor(index/64)*64+64)
    const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:end},limit:end-Math.floor(index/64)*64})
    for(const row of page.messages)oldRows.set(row.position,row.message)
   }
   return oldRows.get(index)
  }
  const valid=view?.state.sceneIndexRef&&view.state.sceneIndexRevision===view.state.chatRevision
  if(!valid)start=0
  let root=valid?view.state.sceneIndexRef:undefined,latest=-1
  let display={complete:true,inferred:1,latestTurn:1}
  let prefix=new ScenePrefixHash().update('['+JSON.stringify(id)+',[')
  if(start>0){const previous=await oldRow(start-1);prefix=new ScenePrefixHash(previous.scene.hash);latest=previous.scene.latest;display=previous.scene.display?{...previous.scene.display}:{complete:false,inferred:1,latestTurn:1}}
  const turns={}
  if(root)for(let index=start;index<view.messageCount;index++){
   const old=await oldRow(index),turn=old.scene?.target?.turn
   if(turn!==undefined&&await t.get(root,'/turns/'+turn)===index)root=(await t.apply(root,[{op:'remove',path:'/turns/'+turn}])).nextRoot
  }
  for(let index=start;index<count;index++){
   const reference=encoded.get(index)??await oldRow(index)
   let row=sources.get(index)
   if(!row){
    row={}
    for(const field of ['role','turn','greeting','text','sourceText','swipeId'])row[field]=await t.get(reference.runtimeRef,'/'+field)
    const swipe=Math.max(0,Number(row.swipeId)||0)
    const selected=await selectedSceneSwipe(t,reference.runtimeRef,swipe)
    if(selected!==undefined)row.swipes={[swipe]:selected}
   }
   const turn=Number(row.turn||(row.greeting?1:0)),swipeId=Math.max(0,Number(row.swipeId)||0)
   if(row.role==='user')display.inferred++
   if(row.role==='assistant'){
    const displayTurn=Math.max(1,Number(row.turn)||display.inferred)
    // The scene lookup may omit legacy inferred turns. Only share it when
    // every assistant has exactly the display API's original turn identity.
    display.complete&&=Number.isSafeInteger(displayTurn)&&turn===displayTurn
    display.latestTurn=Math.max(display.latestTurn,Math.max(1,Number(row.turn)||1))
   }
   let target
   if(row.role==='assistant'&&Number.isSafeInteger(turn)&&turn>=1){
    const source=String(row.swipes?.[swipeId]??row.sourceText??row.text??''),sourceDigest=createHash('sha256').update(source).digest('hex')
    target={turn,swipeId,sourceDigest,key:prefix.digest('],'+JSON.stringify([index,turn,swipeId,sourceDigest]).slice(1))}
    latest=index
    if(root){if(await t.get(root,'/turns/'+turn)===undefined)root=(await t.apply(root,[{op:'set',path:'/turns/'+turn,value:index}])).nextRoot}
    else if(turns[turn]===undefined)turns[turn]=index
   }
   if(index)prefix.update(',')
   prefix.update(JSON.stringify([row.role,row.turn,row.sourceText??row.text]))
   encoded.set(index,{...reference,scene:{hash:prefix.state(),latest,display:{...display},...(target?{target}:{})}})
  }
  if(!root)return t.create({turns,latest,display})
  return (await t.apply(root,[{op:'set',path:'/latest',value:latest},{op:'set',path:'/display',value:display}])).nextRoot
 }
 async function readIndexedSceneState(id,options){
  const view=await headAtRevision(id,options.revision??Infinity)
  if(!view)return null
  if(!view.state.sceneIndexRef||view.state.sceneIndexRevision!==view.state.chatRevision)return undefined
  const chat=await selectedHeader(id,view,['id','sessionId','_storageRevision','mode','backgroundConfigVersion','conversationFeaturesVersion'])
  const t=tree(id),targets={},root=view.state.sceneIndexRef
  for(const turn of new Set(options.turns)){
   if(!Number.isSafeInteger(turn)||turn<1)continue
   const index=await t.get(root,'/turns/'+turn)
   if(index===undefined||index>=view.messageCount)continue
   const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:index+1},limit:1})
   const reference=page.messages[0].message,target=reference.scene?.target
   if(!target||target.turn!==turn)throw Error('Invalid scene index')
   const source=await selectedSceneSwipe(t,reference.runtimeRef,target.swipeId)??await t.get(reference.runtimeRef,'/sourceText')??await t.get(reference.runtimeRef,'/text')??''
   targets[turn]={...target,source:String(source)}
  }
  const latest=await t.get(root,'/latest')
  let latestTurn=0
  if(latest>=0){const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:latest+1},limit:1});latestTurn=page.messages[0].message.scene.target.turn}
  return {...chat,messages:[],sceneTargets:targets,sceneLatestTurn:latestTurn}
 }
 async function readSceneImageState(id,options){
  if(Array.isArray(options?.turns)){
   const selected=await readIndexedSceneState(id,options)
   if(selected!==undefined)return selected
  }
  const view=await headAtRevision(id,options?.revision??Infinity)
  if(!view)return null
  const chat=await selectedHeader(id,view,['id','sessionId','mode','backgroundConfigVersion','conversationFeaturesVersion'])
  const t=tree(id),messages=new Array(view.messageCount)
  let cursor=view.snapshotCursor
  while(cursor){
   const page=await pages.readHistoryPage(id,{cursor,limit:500})
   for(const {position,message} of page.messages){
    const row={}
    for(const field of ['role','turn','greeting','text','sourceText','swipeId']){
     const value=await t.get(message.runtimeRef,'/'+field)
     if(value!==undefined)row[field]=value
    }
    const count=await t.type(message.runtimeRef,'/swipes')==='array'?await t.size(message.runtimeRef,'/swipes'):null
    if(count!==null){
     row.swipes=new Array(count).fill(null)
     const selected=Math.max(0,Number(row.swipeId)||0)
     if(Number.isInteger(selected)&&selected<count)row.swipes[selected]=await t.get(message.runtimeRef,'/swipes/'+selected)
    }
    messages[position]=row
   }
   cursor=page.previousCursor
  }
  return projectSceneImageState({...chat,messages})
 }
 async function readDisplayRuntimeState(id,turn){
  const view=await head(id)
  if(!view)return null
  const chat=await selectedHeader(id,view,['id','sessionId','_storageRevision','mode','backgroundConfigVersion','conversationFeaturesVersion','updatedAt','rollbackUndo'])
  const t=tree(id),root=view.state.sceneIndexRef
  const display=root&&view.state.sceneIndexRevision===view.state.chatRevision&&view.state.displayIndexRevision===view.state.chatRevision?await t.get(root,'/display'):null
  if(display?.complete===true){
   const index=Number.isSafeInteger(turn)&&turn>=1?await t.get(root,'/turns/'+turn):undefined
   const result={...projectDisplayRuntimeState({...chat,messages:[]},turn),messageIndex:index??-1,latestTurn:display.latestTurn}
   if(index!==undefined){
    if(!Number.isSafeInteger(index)||index<0||index>=view.messageCount)throw Error('Invalid display index')
    const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:index+1},limit:1})
    if(page.messages[0].message.scene?.target?.turn!==turn)throw Error('Invalid display index')
    result.displayRuntime=await t.get(page.messages[0].message.runtimeRef,'/displayRuntime')
   }
   return result
  }
  const {messages}=await sessionSummaries(id,view)
  const result=projectDisplayRuntimeState({...chat,messages},turn)
  if(result.messageIndex>=0){
   const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:result.messageIndex+1},limit:1})
   result.displayRuntime=await tree(id).get(page.messages[0].message.runtimeRef,'/displayRuntime')
  }
  return result
 }
 async function readSessionState(id,options={}){
  const view=await head(id)
  if(!view)return null
  const chat=await selectedHeader(id,view,['id','sessionId','_storageRevision','mode','cardPath','cardContextRevision',
   'backgroundConfigVersion','conversationFeaturesVersion','disabledWritingSkills','contextCompaction','updatedAt','timeline','candidateAgent',
   'cardName','requestMode','statusBarPlacement','statusSections','webSearchEnabled','candidates','taskMailbox','regenInProgress','settleError','scriptState',
   'hiddenDshErrorTurns','suppressedDshTurns','replacingDshTurns','regeneratedDshTurns','tavernHelperLifecycleRevision','importHistory','rollbackUndo','pendingMvuSettlement'])
  if(Object.values(chat.timeline?.operations??{}).some(op=>op?.kind==='body'&&op.status==='foreground-completed'))return projectChatSessionState((await read(id)).chat)
  // Cached rows never leave this module: full projections detach them below,
  // scoped projections clone each row on access. Snapshot identity pins validity.
  const {messages,pending}=await sessionSummaries(id,view)
  chat.messages=messages
  return projectChatSessionState(chat,{pendingMvuSettlement:options.scoped!==true&&Object.hasOwn(chat,'pendingMvuSettlement')?chat.pendingMvuSettlement:pending,...(options.scoped===true?{messages:createScopedMessages(messages.length,[],position=>structuredClone(messages[position]))}:{})})
 }
 function sessionSummary(row){const variables=row.variables?.[Math.max(0,Number(row.swipeId)||0)];return JSON.parse(JSON.stringify({mvuSnapshot:Boolean(variables&&variables.stat_data!==undefined&&variables.schema!==undefined),message:projectSessionMessage(row),pending:row.role==='assistant'&&row.mvu?.pending===true?{
  hasSubmission:Boolean(row.mvu.pendingSubmission),prepared:Boolean(row.mvu.delivery?.prepared)}:null}))}
 function currentWorld(chat){
  for(let position=(chat.messages?.length??0)-1;position>=0;position--){
   const row=chat.messages[position],swipe=Math.max(0,Number(row.swipeId)||0)
   const variables=row.variables?.[swipe]
   if(variables&&typeof variables==='object'&&!Array.isArray(variables))return {position,swipe,world:{variables,...(chat.posture!==undefined?{posture:chat.posture}:{})}}
  }
  return {position:null,swipe:0,world:{variables:{},...(chat.posture!==undefined?{posture:chat.posture}:{})}}
 }
 async function encode(id,row,previous,changes,t=tree(id)){
  const runtimeRef=previous?await mutate(t,previous.runtimeRef,changes,row):await t.create(row)
  // Pages contain identity + references only; large variables/body/extension
  // payloads live in the incremental tree and share unchanged hashed blocks.
  return {runtimeRef,...(previous?.scene?{scene:previous.scene}:{}),session:sessionSummary(row),...(row.id!==undefined?{id:row.id}:{}),...(row.role!==undefined?{role:row.role}:{})}
 }
 async function mutate(t,root,changes,next){
  try{
   for(const change of changes){
    const p=pointer(change.path)
    if(change.op==='set')root=(await t.apply(root,[{op:'set',path:p,value:change.value}])).nextRoot
    else if(change.op==='delete')root=(await t.apply(root,[{op:'remove',path:p}])).nextRoot
    else if(change.op==='splice'){
     const length=await t.size(root,p)
     if(change.index===length&&change.deleteCount===0){
      for(const item of change.items)root=(await t.apply(root,[{op:'set',path:p+'/-',value:item}])).nextRoot
     }else{
      const array=await t.get(root,p)
      array.splice(change.index,change.deleteCount,...change.items)
      root=(await t.apply(root,[{op:'set',path:p,value:array}])).nextRoot
     }
    }else throw Error('Unsupported runtime mutation')
   }
   return root
  }catch(error){
   // JSON Chat permits null-filled sparse arrays. Keep its exact normalized
   // result when that contract cannot be expressed as strict tree operations.
   if(error.code!=='STATE_DELTA_INVALID')throw error
   return t.create(next)
  }
 }
 // Point mutations can be validated against just the header and touched rows.
 // Structural edits and removal of the latest world retain the full fallback.
 async function patch(id,revision,changes,assertCurrent,returnProjection){
  const view=await head(id)
  if(!view)return null
  if(view.state.chatRevision!==revision)return undefined
  // Task metadata changes do not touch story rows, world state or indexes.
  // Apply them directly to the header tree instead of materializing the card.
  if (Array.isArray(returnProjection) && changes.length && changes.every(change =>
    ['set','delete'].includes(change.op) && change.path?.length >= 1 && ['taskMailbox','timeline','candidateAgent','candidates','scriptState','_storageRevision','updatedAt'].includes(change.path[0]))) {
   const nextRevision=changes.find(change=>change.path[0]==='_storageRevision')?.value
   if(nextRevision!==revision+1)throw Error('Invalid journal patch revision')
   const batch=createBufferedJsonRecords({read:ref=>pages.readRecord(id,ref),writeMany:(values,refs)=>pages.writeRecords(id,values,refs)})
   let chatHeaderRef=view.state.chatHeaderRef
   for (const change of changes) {
    const p=pointer(change.path)
    if (change.op === 'delete') {
     if(await batch.tree.type(chatHeaderRef,pointer(change.path.slice(0,-1))) !== 'object')throw Error('Invalid delete')
     chatHeaderRef=(await batch.tree.apply(chatHeaderRef,[{op:'remove',path:p}])).nextRoot
    } else if (change.value === undefined) {
     if (await batch.tree.get(chatHeaderRef,p) !== undefined) chatHeaderRef=(await batch.tree.apply(chatHeaderRef,[{op:'remove',path:p}])).nextRoot
    } else chatHeaderRef=(await batch.tree.apply(chatHeaderRef,[{op:'set',path:p,value:JSON.parse(JSON.stringify(change.value))}])).nextRoot
   }
   const state={...view.state,chatHeaderRef,chatRevision:nextRevision,
    ...(view.state.sceneIndexRevision===revision?{sceneIndexRevision:nextRevision}:{}),
    ...(view.state.displayIndexRevision===revision?{displayIndexRevision:nextRevision}:{})}
   assertCurrent?.()
   await batch.flush([chatHeaderRef])
   const changeRef=await pages.writeRecord(id,{baseRevision:revision,revision:nextRevision,indices:[],tail:null,layoutFrom:null})
   await pages.commit(id,{expectedRevision:view.revision,state,edits:[],append:[],truncateTo:view.messageCount,
    records:[['chat-revision:'+revision,view.snapshotCursor.snapshotId],['chat-change:'+nextRevision,changeRef]]},{assertCurrent})
   const saved=await head(id)
   return result({...await selectedHeader(id,saved,returnProjection),messages:[]},saved)
  }
  if(changes.some(change=>!change.path?.length || change.path[0]==='messages' &&
    (change.path.length<3 || !Number.isSafeInteger(change.path[1]) || change.path[1]<0 || change.path[1]>=view.messageCount)))return null
  const t=tree(id),originalHeader=await selectedHeader(id,view),rows=new Map()
  for(const change of changes){
   if(change.path[0]!=='messages'||rows.has(change.path[1]))continue
   const position=change.path[1]
   const page=await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:position+1},limit:1})
   rows.set(position,await t.get(page.messages[0].message.runtimeRef))
  }
  let nextHeader=originalHeader
  const normalized=[]
  for(const raw of changes){
   const isMessage=raw.path[0]==='messages',position=raw.path[1]
   const base=isMessage?rows.get(position):nextHeader,relative=isMessage?raw.path.slice(2):raw.path
   let change=JSON.parse(JSON.stringify(raw))
   if(raw.op==='set'&&raw.value===undefined){
    let parent=base
    for(const key of relative.slice(0,-1))parent=parent?.[key]
    if(!parent||typeof parent!=='object')throw Error('Missing mutation parent')
    if(Array.isArray(parent))change.value=null
    else if(Object.hasOwn(parent,relative.at(-1)))change={op:'delete',path:raw.path}
    else continue
   }
   const next=applyJsonChangesShared(base,[{...change,path:relative}])
   if(isMessage)rows.set(position,next);else nextHeader=next
   normalized.push(change)
  }
  if(nextHeader.id!==id||nextHeader._storageRevision!==revision+(changes.length?1:0))throw Error('Invalid journal patch revision')
  if(!changes.length){assertCurrent?.();return result({...nextHeader,messages:[]},view)}
  const old={position:view.state.worldMessage,swipe:view.state.worldSwipe,world:await t.get(view.state.worldRef)}
  let selected={...old,world:{variables:old.world.variables,...(nextHeader.posture!==undefined?{posture:nextHeader.posture}:{})}}
  // A changed newer floor may introduce a new active variable snapshot.
  const candidates=[...rows].filter(([position])=>old.position===null||position>=old.position).sort(([a],[b])=>b-a)
  for(const [position,row] of candidates){
   const swipe=Math.max(0,Number(row.swipeId)||0),variables=row.variables?.[swipe]
   if(variables&&typeof variables==='object'&&!Array.isArray(variables)){
    selected={position,swipe,world:{variables,...(nextHeader.posture!==undefined?{posture:nextHeader.posture}:{})}}
    break
   }
   if(position===old.position)return null // needs an earlier world lookup
  }
  const next={...nextHeader,messages:createScopedMessages(view.messageCount,rows)}
  const saved=await write(id,result({...originalHeader,messages:[]},view),next,normalized,assertCurrent,{old,selected})
  return {...saved,chat:{...nextHeader,messages:[]}}
 }
 async function create(id,chat,assertCurrent,{migration,verifyBeforePublish}={}){
  const batch=createBufferedJsonRecords({read:ref=>pages.readRecord(id,ref),writeMany:(values,refs)=>pages.writeRecords(id,values,refs)})
  const t=batch.tree,rows=[]
  for(const row of chat.messages??[])rows.push(await encode(id,row,undefined,undefined,t))
  const encoded=new Map(rows.map((row,i)=>[i,row]))
  const sceneIndexRef=await updateSceneIndex(id,null,encoded,rows.length,0,t,new Map((chat.messages??[]).map((row,i)=>[i,row])))
  for(const [index,row] of encoded)rows[index]=row
  const chatHeaderRef=await t.create(header(chat)),selected=currentWorld(chat)
  assertCurrent?.()
  await batch.flush([sceneIndexRef,chatHeaderRef,...rows.map(row=>row.runtimeRef)])
  // The initial head is published atomically, including runtime references.
  await domain.create(id,{world:selected.world,messages:rows,metadata:{runtimeLayout:1,...(migration?{legacyInitialRevision:chat._storageRevision}: {})},runtimeState:{displayIndexRevision:chat._storageRevision,sceneIndexRevision:chat._storageRevision,sceneIndexRef,chatHeaderRef,chatRevision:chat._storageRevision,worldMessage: selected.position,worldSwipe:selected.swipe}},{assertCurrent,verifyBeforePublish:verifyBeforePublish?async snapshotId=>verifyBeforePublish((await read(id,Infinity,snapshotId)).chat):undefined})
  return result(chat,await head(id))
 }
 async function write(id,stored,next,changes,assertCurrent,worldSelection){
  const batch=createBufferedJsonRecords({read:ref=>pages.readRecord(id,ref),writeMany:(values,refs)=>pages.writeRecords(id,values,refs)})
  const view=stored.native.view,t=batch.tree,grouped=new Map(),headChanges=[]
  let from=Infinity
  for(const change of changes){
   if(!change.path.length){from=0;headChanges.splice(0,headChanges.length,{op:'set',path:[],value:header(next)});continue}
   if(change.path[0]!=='messages'){headChanges.push(change);continue}
   if(change.path.length===1){from=Math.min(from,change.op==='splice'?change.index:0);continue}
   const position=Number(change.path[1])
   if(!grouped.has(position))grouped.set(position,[])
   grouped.get(position).push({...change,path:change.path.slice(2)})
  }
  from=Math.min(from,next.messages.length<view.messageCount?next.messages.length:Infinity)
  const retained=Math.min(from,view.messageCount),edits=[],append=[]
  for(const [position,mutations] of grouped){
   if(position>=retained)continue
   const previous=(await pages.readHistoryPage(id,{cursor:{snapshotId:view.snapshotCursor.snapshotId,before:position+1},limit:1})).messages[0].message
   edits.push({position,message:await encode(id,next.messages[position],previous,mutations,t)})
  }
  for(let position=retained;position<next.messages.length;position++)append.push(await encode(id,next.messages[position],undefined,undefined,t))
  const changedMessageIndices=edits.map(edit=>edit.position)
  let sceneFrom=from
  for(const [position,mutations] of grouped)if(mutations.some(change=>!change.path.length||['role','turn','greeting','text','sourceText','swipeId','swipes'].includes(change.path[0])))sceneFrom=Math.min(sceneFrom,position)
  let sceneIndexRef=view.state.sceneIndexRef
  // Older writers know image keys but not display metadata. Never bless their
  // retained display state on a variable-only write; a body rebuild repairs it.
  let displayIndexCurrent=view.state.displayIndexRevision===view.state.chatRevision
  if(!sceneIndexRef||view.state.sceneIndexRevision!==view.state.chatRevision||Number.isFinite(sceneFrom)){
   const encoded=new Map([...edits.map(edit=>[edit.position,edit.message]),...append.map((row,i)=>[retained+i,row])])
   const sources=new Map([...encoded.keys()].map(index=>[index,next.messages[index]]))
   sceneIndexRef=await updateSceneIndex(id,view,encoded,next.messages.length,displayIndexCurrent?Math.min(sceneFrom,next.messages.length):0,t,sources)
   displayIndexCurrent=true
   edits.length=0;append.length=0
   for(const [position,message] of [...encoded].sort(([a],[b])=>a-b)){
    if(position<retained)edits.push({position,message});else append.push(message)
   }
  }
  const selected=worldSelection?.selected??currentWorld(next),old=worldSelection?.old??currentWorld(stored.chat)
  // Reuse the exact received leaf changes on the common settlement hot path.
  // Switching swipes/rollback selects another world and explicitly diffs it.
  let worldChanges
  if(old.position===selected.position&&old.swipe===selected.swipe&&from>selected.position){
   worldChanges=[]
   for(const change of grouped.get(selected.position)??[]){
    if(!change.path.length){worldChanges=null;break}
    if(change.path[0]!=='variables')continue
    if(change.path.length<2){worldChanges=null;break}
    if(Number(change.path[1])===selected.swipe)worldChanges.push({...change,path:['variables',...change.path.slice(2)]})
   }
   if(worldChanges)worldChanges.push(...diffJson(Object.hasOwn(old.world,'posture')?{posture:old.world.posture}:{},Object.hasOwn(selected.world,'posture')?{posture:selected.world.posture}:{}))
  }
  worldChanges??=diffJson(old.world,selected.world)
  const worldRef=await mutate(t,view.state.worldRef,worldChanges,selected.world)
  const chatHeaderRef=await mutate(t,view.state.chatHeaderRef,headChanges,header(next))
  const state={...view.state,displayIndexRevision:displayIndexCurrent?next._storageRevision:view.state.displayIndexRevision,sceneIndexRevision:next._storageRevision,sceneIndexRef,chatHeaderRef,chatRevision:next._storageRevision,worldRef,
   worldMessage:selected.position,worldSwipe:selected.swipe,
   storyRevision:view.state.storyRevision+(append.length||changedMessageIndices.length||retained<view.messageCount?1:0),
   worldRevision:view.state.worldRevision+(worldRef!==view.state.worldRef?1:0)}
  assertCurrent?.()
  await batch.flush([sceneIndexRef,worldRef,chatHeaderRef,...edits.map(edit=>edit.message.runtimeRef),...append.map(row=>row.runtimeRef)])
  let layoutFrom=Number.isFinite(from)?from:null
  for(const [position,mutations] of grouped)if(mutations.some(change=>!change.path.length||['turn','role','greeting','tavernRole','importSource'].includes(change.path[0])))layoutFrom=Math.min(layoutFrom??Infinity,position)
  const changeRef=await pages.writeRecord(id,{baseRevision:stored.revision,revision:next._storageRevision,
   indices:changedMessageIndices,tail:Number.isFinite(from)?from:null,layoutFrom})
  await pages.commit(id,{expectedRevision:view.revision,state,edits,append,truncateTo:retained,
   records:[['chat-revision:'+stored.revision,view.snapshotCursor.snapshotId],['chat-change:'+next._storageRevision,changeRef]]},{assertCurrent})
  return result(next,await head(id))
 }
 // Physically drop revisions nothing can reach any more. `retain(revision)`
 // names the revisions rollback, undo, recovery and forks still need; the
 // newest keepRecent revisions also stay for in-flight work.
 // Only the header fields that decide which old revisions must stay readable.
 async function readRetentionHeader(id,revision=Infinity){
  const view=await headAtRevision(id,revision)
  if(!view)return null
  const header=await selectedHeader(id,view,['timeline','rollbackUndo','regenRecovery','forkedFrom','regenInProgress'])
  return {...header,id,_storageRevision:view.state.chatRevision,legacyInitialRevision:view.metadata.settings?.legacyInitialRevision}
 }
 // `exclusive(step)` runs one short publishing or deleting step alone with this save's writers.
 async function compact(id,{retain=()=>false,keepRecent=64,changeFloor,graceMs,dryRun,exclusive,signal}={}){
  const view=await head(id)
  if(!view)return null
  const current=view.state.chatRevision
  const needed=key=>{
   const revision=/^chat-revision:(\d+)$/.exec(key)
   if(revision)return Number(revision[1])>current-keepRecent||retain(Number(revision[1]))
   // Change records serve incremental reads over a recent window; rollback
   // reads back to its checkpoint, so the caller may extend the window.
   const change=/^chat-change:(\d+)$/.exec(key)
   return !change||Number(change[1])>Math.min(current-CHANGE_WINDOW,Number.isSafeInteger(changeFloor)?changeFloor:Infinity)
  }
  // Drop the index keys first: one small file per revision otherwise stays forever.
  const pruned=dryRun?{removed:0}:await pages.pruneEntries(id,needed,{exclusive})
  const result=await pages.sweep(id,{graceMs,dryRun,retainEntry:needed,exclusive,signal})
  return {...result,indexKeysRemoved:pruned.removed}
 }
 // Contiguous packs in read order for a fragmented current head; no lock while reading.
 async function relayout(id,options){return pages.relayout(id,options)}
 return Object.freeze({compact,relayout,readRetentionHeader,patch,read,readWindow,readStageView,readStageFloors,readRecentSummaries,readSettlementBase,readChangedSlice,readRevisionMetadata,readHelperContext,readSlice,readSessionState,readDisplayRuntimeState,readSceneImageState,version,create,write})
}
