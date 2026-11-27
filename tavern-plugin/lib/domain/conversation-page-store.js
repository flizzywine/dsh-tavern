import {createHash, randomUUID} from 'node:crypto'
import {mkdir, open, opendir, readFile, readdir, rename, rm, link, stat, unlink, utimes} from 'node:fs/promises'
import path from 'node:path'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
import {channel} from 'node:diagnostics_channel'
import {performance} from 'node:perf_hooks'
import {createConversationReadLanes,conversationReadLane} from './conversation-read-lanes.js'
import {createConversationSqliteBackend,SQLITE_FORMAT} from './conversation-sqlite-store.js'
const readMetrics=channel('dsh.chat.read')

// Syncing every touched directory on every commit costs tens of milliseconds each on a phone.
// Inside a relaxed window the store only remembers them; the window's end syncs each once,
// before whatever makes the imported conversation visible. Durability is unchanged: nothing
// references a block whose directory entry has not been made durable.
let relaxedDepth=0
const relaxedDirectories=new Set()
async function fsyncDirectoryRaw(dir){
 if(process.platform==='win32')return
 const handle=await open(dir,'r')
 try{await handle.sync()}catch(error){if(!['EINVAL','ENOTSUP','EISDIR'].includes(error.code))throw error}finally{await handle.close()}
}
export function beginRelaxedSync(){relaxedDepth+=1}
export function relaxedSyncPending(){return relaxedDirectories.size}
export async function endRelaxedSync(){
 if(relaxedDepth>0)relaxedDepth-=1
 if(relaxedDepth>0)return
 const dirs=[...relaxedDirectories].sort((left,right)=>right.length-left.length)
 relaxedDirectories.clear()
 if(!dirs.length)return
 let index=0
 const results=await Promise.allSettled(Array.from({length:Math.min(8,dirs.length)},async()=>{
  while(index<dirs.length)await fsyncDirectoryRaw(dirs[index++])
 }))
 const failed=results.find(result=>result.status==='rejected')
 if(failed)throw failed.reason
}

// New-format foundation, deliberately not an automatic legacy Chat migration.
// Only the small head pointer is mutable. Readers pin immutable snapshots;
// append/point edits copy a bounded page and its radix-tree path.
const PAGE_SIZE=64, FANOUT=32, FORMAT=1
// Head pointer format. 2: blocks may live in block packs (any block kind,
// several per file); 3: blocks and head_id live in a single SQLite database
// (chat.sqlite) so file count stays constant; older releases refuse it cleanly.
const POINTER_FORMAT=2
const readablePointer=format=>format===1||format===POINTER_FORMAT||format===SQLITE_FORMAT
const PACK_BYTES=64*1024, PACK_ENTRIES=256
const hash=value=>createHash('sha256').update(value).digest('hex')
// The one record-block encoding. Callers that address records before
// writing them (buffered-json-records) use it and pass the refs to writeRecords,
// which then trusts them instead of hashing every record a second time.
const recordBlockBytes=value=>JSON.stringify({kind:'record',value})
export function recordBlock(value){const bytes=recordBlockBytes(value);return {bytes,ref:hash(bytes)}}
const copy=value=>JSON.parse(JSON.stringify(value))
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
// a long-lived save scatters each floor's tree nodes over thousands of
// commit packs, so a cold read needs one or two blocks from each 64 KiB pack. Decoding
// whole packs for that made opening such a save parse gigabytes of JSON (the RSS peak
// on first chat open). Locate the requested entry in the raw bytes and parse only it.
const BLOCK_PACK=Buffer.from('{"kind":"block-pack-v1","records":['),RECORD_PACK=Buffer.from('{"kind":"record-pack-v1","records":[')
const QUOTE=0x22,BACKSLASH=0x5c
// End offset of the JSON value starting at `start`. Structural bytes are ASCII, so
// scanning UTF-8 bytes is exact; strings are skipped with native quote search.
function jsonValueEnd(buffer,start){
 let depth=0,i=start
 while(i<buffer.length){
  const c=buffer[i]
  if(c===QUOTE){
   let q=i+1
   for(;;){
    q=buffer.indexOf(QUOTE,q)
    if(q<0)return -1
    let slashes=0
    while(buffer[q-1-slashes]===BACKSLASH)slashes++
    if(slashes%2===0)break
    q++
   }
   i=q+1
   if(!depth)return i
   continue
  }
  if(c===0x7b||c===0x5b)depth++
  else if(c===0x7d||c===0x5d){if(!depth)return i;if(--depth===0)return i+1}
  else if(!depth&&c===0x2c)return i
  i++
 }
 return -1
}
// Entry offsets of a pack file as [[ref,start,end]], or undefined when the bytes are
// not a well-formed pack (the whole-file decoder then reports the exact error).
function packOffsets(buffer){
 const blocks=buffer.subarray(0,BLOCK_PACK.length).equals(BLOCK_PACK)
 if(!blocks&&!buffer.subarray(0,RECORD_PACK.length).equals(RECORD_PACK))return undefined
 const offsets=[],seen=new Set()
 let i=blocks?BLOCK_PACK.length:RECORD_PACK.length
 for(;;){
  if(buffer[i]!==0x5b||buffer[i+1]!==QUOTE||buffer[i+66]!==QUOTE||buffer[i+67]!==0x2c)return undefined
  const ref=buffer.toString('latin1',i+2,i+66),start=i+68,end=jsonValueEnd(buffer,start)
  if(end<0||buffer[end]!==0x5d||seen.has(ref)||offsets.length>=PACK_ENTRIES)return undefined
  seen.add(ref);offsets.push([ref,start,end]);i=end+1
  if(buffer[i]===0x2c){i++;continue}
  return buffer[i]===0x5d&&buffer[i+1]===0x7d&&i+2===buffer.length?{blocks,offsets}:undefined
 }
}
function decodeEntry(entry){
 const value=JSON.parse(entry.raw.toString('utf8',entry.start,entry.end)),block=entry.blocks?value:{kind:'record',value}
 if(!record(block)||typeof block.kind!=='string')throw Error('Invalid immutable block')
 return block
}
// Every 64-hex string inside a value, in document order: candidate block references.
function hexRefs(value,out=[]){
 if(typeof value==='string'){if(/^[a-f0-9]{64}$/.test(value))out.push(value)}
 else if(Array.isArray(value))for(const item of value)hexRefs(item,out)
 else if(record(value))for(const item of Object.values(value))hexRefs(item,out)
 return out
}
// a relayout rewrites the current head only when a cold open would
// read more than RELAYOUT_RATIO times the packs a contiguous layout needs, and by
// at least RELAYOUT_MIN_EXCESS packs (about 4 MiB) so small saves never churn.
// Relayout links RELAYOUT_LINK_BATCH blocks at a time outside the write lock; a step that renames them stops taking
// renames once RELAYOUT_YIELD_MS have passed and releases the lock by RELAYOUT_STEP_MS whatever is still running.
const RELAYOUT_RATIO=2,RELAYOUT_MIN_EXCESS=64,RELAYOUT_YIELD_MS=200,RELAYOUT_STEP_MS=300,RELAYOUT_LINK_BATCH=1024
// the sweep's deletions take the write lock in steps of at most about
// RELAYOUT_YIELD_MS, like relayout; everything that scales with the number of files
// (marking, listing) runs outside it, so a save full of garbage never freezes play.
const SWEEP_PARALLEL=16,SWEEP_LIST_BATCH=4096
// A cold read that loads this many pack files of one save (about 8 MiB) is worth
// one relayout measurement; the measurement alone decides whether to rewrite.
export const RELAYOUT_COLD_VISITS=RELAYOUT_RATIO*RELAYOUT_MIN_EXCESS
// Pack files one traced request loaded per save, from its `chat.block:<chatId>[:<lane>]` read rows.
export function blockVisits(reads=[]){
 const visits=new Map()
 for(const {key,count} of reads){const [name,chatId]=key.split(':');if(name==='chat.block'&&chatId)visits.set(chatId,(visits.get(chatId)||0)+count)}
 return visits
}
function conflict(){return Object.assign(new Error('Conversation revision conflict'),{code:'CONVERSATION_CONFLICT'})}
function integer(value,min=0){return Number.isSafeInteger(value)&&value>=min}

const noopIO=()=>{}
export const supportsIndependentFiles = true
export function createConversationPageStore({root,onIO=noopIO,linkFile=link,unlinkFile=unlink,format=SQLITE_FORMAT,keepOpenMs=0}={}) {
 if(format!==POINTER_FORMAT&&format!==SQLITE_FORMAT)throw Error('Unsupported conversation storage format')
 const independentFiles=process.env.DSH_STORAGE_COPY_ONLY==='1'
 if(!root)throw Error('Conversation store requires root')
 root=path.resolve(root)
 const sqlite=createConversationSqliteBackend({onIO,keepOpenMs})
 // A live, slow writer must never lose its lock merely due to elapsed time.
 // Dead process recovery and pending head promotion use the existing protocol.
 const promotion=createDurableFilePromotion({writeLockStaleMs:Number.MAX_SAFE_INTEGER})
 // Block names a sweep is removing (file -> its stat+unlink) and names a writer is reusing (file -> count).
 // A sweep step may release the lock while a removal is still running; a writer of this store that finds
 // the name waits for that removal first, and the sweep never starts removing a name being reused.
 // Save maintenance runs in the process that writes the save, so this covers every writer.
 const removing=new Map(),reusing=new Map()
 async function reusingName(file,work){
  while(removing.has(file))await removing.get(file).catch(()=>{})
  reusing.set(file,(reusing.get(file)||0)+1)
  try{return await work()}finally{const left=reusing.get(file)-1;if(left)reusing.set(file,left);else reusing.delete(file)}
 }
 // One shared budget must cover foreground and sidebar reads together; an 8 MiB
 // budget repeatedly evicted sibling records from the same immutable disk pack.
 const packedLimit=16*1024*1024
 const packed=new Map(),packs=new Map(),loading=new Map();let packedBytes=0
 const scheduleRead=createConversationReadLanes()
 // Admission and eviction follow the physical pack, not individual siblings.
 // A sibling hit keeps the raw pack warm; sizing uses its bytes once instead
 // of re-serializing every stored record on every read.
 function evict(keep){
  while(packs.size>(keep?1:0)&&packedBytes>packedLimit){
   const oldest=packs.keys().next().value;packedBytes-=packs.get(oldest);packs.delete(oldest)
   for(const key of oldest)if(packed.get(key)?.pack===oldest)packed.delete(key)
  }
 }
 function admit(pack,entries,size){
  if(size>packedLimit)return
  packedBytes+=size;evict(false);packedBytes-=size
  entries.forEach((entry,index)=>{entry.pack=pack;packed.set(pack[index],entry)})
  packs.set(pack,size);packedBytes+=size
 }
 // Cached entries remember the pack they were read with; a layout measurement
 // needs the packs now on disk.
 function forget(dir){
  for(const [pack,size] of packs)if(pack[0].startsWith(dir+'/')){
   packs.delete(pack);packedBytes-=size
   for(const key of pack)if(packed.get(key)?.pack===pack)packed.delete(key)
  }
 }
 function cachePacked(dir,entries,size){admit(entries.map(([id])=>dir+'/'+id),entries.map(([,value])=>({value})),size)}
 // A raw pack costs its bytes; each sibling is parsed from its slice only when read.
 function cacheRawPack(dir,raw,{blocks,offsets}){
  admit(offsets.map(([ref])=>dir+'/'+ref),offsets.map(([,start,end])=>({raw,blocks,start,end})),raw.length)
 }
 // blocks are this store's own content-addressed files. The id
 // is the lookup key; reads parse and dispatch on `kind` without re-hashing.
 function decodeBlock(dir,id,bytes){
  let value
  try{value=JSON.parse(bytes)}catch{throw Error('Invalid immutable block')}
  if(!record(value)||typeof value.kind!=='string')throw Error('Invalid immutable block')
  if(value.kind!=='record-pack-v1'&&value.kind!=='block-pack-v1'){
   // Content hashes are immutable across revisions. Keep small index/record
   // blocks warm across field reads; the mutable head pointer is never cached.
   if(Buffer.byteLength(bytes)<=64*1024)cachePacked(dir,[[id,value]],Buffer.byteLength(bytes)*2+128)
   return value
  }
  if(!Array.isArray(value.records)||value.records.length>PACK_ENTRIES)throw Error('Invalid immutable record pack')
  const entries=[],seen=new Set()
  for(const entry of value.records){
   if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||seen.has(entry[0]))throw Error('Invalid immutable record pack')
   const [ref,item]=entry,block=value.kind==='block-pack-v1'?item:{kind:'record',value:item}
   if(!record(block)||typeof block.kind!=='string')throw Error('Invalid immutable block')
   seen.add(ref);entries.push([ref,block])
  }
  if(!seen.has(id))throw Error('Immutable pack is missing requested block')
  cachePacked(dir,entries,Buffer.byteLength(bytes)*2)
  return entries.find(entry=>entry[0]===id)[1]
 }
 function directory(id){
  if(typeof id!=='string'||!id||id==='.'||id==='..'||/[\\/\0]/.test(id))throw Error('Invalid conversation id')
  return path.join(root,id)
 }
 async function detectBackend(dir,allowMissingHead=false){
  const sessionBackend=sqlite.getSessionBackend(dir)
  if(sessionBackend&&allowMissingHead)return {backend:sessionBackend,pointer:null}
  const bytes=await promotion.read(path.join(dir,'head.json'))
  if(bytes!==undefined){
   const pointer=JSON.parse(bytes)
   if(pointer.format===SQLITE_FORMAT){sqlite.setSessionBackend(dir,'sqlite');return {backend:'sqlite',pointer}}
   if(pointer.format===1||pointer.format===POINTER_FORMAT){sqlite.setSessionBackend(dir,'files');return {backend:'files',pointer}}
   throw Error('Unsupported conversation format')
  }
  if(!allowMissingHead)return {backend:null,pointer:null}
  if(sqlite.hasDatabase(dir)){sqlite.setSessionBackend(dir,'sqlite');return {backend:'sqlite',pointer:null}}
  return {backend:format===SQLITE_FORMAT?'sqlite':'files',pointer:null}
 }
 function blobPath(dir,id){
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid block reference')
  return path.join(dir,'blocks',id.slice(0,2),id+'.json')
 }
 async function syncDirectory(dir){
  if(relaxedDepth>0){relaxedDirectories.add(dir);return}
  await fsyncDirectoryRaw(dir)
 }
 async function writeBlock(dir,value,directories,known){
  const bytes=known?.bytes??JSON.stringify(value),id=known?.id??hash(bytes),target=blobPath(dir,id),parent=path.dirname(target)
  await mkdir(parent,{recursive:true})
  if(directories){directories.add(parent);directories.add(path.dirname(parent));directories.add(dir)}
  if(await reusingName(target,async()=>{
   let existing
   try{existing=await readFile(target,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
   if(existing===undefined)return false
   onIO({kind:'read',type:value.kind,bytes:Buffer.byteLength(existing),reason:'deduplication'})
   if(existing!==bytes&&JSON.stringify(decodeBlock(dir,id,existing))!==bytes)throw Error('Immutable block corruption')
   return reused(target)
  }))return id
  const staging=target+'.staging-'+randomUUID()
  let handle
  try{
   handle=await open(staging,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null
   await rename(staging,target)
   if(!directories){
    await syncDirectory(parent)
    await syncDirectory(path.dirname(parent))
    await syncDirectory(dir)
   }
  }finally{if(handle)await handle.close();await rm(staging,{force:true})}
  onIO({kind:'write',type:value.kind,bytes:Buffer.byteLength(bytes)})
  return id
 }
 // A deduplicated block may be one nothing reaches any more; the caller is about to
 // reference it. Its new mtime puts it inside the sweep's grace period like a fresh write.
 // A sweep may remove it in between: then it is written again.
 async function reused(file){
  const now=new Date()
  try{await utimes(file,now,now);return true}catch(error){if(error.code==='ENOENT')return false;throw error}
 }
 function cachedBlock(dir,id){
  const entry=packed.get(dir+'/'+id)
  if(!entry)return undefined
  let decoded=0
  if(entry.value===undefined){entry.value=decodeEntry(entry);decoded=(entry.end-entry.start)*2}
  const size=packs.get(entry.pack)+decoded;packs.delete(entry.pack)
  packs.set(entry.pack,size);packedBytes+=decoded;evict(true)
  return entry.value
 }
 // A concurrent sibling read may already have admitted this same pack.
 function admitFile(dir,id,bytes){
  let value=cachedBlock(dir,id)
  if(!value){
   const pack=packOffsets(bytes)
   if(pack?.offsets.some(([ref])=>ref===id)){cacheRawPack(dir,bytes,pack);value=cachedBlock(dir,id)}
   value||=decodeBlock(dir,id,bytes.toString('utf8'))
  }
  return value
 }
 function readSqliteBlockSync(dir,id,lane,queueMs,chatId,cacheBlock){
  const trackMetrics=readMetrics.hasSubscribers
  const started=trackMetrics?performance.now():0
  const raw=sqlite.readBlockRaw(dir,id)
  if(!raw)throw Object.assign(Error('Block not found: '+id),{code:'ENOENT'})
  const loaded=trackMetrics?performance.now():0
  if(raw.encoding!==0)throw Error('Unsupported block encoding')
  let value
  const text=typeof raw.data==='string'?raw.data:Buffer.from(raw.data.buffer,raw.data.byteOffset,raw.data.byteLength).toString('utf8')
  try{value=JSON.parse(text)}catch{throw Error('Invalid immutable block')}
  if(!record(value)||typeof value.kind!=='string')throw Error('Invalid immutable block')
  const byteLen=raw.byteLen??Buffer.byteLength(text)
  if(cacheBlock&&byteLen<=64*1024)cachePacked(dir,[[id,value]],byteLen*2+128)
  if(trackMetrics){
   const parsed=performance.now()
   const event={kind:'read',type:value.kind,bytes:byteLen,chatId,ref:id,lane:lane||conversationReadLane(),queueMs,readMs:loaded-started,decodeMs:parsed-loaded}
   onIO(event)
   readMetrics.publish({name:'chat.block',durationMs:parsed-started,...event})
  }else if(onIO!==noopIO){
   onIO({kind:'read',type:value.kind,bytes:byteLen,chatId,ref:id,lane:'',queueMs:0,readMs:0,decodeMs:0})
  }
  return value
 }
 function reader(dir,backendHint){
  // Reader-local references sit over a bounded immutable block cache.
  const cache=new Map()
  let resolvedBackend=backendHint||sqlite.getSessionBackend(dir)
  async function readBlock(id,kind){
   if(!cache.has(id)){
    const remembered=cachedBlock(dir,id)
    if(remembered)cache.set(id,remembered)
    else if((resolvedBackend||sqlite.getSessionBackend(dir))==='sqlite'){
     resolvedBackend='sqlite'
     cache.set(id,readSqliteBlockSync(dir,id,'',0,path.basename(dir),true))
    }else {
     const key=dir+'/'+id
     let pending=loading.get(key)
     if(!pending){
      const queued=performance.now()
      pending=scheduleRead(async lane=>{
       if(!resolvedBackend)resolvedBackend=(await detectBackend(dir,true)).backend
       if(resolvedBackend==='sqlite')return readSqliteBlockSync(dir,id,lane,performance.now()-queued,path.basename(dir),true)
       const started=performance.now(),bytes=await readFile(blobPath(dir,id)),loaded=performance.now()
       const value=admitFile(dir,id,bytes)
       const parsed=performance.now()
       const event={kind:'read',type:value.kind,bytes:bytes.length,chatId:path.basename(dir),ref:id,lane,queueMs:started-queued,readMs:loaded-started,decodeMs:parsed-loaded}
       onIO(event)
       if(readMetrics.hasSubscribers)readMetrics.publish({name:'chat.block',durationMs:parsed-started,...event})
       return value
      })
      loading.set(key,pending)
     }else if(conversationReadLane()!=='background')pending.promote()
     try{cache.set(id,await pending.promise)}finally{if(loading.get(key)===pending)loading.delete(key)}
    }
   }
   const value=cache.get(id)
   if(kind&&value.kind!==kind)throw Error('Invalid block type')
   return value
  }
  readBlock.setBackend=backend=>{resolvedBackend=backend}
  return readBlock
 }
 function validateHead(head,id){
  if(head.format!==FORMAT||head.id!==id||!integer(head.revision,1)||!integer(head.count)||!integer(head.height)||head.height>10)throw Error('Invalid conversation head')
  return head
 }
 async function current(dir,id,read){
  const started=performance.now();let lane
  const bytes=await scheduleRead(dispatched=>{lane=dispatched;return promotion.read(path.join(dir,'head.json'))}).promise
  if(readMetrics.hasSubscribers)readMetrics.publish({name:'chat.head',chatId:id,lane,durationMs:performance.now()-started,bytes:bytes?.length||0})
  if(bytes===undefined)return undefined
  const pointer=JSON.parse(bytes)
  if(!readablePointer(pointer.format))throw Error('Unsupported conversation format')
  if(pointer.format===SQLITE_FORMAT){
   read.setBackend?.('sqlite');sqlite.setSessionBackend(dir,'sqlite')
   const headId=sqlite.getHeadId(dir)
   if(!headId)throw Error('Invalid conversation head')
   return {head:validateHead(await read(headId,'head'),id),headId}
  }
  read.setBackend?.('files');sqlite.setSessionBackend(dir,'files')
  return {head:validateHead(await read(pointer.headId,'head'),id),headId:pointer.headId}
 }
 async function leaf(read,root,height,page){
  if(root===null)return []
  if(height===0)return (await read(root,'page')).messages
  const node=await read(root,'index'),slot=Math.floor(page/FANOUT**(height-1))%FANOUT
  if(!node.children[slot])throw Error('History index missing page')
  return leaf(read,node.children[slot],height-1,page)
 }
 async function setLeaf(dir,read,root,height,page,messages,write=value=>writeBlock(dir,value)){
  if(height===0)return write({kind:'page',messages})
  const children=root===null?[]:[...(await read(root,'index')).children]
  const slot=Math.floor(page/FANOUT**(height-1))%FANOUT
  // Explicit nulls keep sparse new branches stable after JSON serialization.
  while(children.length<=slot)children.push(null)
  children[slot]=await setLeaf(dir,read,children[slot],height-1,page,messages,write)
  return write({kind:'index',children})
 }
 async function build(dir,messages,write=value=>writeBlock(dir,value)){
  let refs=[]
  for(let i=0;i<messages.length;i+=PAGE_SIZE)refs.push(await write({kind:'page',messages:messages.slice(i,i+PAGE_SIZE)}))
  let height=0
  while(refs.length>1){
   const next=[]
   for(let i=0;i<refs.length;i+=FANOUT)next.push(await write({kind:'index',children:refs.slice(i,i+FANOUT)}))
   refs=next;height++
  }
  return {root:refs[0]??null,height}
 }
 function recordKey(key){if(typeof key!=='string'||!key||key.length>512)throw Error('Invalid record key');return hash(key)}
 async function lookup(read,root,key,route,depth=0){
  if(!root)return undefined
  const node=await read(root)
  if(node.kind==='entry')return node.key===key?node.valueRef:undefined
  if(node.kind!=='entries'||depth>=64)throw Error('Invalid record index')
  return lookup(read,node.children[route[depth]],key,route,depth+1)
 }
 // Batch entries by hash path so imports do not rewrite the same branch per key.
 async function putEntries(dir,read,root,updates,depth=0,write=value=>writeBlock(dir,value)){
  const node=root?await read(root):null
  if(!node||node.kind==='entry'){
   const merged=new Map(node?[[node.key,{key:node.key,valueRef:node.valueRef,route:recordKey(node.key)}]]:[])
   for(const entry of updates)merged.set(entry.key,entry)
   updates=[...merged.values()]
   if(updates.length===1){const {key,valueRef}=updates[0];return write({kind:'entry',key,valueRef})}
  }else if(node.kind!=='entries')throw Error('Invalid record index')
  if(depth>=64)throw Error('Record key hash collision')
  const children=node?.kind==='entries'?{...node.children}:{},groups=new Map()
  for(const entry of updates){const slot=entry.route[depth];if(!groups.has(slot))groups.set(slot,[]);groups.get(slot).push(entry)}
  for(const [slot,entries] of groups)children[slot]=await putEntries(dir,read,children[slot],entries,depth+1,write)
  return write({kind:'entries',children})
 }
 async function create(id,input,{assertCurrent,verifyBeforePublish}={}){
  const dir=directory(id),value=copy(input)
  if(!record(value.state)||!Array.isArray(value.messages??[])||!(value.messages??[]).every(record))throw Error('Invalid initial conversation')
  let result
  await sqlite.withSession(dir,()=>promotion.update(path.join(dir,'head.json'),async current=>{
   if(current!==undefined)throw conflict()
   // Build the initial page/state/metadata/head graph in memory. One packed flush
   // replaces four or more file fsyncs plus their per-block directory barriers.
   const pending=new Map()
   const write=async block=>{const bytes=JSON.stringify(block),ref=hash(bytes);pending.set(ref,{ref,block,bytes});return ref}
   const messages=value.messages??[],tree=await build(dir,messages,write)
   const head={kind:'head',format:FORMAT,id,revision:1,count:messages.length,...tree,
    stateId:await write({kind:'state',value:value.state}),metadataId:await write({kind:'metadata',value:value.metadata??{}})}
   const headId=await write(head)
   if(format===SQLITE_FORMAT){
    sqlite.createInitial(dir,id,[...pending.values()],headId)
    result={revision:1,snapshotId:headId}
    await verifyBeforePublish?.(headId)
    assertCurrent?.()
    return JSON.stringify({format:SQLITE_FORMAT,engine:'sqlite'})
   }
   // Verification reads the flushed immutable graph before the mutable pointer
   // names it, exactly as commit() does for every subsequent revision.
   await writePacked(dir,[...pending.values()].map(entry=>entry.block),[...pending.keys()])
   result={revision:1,snapshotId:headId}
   await verifyBeforePublish?.(headId)
   assertCurrent?.()
   return JSON.stringify({format:POINTER_FORMAT,headId})
  }))
  return result
 }
 async function buildCommitGraph(dir,id,read,write,headId,change){
  const head=validateHead(await read(headId,'head'),id)
  if(head.revision!==change.expectedRevision)throw conflict()
  if(!integer(head.revision+1,1))throw Error('Revision overflow')
  const retained=change.truncateTo ?? head.count
  if(!integer(retained)||retained>head.count)throw Error('Invalid truncation')
  const pages=new Map()
  async function pageAt(page){
   if(!pages.has(page))pages.set(page,page*PAGE_SIZE<retained?(await leaf(read,head.root,head.height,page)).slice(0,Math.min(PAGE_SIZE,retained-page*PAGE_SIZE)):[])
   return pages.get(page)
  }
  for(const edit of change.edits??[]){
   if(!integer(edit.position)||edit.position>=retained||!record(edit.message))throw Error('Invalid edit position or message')
   const page=Math.floor(edit.position/PAGE_SIZE)
   ;(await pageAt(page))[edit.position%PAGE_SIZE]=edit.message
  }
  if(retained<head.count&&retained%PAGE_SIZE)await pageAt(Math.floor(retained/PAGE_SIZE))
  let count=retained
  for(const message of change.append??[]){
   if(!integer(count+1)||count>=PAGE_SIZE*FANOUT**10)throw Error('History capacity exceeded')
   ;(await pageAt(Math.floor(count/PAGE_SIZE)))[count%PAGE_SIZE]=message;count++
  }
  let {root:treeRoot,height}=head
  const lastPage=Math.max(0,Math.ceil(count/PAGE_SIZE)-1)
  while(lastPage>=FANOUT**height){treeRoot=await write({kind:'index',children:treeRoot?[treeRoot]:[]});height++}
  for(const [page,messages] of pages)treeRoot=await setLeaf(dir,read,treeRoot,height,page,messages,write)
  const next={...head,revision:head.revision+1,count,root:treeRoot,height,previousHeadId:headId}
  if(change.records!==undefined){
   if(!Array.isArray(change.records))throw Error('Invalid keyed records')
   const updates=new Map()
   for(const entry of change.records){
    if(!Array.isArray(entry)||entry.length!==2)throw Error('Invalid keyed record')
    const [key,value]=entry,route=recordKey(key)
    const valueRef=await write({kind:'record',value})
    updates.set(key,{key,valueRef,route})
   }
   if(updates.size)next.recordRoot=await putEntries(dir,read,next.recordRoot,[...updates.values()],0,write)
  }
  if(Object.hasOwn(change,'state'))next.stateId=await write({kind:'state',value:change.state})
  if(Object.hasOwn(change,'metadata'))next.metadataId=await write({kind:'metadata',value:change.metadata})
  const nextHeadId=await write(next)
  return {next,headId:nextHeadId}
 }
 function addExtraRecords(pending,extraRecords){
  if(extraRecords===undefined)return
  if(!Array.isArray(extraRecords))throw Error('Invalid extra records')
  for(const item of extraRecords){
   const block={kind:'record',value:item.value},bytes=item.bytes??JSON.stringify(block),ref=item.ref??hash(bytes)
   pending.set(ref,{ref,block,bytes})
  }
 }
 async function commit(id,input,{assertCurrent}={}){
  const dir=directory(id),change=copy(input)
  if(!integer(change.expectedRevision,1)||!Array.isArray(change.append??[])||!(change.append??[]).every(record)
    ||!Array.isArray(change.edits??[])||(Object.hasOwn(change,'state')&&!record(change.state)))throw Error('Invalid commit')
  const detected=await detectBackend(dir,false)
  if(!detected.backend)throw conflict()
  if(detected.backend==='sqlite'){
   return sqlite.serializeWrite(dir,()=>sqlite.withSession(dir,async()=>{
    const initialHeadId=sqlite.getHeadId(dir,{fresh:true})
    if(!initialHeadId)throw conflict()
    const diskRead=reader(dir,'sqlite'),pending=new Map()
    const write=async block=>{const bytes=JSON.stringify(block),ref=hash(bytes);pending.set(ref,{ref,block,bytes});return ref}
    const read=async (ref,kind)=>{
     if(!pending.has(ref))return diskRead(ref,kind)
     const value=pending.get(ref).block
     if(kind&&value.kind!==kind)throw Error('Invalid block type')
     return value
    }
    addExtraRecords(pending,change.extraRecords)
    const {next,headId}=await buildCommitGraph(dir,id,read,write,initialHeadId,change)
    sqlite.commitHead(dir,initialHeadId,[...pending.values()],headId,{assertCurrent})
    return {revision:next.revision,snapshotId:headId}
   }))
  }
  const diskRead=reader(dir,'files'),pending=new Map()
  // References depend on content, not write order. Build the new immutable graph
  // in memory, then durably flush independent blocks before publishing its head.
  const write=async block=>{const bytes=JSON.stringify(block),ref=hash(bytes);pending.set(ref,{ref,block,bytes});return ref}
  const read=async (ref,kind)=>{
   if(!pending.has(ref))return diskRead(ref,kind)
   const value=pending.get(ref).block
   if(kind&&value.kind!==kind)throw Error('Invalid block type')
   return value
  }
  async function flush(){await writePacked(dir,[...pending.values()].map(entry=>entry.block),[...pending.keys()])}
  let result
  await promotion.update(path.join(dir,'head.json'),async pointer=>{
   if(pointer===undefined)throw conflict()
   const reference=JSON.parse(pointer)
   if(reference.format!==1&&reference.format!==POINTER_FORMAT)throw Error('Unsupported conversation format')
   pending.clear()
   addExtraRecords(pending,change.extraRecords)
   const {next,headId}=await buildCommitGraph(dir,id,read,write,reference.headId,change)
   result={revision:next.revision,snapshotId:headId}
   await flush()
   assertCurrent?.()
   return JSON.stringify({format:POINTER_FORMAT,headId})
  })
  return result
 }
 function pageLimit(limit){if(!integer(limit,1)||limit>500)throw Error('Invalid page limit');return limit}
 async function page(read,head,headId,before,limit){
  if(!integer(before)||before>head.count)throw Error('Invalid cursor position')
  const start=Math.max(0,before-limit),messages=[]
  for(let p=Math.floor(start/PAGE_SIZE);p<Math.ceil(before/PAGE_SIZE);p++){
   const rows=await leaf(read,head.root,head.height,p)
   for(let position=Math.max(start,p*PAGE_SIZE);position<Math.min(before,(p+1)*PAGE_SIZE);position++){
    if(!record(rows[position%PAGE_SIZE]))throw Error('History page missing message')
    messages.push({position,message:copy(rows[position%PAGE_SIZE])})
   }
  }
  return {revision:head.revision,messageCount:head.count,messages,
   snapshotCursor:{snapshotId:headId,before},previousCursor:start?{snapshotId:headId,before:start}:null}
 }
 // Header/configuration readers never need a history page, including its
 // potentially large historical receipts. The pointer pins all returned fields.
 async function readHead(id,{snapshotId}={}){
  const dir=directory(id)
  return sqlite.withSession(dir,async()=>{
   const read=reader(dir)
   const selected=snapshotId?{head:validateHead(await read(snapshotId,'head'),id),headId:snapshotId}:await current(dir,id,read)
   if(!selected)return undefined
   const {head,headId}=selected
   return {revision:head.revision,messageCount:head.count,snapshotCursor:{snapshotId:headId,before:head.count},
    state:copy((await read(head.stateId,'state')).value),metadata:copy((await read(head.metadataId,'metadata')).value)}
  })
 }
 async function openConversation(id,{limit=50,snapshotId}={}){
  pageLimit(limit)
  const dir=directory(id)
  return sqlite.withSession(dir,async()=>{
   const read=reader(dir)
   const selected=snapshotId?{head:validateHead(await read(snapshotId,'head'),id),headId:snapshotId}:await current(dir,id,read)
   if(!selected)return undefined
   const {head,headId}=selected
   return {...await page(read,head,headId,head.count,limit),state:copy((await read(head.stateId,'state')).value),metadata:copy((await read(head.metadataId,'metadata')).value)}
  })
 }
 async function readHistoryPage(id,{cursor,limit=50}={}){
  pageLimit(limit)
  if(!record(cursor))throw Error('Invalid history cursor')
  const dir=directory(id)
  return sqlite.withSession(dir,async()=>{
   const read=reader(dir)
   let head
   try{head=await read(cursor.snapshotId,'head')}catch(error){
    if(error.code==='ENOENT')throw Error('Invalid history cursor')
    throw error
   }
   if(head.id!==id)throw Error('Foreign history cursor')
   validateHead(head,id)
   return page(read,head,cursor.snapshotId,cursor.before,limit)
  })
 }
 async function readState(id,{snapshotId}={}){
  const dir=directory(id)
  return sqlite.withSession(dir,async()=>{
   const read=reader(dir)
   const head=snapshotId?validateHead(await read(snapshotId,'head'),id):(await current(dir,id,read))?.head
   return head?copy((await read(head.stateId,'state')).value):undefined
  })
 }
 // Detached immutable records let migration separate large historical state
 // and extension payloads from the page body. They are not a second mutable head.
 async function writeRecord(id,value){
  const dir=directory(id),{backend}=await detectBackend(dir,true)
  const block={kind:'record',value:copy(value)}
  if(backend==='sqlite')return sqlite.withSession(dir,()=>sqlite.writeBlocks(dir,[{block}])[0])
  return writeBlock(dir,block)
 }
 // Independent immutable blocks may be flushed concurrently. All files and
 // directory entries are durable before this returns and BEFORE head publication.
 async function writeRecords(id,values,known){
  const dir=directory(id),{backend}=await detectBackend(dir,true)
  const blocks=copy(values).map(value=>({kind:'record',value}))
  if(backend==='sqlite'){
   if(known!==undefined&&(!Array.isArray(known)||known.length!==blocks.length))throw Error('Invalid record references')
   const entries=blocks.map((block,i)=>{const bytes=JSON.stringify(block);return {block,bytes,ref:known?known[i]:hash(bytes)}})
   return sqlite.withSession(dir,()=>sqlite.writeBlocks(dir,entries))
  }
  return writePacked(dir,blocks,known)
 }
 // Store every block kind in durable packs, retaining fork reference reuse and bounded IO.
 async function writePacked(dir,blocks,known){
  const directories=new Set(),refs=new Array(blocks.length)
  if(known!==undefined&&(!Array.isArray(known)||known.length!==blocks.length))throw Error('Invalid record references')
  const entries=new Map(),groups=[]
  for(let i=0;i<blocks.length;i++){
   const bytes=JSON.stringify(blocks[i]),ref=known?known[i]:hash(bytes)
   refs[i]=ref;entries.set(ref,{ref,block:blocks[i],bytes})
  }
  let group=[],groupBytes=64
  const ordered=[...entries.values()]
  // Bound both in-flight reads and retained bytes. Preserve input order for
  // packing, and drain each batch before failing or publishing any new block.
  for(let start=0;start<ordered.length;start+=32){
   const batch=ordered.slice(start,start+32)
   const checked=await Promise.allSettled(batch.map(entry=>reusingName(blobPath(dir,entry.ref),async()=>{
    let existing
    try{existing=await readFile(blobPath(dir,entry.ref),'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
    if(existing===undefined)return false
    if(existing!==entry.bytes&&JSON.stringify(decodeBlock(dir,entry.ref,existing))!==entry.bytes)throw Error('Immutable block corruption')
    onIO({kind:'read',type:entry.block.kind,bytes:Buffer.byteLength(existing),reason:'deduplication'})
    return reused(blobPath(dir,entry.ref))
   })))
   const failure=checked.find(result=>result.status==='rejected')
   if(failure)throw failure.reason
   for(let i=0;i<batch.length;i++){
    // Blocks are addressed by content, so a revision that changed one page still offers every
    // page again. Only the blocks that actually land create directory entries: syncing the
    // untouched directories too turned one game import into a thousand fsyncs on a phone.
    if(checked[i].value)continue
    const entry=batch[i],parent=path.dirname(blobPath(dir,entry.ref))
    directories.add(parent);directories.add(path.join(dir,'blocks'));directories.add(dir)
    const size=Buffer.byteLength(entry.bytes)+70
    if(group.length&&(groupBytes+size>PACK_BYTES||group.length>=(independentFiles?1:PACK_ENTRIES))){groups.push(group);group=[];groupBytes=64}
    group.push(entry);groupBytes+=size
   }
  }
  if(group.length)groups.push(group)
  const packDirectory=path.join(dir,'blocks','.packs')
  if(groups.some(group=>group.length>1)){await mkdir(packDirectory,{recursive:true});directories.add(packDirectory)}
  let index=0
  const workers=Array.from({length:Math.min(8,groups.length)},async()=>{
   while(index<groups.length){
    const group=groups[index++]
    if(group.length===1){await writeBlock(dir,group[0].block,directories,{bytes:group[0].bytes,id:group[0].ref});continue}
    const bytes=JSON.stringify({kind:'block-pack-v1',records:group.map(entry=>[entry.ref,entry.block])})
    const target=path.join(packDirectory,hash(bytes)+'.json'),staging=target+'.staging-'+randomUUID()
    let handle
    try{
     handle=await open(staging,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null
     await rename(staging,target)
     onIO({kind:'write',type:'block-pack',bytes:Buffer.byteLength(bytes)})
     for(const entry of group){
      const destination=blobPath(dir,entry.ref)
      await mkdir(path.dirname(destination),{recursive:true})
      try{await linkFile(target,destination);onIO({kind:'link',type:entry.block.kind,bytes:0})}
      catch(error){
       if(error.code==='EEXIST'){
        if(JSON.stringify(decodeBlock(dir,entry.ref,await readFile(destination,'utf8')))!==entry.bytes)throw Error('Immutable block corruption')
       }else if(['EXDEV','EPERM','EACCES','ENOTSUP','EOPNOTSUPP','ENOSYS','EMLINK'].includes(error.code)){
        await writeBlock(dir,entry.block,directories,{bytes:entry.bytes,id:entry.ref})
       }else throw error
      }
     }
    }finally{if(handle)await handle.close();await rm(staging,{force:true})}
   }
  })
  const results=await Promise.allSettled(workers)
  const failed=results.find(result=>result.status==='rejected')
  if(failed)throw failed.reason
  // Children first, then their parents: no acknowledged head can name a block
  // whose directory entry has not completed its durability barrier.
  const leaves=[...directories].filter(directory=>directory!==dir&&directory!==path.join(dir,'blocks'))
  let directoryIndex=0
  const synced=await Promise.allSettled(Array.from({length:Math.min(8,leaves.length)},async()=>{
   while(directoryIndex<leaves.length)await syncDirectory(leaves[directoryIndex++])
  }))
  const syncFailure=synced.find(result=>result.status==='rejected')
  if(syncFailure)throw syncFailure.reason
  if(directories.size){await syncDirectory(path.join(dir,'blocks'));await syncDirectory(dir)}
  return refs
 }
 async function readRecord(id,reference,{shared=false}={}){
  const dir=directory(id)
  if(shared&&sqlite.getSessionBackend(dir)==='sqlite'){
   const value=readSqliteBlockSync(dir,reference,'',0,id,false)
   if(value.kind!=='record')throw Error('Invalid block type')
   return value.value
  }
  const remembered=cachedBlock(dir,reference)
  if(remembered){
   if(remembered.kind!=='record')throw Error('Invalid block type')
   return shared?remembered.value:copy(remembered.value)
  }
  if(sqlite.getSessionBackend(dir)==='sqlite'){
   const value=readSqliteBlockSync(dir,reference,'',0,id,true)
   if(value.kind!=='record')throw Error('Invalid block type')
   return copy(value.value)
  }
  return sqlite.withSession(dir,async()=>{
   const value=(await reader(dir)(reference,'record')).value
   return shared?value:copy(value)
  })
 }
 async function readEntries(id,keys,{snapshotId}={}){
  if(!Array.isArray(keys))throw Error('Invalid record keys')
  const routes=keys.map(recordKey),dir=directory(id)
  return sqlite.withSession(dir,async()=>{
   const read=reader(dir)
   const head=snapshotId?validateHead(await read(snapshotId,'head'),id):(await current(dir,id,read))?.head
   if(!head)return undefined
   const entries=[]
   for(let i=0;i<keys.length;i++){
    const ref=await lookup(read,head.recordRoot,keys[i],routes[i])
    if(ref)entries.push([keys[i],copy((await read(ref,'record')).value)])
   }
   return Object.fromEntries(entries)
  })
 }
 async function pinnedHead(dir){
  const pointer=await promotion.read(path.join(dir,'head.json'))
  if(pointer===undefined)return undefined
  const reference=JSON.parse(pointer)
  if(!readablePointer(reference.format))throw Error('Unsupported conversation format')
  if(reference.format===SQLITE_FORMAT){
   const headId=sqlite.getHeadId(dir)
   if(!headId)throw Error('Invalid conversation head')
   return {...reference,headId,backend:'sqlite'}
  }
  return {...reference,backend:'files'}
 }
 // `exclusive(step)` runs a step that publishes or deletes alone with this save's
 // writers (the journal's per-chat queue); the head lock is taken inside it.
 const alone=step=>step()
 // Rewrite the keyed-record index keeping only keys the caller still needs
 // (e.g. per-revision pointers of revisions nothing reads any more). Publishes
 // a new head with the same messages and state; returns how many keys went.
 // The index is read and rebuilt from a pinned head without any lock; the short
 // locked step publishes it, carrying over the keys commits added meanwhile.
 async function pruneEntries(id,keep,{exclusive=alone}={}){
  const dir=directory(id)
  return sqlite.withSession(dir,async()=>{
   const pinned=await pinnedHead(dir)
   if(pinned===undefined)throw conflict()
   const isSqlite=pinned.backend==='sqlite'
   // Through the shared bounded cache only: an index of a million keys must not stay in memory.
   const read=async (ref,kind)=>{
    let value=cachedBlock(dir,ref)
    if(!value){
     if(isSqlite){
      const loaded=sqlite.readBlock(dir,ref)
      if(!loaded)throw Object.assign(Error('Block not found: '+ref),{code:'ENOENT'})
      value=loaded.value
      if(loaded.bytes<=64*1024)cachePacked(dir,[[ref,value]],loaded.bytes*2+128)
     }else value=admitFile(dir,ref,await readFile(blobPath(dir,ref)))
    }
    if(kind&&value.kind!==kind)throw Error('Invalid block type')
    return value
   }
   const base=validateHead(await read(pinned.headId,'head'),id)
   if(!base.recordRoot)return {removed:0}
   const kept=[]
   let removed=0
   // Depth first with SWEEP_PARALLEL reads in flight: a million keys take minutes one read at a time.
   const stack=[[base.recordRoot,0]]
   let busy=0
   await Promise.all(Array.from({length:SWEEP_PARALLEL},async()=>{
    for(;;){
     if(!stack.length){if(!busy)return;await new Promise(resolve=>setImmediate(resolve));continue}
     const [ref,depth]=stack.pop()
     busy++
     try{
      const node=await read(ref)
      if(node.kind==='entry'){if(keep(node.key))kept.push(node);else removed++;continue}
      if(node.kind!=='entries'||depth>=64)throw Error('Invalid record index')
      for(const child of Object.values(node.children))if(child)stack.push([child,depth+1])
     }finally{busy--}
    }
   }))
   if(!removed)return {removed:0}
   const route=entry=>({key:entry.key,valueRef:entry.valueRef,route:recordKey(entry.key)})
   // Unreferenced until the head is published; the sweep that could see them runs after this.
   const staged=async (step)=>{
    const pending=new Map(),write=async value=>{const bytes=JSON.stringify(value),ref=hash(bytes);pending.set(ref,{ref,block:value,bytes});return ref}
    const result=await step(write,async (ref,kind)=>pending.has(ref)?pending.get(ref).block:read(ref,kind))
    if(isSqlite)sqlite.writeBlocks(dir,[...pending.values()])
    else await writePacked(dir,[...pending.values()].map(entry=>entry.block),[...pending.keys()])
    return result
   }
   const pruned=kept.length?await staged((write,staging)=>putEntries(dir,staging,null,kept.map(route),0,write)):undefined
   // Keys in `next` that `previous` lacks or names differently: only the paths commits copied differ.
   async function added(previous,next,out,depth=0){
    if(!next||previous===next)return out
    const node=await read(next)
    if(node.kind==='entry'){if(await lookup(read,previous,node.key,recordKey(node.key),depth)!==node.valueRef)out.push(node);return out}
    if(node.kind!=='entries'||depth>=64)throw Error('Invalid record index')
    const other=previous?await read(previous):null
    for(const [slot,child] of Object.entries(node.children))await added(other?.kind==='entries'?other.children[slot]:previous,child,out,depth+1)
    return out
   }
   if(isSqlite){
    await exclusive(()=>sqlite.serializeWrite(dir,async()=>{
     for(let attempt=0;attempt<5;attempt++){
      const currentHeadId=sqlite.getHeadId(dir,{fresh:true})
      if(!currentHeadId)throw conflict()
      const head=validateHead(await read(currentHeadId,'head'),id)
      const pending=new Map(),write=async value=>{const bytes=JSON.stringify(value),ref=hash(bytes);pending.set(ref,{ref,block:value,bytes});return ref}
      const staging=async (ref,kind)=>pending.has(ref)?pending.get(ref).block:read(ref,kind)
      let recordRoot=pruned
      const carried=currentHeadId===pinned.headId?[]:await added(base.recordRoot,head.recordRoot,[])
      if(carried.length)recordRoot=await putEntries(dir,staging,recordRoot??null,carried.map(route),0,write)
      const next={...head,revision:head.revision+1,previousHeadId:currentHeadId}
      if(recordRoot)next.recordRoot=recordRoot;else delete next.recordRoot
      const nextHeadId=await write(next)
      try{sqlite.commitHead(dir,currentHeadId,[...pending.values()],nextHeadId);return}
      catch(error){if(error.code!=='CONVERSATION_CONFLICT'||attempt===4)throw error}
     }
    }))
    return {removed}
   }
   await exclusive(()=>promotion.update(path.join(dir,'head.json'),async pointer=>{
    if(pointer===undefined)throw conflict()
    const reference=JSON.parse(pointer)
    if(!readablePointer(reference.format))throw Error('Unsupported conversation format')
    const head=validateHead(await read(reference.headId,'head'),id)
    return staged(async (write,staging)=>{
     let recordRoot=pruned
     const carried=reference.headId===pinned.headId?[]:await added(base.recordRoot,head.recordRoot,[])
     if(carried.length)recordRoot=await putEntries(dir,staging,recordRoot??null,carried.map(route),0,write)
     const next={...head,revision:head.revision+1,previousHeadId:reference.headId}
     if(recordRoot)next.recordRoot=recordRoot;else delete next.recordRoot
     return JSON.stringify({format:POINTER_FORMAT,headId:await write(next)})
    })
   }))
   return {removed}
  })
 }
 // A pack keeps every block it was written with; once some are swept, the
 // rest still pin the whole file. Rewrite packs that are mostly dead (or
 // nearly empty), together with loose one-file blocks, into fresh block packs
 // holding only live blocks, and atomically repoint each block's link.
 async function repack(dir,cutoff){
  // Copy-only stores keep durable loose blocks; GC must never reintroduce links.
  if(independentFiles)return {packs:0,bytes:0}
  const packs=path.join(dir,'blocks','.packs'),HEX=/^[a-f0-9]{64}$/
  const live=new Map(),stale=[]
  let names=[]
  try{names=await readdir(packs)}catch(error){if(error.code!=='ENOENT')throw error}
  for(const name of names){
   if(!name.endsWith('.json'))continue
   const file=path.join(packs,name),info=await stat(file)
   if(info.mtimeMs>cutoff)continue
   let pack
   try{pack=JSON.parse(await readFile(file,'utf8'))}catch{continue}
   if(!['record-pack-v1','block-pack-v1'].includes(pack?.kind)||!Array.isArray(pack.records))continue
   const blocks=[];let liveBytes=0,allBytes=0
   for(const [ref,value] of pack.records){
    const block=pack.kind==='block-pack-v1'?value:{kind:'record',value},size=JSON.stringify(block).length
    allBytes+=size
    let same=false
    try{same=(await stat(blobPath(dir,ref))).ino===info.ino}catch(error){if(error.code!=='ENOENT')throw error}
    if(same){blocks.push([ref,block]);liveBytes+=size}
   }
   if(blocks.length>=16&&liveBytes>allBytes*0.8)continue
   stale.push({file,size:info.size,ino:info.ino})
   for(const [ref,block] of blocks)live.set(ref,block)
  }
  // Loose blocks: one small file each, most of it filesystem slack.
  const loose=[]
  let shards=[]
  try{shards=await readdir(path.join(dir,'blocks'))}catch(error){if(error.code!=='ENOENT')throw error}
  for(const shard of shards){
   if(!/^[a-f0-9]{2}$/.test(shard))continue
   for(const name of await readdir(path.join(dir,'blocks',shard))){
    const ref=name.slice(0,-5)
    if(!name.endsWith('.json')||!HEX.test(ref)||live.has(ref))continue
    const file=path.join(dir,'blocks',shard,name),info=await stat(file)
    if(info.nlink!==1||info.mtimeMs>cutoff)continue
    loose.push({ref,file,size:info.size})
   }
  }
  if(loose.length>=16||stale.length)for(const item of loose){
   const bytes=await readFile(item.file,'utf8')
   live.set(item.ref,decodeBlock(dir,item.ref,bytes))
  }
  if(!stale.length&&loose.length<16)return {packs:0,bytes:0}
  const entries=[...live.entries()]
  if(entries.length<2)return {packs:0,bytes:0}
  let written=0,group=[],groupBytes=64
  const groups=[],directories=new Set([packs])
  for(const entry of entries){
   const size=Buffer.byteLength(JSON.stringify(entry[1]))+70
   if(group.length&&(groupBytes+size>PACK_BYTES||group.length>=PACK_ENTRIES)){groups.push(group);group=[];groupBytes=64}
   group.push(entry);groupBytes+=size
  }
  if(group.length)groups.push(group)
  await mkdir(packs,{recursive:true})
  for(const group of groups){
   if(group.length===1)continue
   const bytes=JSON.stringify({kind:'block-pack-v1',records:group})
   const target=path.join(packs,hash(bytes)+'.json'),staging=target+'.staging-'+randomUUID()
   let handle
   try{handle=await open(staging,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null
    await rename(staging,target)}finally{if(handle)await handle.close();await rm(staging,{force:true})}
   written+=Buffer.byteLength(bytes)
   for(const [ref] of group){
    const destination=blobPath(dir,ref),temporary=destination+'.relink-'+randomUUID()
    // Without hard links the block keeps its current, still valid file.
    try{await linkFile(target,temporary);await rename(temporary,destination);directories.add(path.dirname(destination))}
    catch(error){if(!['EXDEV','EPERM','EACCES','ENOTSUP','EOPNOTSUPP','ENOSYS','EMLINK'].includes(error.code))throw error}
    finally{await rm(temporary,{force:true})}
   }
  }
  for(const directory of directories)await syncDirectory(directory)
  let freed=0
  for(const pack of stale){
   const info=await stat(pack.file).catch(()=>null)
   // Only once nothing links to the old inode any more.
   if(info&&info.ino===pack.ino&&info.nlink===1){freed+=pack.size;await rm(pack.file,{force:true})}
  }
  // A replaced loose file is gone with its last link; count its bytes.
  for(const item of loose)if((await stat(item.file).catch(()=>null))?.nlink>1)freed+=item.size
  await syncDirectory(packs)
  return {packs:stale.length,bytes:Math.max(0,freed-written)}
 }
 // Delete blocks unreachable from the current head. Old heads stay reachable
 // only through keyed records the caller retains (`retainEntry(key)`, e.g.
 // 'chat-revision:N'); previousHeadId links are never followed. Any 64-hex
 // string inside a reachable value that names an existing block is retained
 // too, so opaque record references are kept conservatively. Blocks younger
 // than graceMs are kept for in-flight commits and pinned readers.
 // Marking and listing run without a lock on a pinned head; deletions run in
 // short `exclusive` locked steps that first mark what newer heads reach, so the
 // lock is held for at most about RELAYOUT_YIELD_MS however much garbage there is.
 // A pass stopped by `signal` (or a restart) leaves fewer files for the next one.
 async function sweep(id,{retainEntry=()=>true,graceMs=10*60*1000,dryRun=false,now=Date.now(),exclusive=alone,signal}={}){
  const dir=directory(id),blocks=path.join(dir,'blocks'),HEX=/^[a-f0-9]{64}$/
  const headPath=path.join(dir,'head.json')
  return sqlite.withSession(dir,async()=>{
   const pinned=await pinnedHead(dir)
   if(pinned===undefined)throw Error('Conversation not found')
   const isSqlite=pinned.backend==='sqlite'
   const marked=new Set()
   // Everything a head reaches; heads already marked stop the walk, so a newer head costs only its new paths.
   async function mark(headId){
    const queue=[[headId,true]]
    // The read cache, not a whole-pack parse per block: siblings come from the
    // already admitted pack and each entry parses only its own slice.
    async function load(ref,required){
     const cached=cachedBlock(dir,ref)
     if(cached)return cached
     if(isSqlite){
      const loaded=sqlite.readBlock(dir,ref)
      if(!loaded){
       if(!required)return undefined
       throw Object.assign(Error('Block not found: '+ref),{code:'ENOENT'})
      }
      onIO({kind:'read',bytes:loaded.bytes,chatId:id,ref,reason:'sweep'})
      if(loaded.bytes<=64*1024)cachePacked(dir,[[ref,loaded.value]],loaded.bytes*2+128)
      return loaded.value
     }
     let bytes
     try{bytes=await readFile(blobPath(dir,ref))}catch(error){
      if(error.code==='ENOENT'&&!required)return undefined
      throw error
     }
     onIO({kind:'read',bytes:bytes.length,chatId:id,ref,reason:'sweep'})
     return admitFile(dir,ref,bytes)
    }
    while(queue.length){
     const [ref,required]=queue.pop()
     if(marked.has(ref))continue
     const value=await load(ref,required)
     if(value===undefined)continue
     marked.add(ref)
     const strong=[],optional=[]
     // Only the current head's keyed-record index is ever read; older heads are
     // reached through it and need just their messages, state and metadata.
     if(value.kind==='head'){for(const key of ['root','stateId','metadataId',...(ref===headId?['recordRoot']:[])])if(value[key])strong.push(value[key])}
     else if(value.kind==='index')strong.push(...value.children.filter(Boolean))
     else if(value.kind==='entries')strong.push(...Object.values(value.children).filter(Boolean))
     else if(value.kind==='entry'){
      // A dropped entry keeps its small value record, so lookups still resolve
      // and fail cleanly on the missing head instead of on the index.
      if(retainEntry(value.key))strong.push(value.valueRef)
      else marked.add(value.valueRef)
     }
     else for(const next of hexRefs(value))if(!marked.has(next))optional.push(next)
     for(const next of strong)queue.push([next,true])
     for(const next of optional)queue.push([next,false])
    }
   }
   await mark(pinned.headId)
   const cutoff=now-graceMs
   if(isSqlite){
    let removed=0,kept=0,bytes=0,lockHolds=0,maxLockMs=0,stopped=false,markedHead=pinned.headId
    const allBlocks=sqlite.listBlocks(dir)
    const candidates=[]
    for(const item of allBlocks){
     if(marked.has(item.ref)||item.touchedAt>cutoff)kept++
     else candidates.push(item)
    }
    if(dryRun){
     const dryBytes=candidates.reduce((sum,item)=>sum+item.size,0)
     return {reachable:marked.size,kept,removed:candidates.length,bytes:dryBytes,repackedPacks:0,lockHolds:0,maxLockMs:0,stopped:false}
    }
    const BATCH=500
    for(let i=0;i<candidates.length;i+=BATCH){
     if(signal?.aborted){stopped=true;break}
     const slice=candidates.slice(i,i+BATCH)
     await exclusive(()=>sqlite.serializeWrite(dir,async()=>{
      const started=performance.now()
      const currentHeadId=sqlite.getHeadId(dir,{fresh:true})
      if(!currentHeadId){stopped=true;return}
      if(currentHeadId!==markedHead){await mark(currentHeadId);markedHead=currentHeadId}
      const deletable=[]
      for(const item of slice){
       if(marked.has(item.ref))kept++
       else deletable.push(item)
      }
      const deleted=sqlite.deleteBlocksBatch(dir,deletable,cutoff)
      removed+=deleted.removed
      bytes+=deleted.bytes
      kept+=deletable.length-deleted.removed
      lockHolds++;maxLockMs=Math.max(maxLockMs,Math.round(performance.now()-started))
     }))
     if(i+BATCH<candidates.length)await new Promise(resolve=>setImmediate(resolve))
    }
    if(!stopped&&removed>0)await sqlite.reclaimSpace(dir,{signal})
    return {reachable:marked.size,kept,removed,bytes,repackedPacks:0,lockHolds,maxLockMs,stopped}
   }
   // Packed records are hard links to one pack inode; space returns only
   // when every link, including the pack's own, is gone.
   let removed=0,kept=0,bytes=0,lockHolds=0,maxLockMs=0,stopped=false,markedHead=pinned.headId
   const inodes=new Map()
   // Names in batches straight from the directory, never one array of every file.
   async function* listed(directoryPath){
    let handle
    try{handle=await opendir(directoryPath,{bufferSize:256})}catch(error){if(error.code==='ENOENT')return;throw error}
    let batch=[]
    for await(const entry of handle){batch.push(entry.name);if(batch.length>=SWEEP_LIST_BATCH){yield batch;batch=[]}}
    if(batch.length)yield batch
   }
   // One file: stat and unlink next to each other. Registered in `removing` before the stat, so a
   // writer of this store that wants to reuse the name waits for the outcome; a name being reused is skipped.
   async function removeFile(item){
    if(item.ref&&marked.has(item.ref)){kept++;return}
    if(reusing.has(item.file)){if(item.ref)kept++;return}
    const work=removeChecked(item)
    removing.set(item.file,work)
    try{await work}finally{if(removing.get(item.file)===work)removing.delete(item.file)}
   }
   async function removeChecked({file,ref,pack}){
    let info
    try{info=await stat(file)}catch(error){if(error.code==='ENOENT')return;throw error}
    if(info.mtimeMs>cutoff||pack&&info.nlink-(inodes.get(info.dev+':'+info.ino)?.removed??0)!==1){if(ref)kept++;return}
    removed++
    if(dryRun){const key=info.dev+':'+info.ino,entry=inodes.get(key)||{nlink:info.nlink,size:info.size,removed:0};entry.removed++;inodes.set(key,entry);return}
    // Its last link: the bytes come back.
    if(info.nlink===1)bytes+=info.size
    try{await unlinkFile(file)}catch(error){if(error.code!=='ENOENT')throw error}
   }
   async function removeAll(files){
    let straggling=null
    const step=async pointer=>{
     const started=performance.now()
     if(pointer===undefined){files.length=0;return}
     // Only the commits since the unlocked mark below remain to be marked here.
     const {headId}=JSON.parse(pointer)
     if(headId!==markedHead){await mark(headId);markedHead=headId}
     // No removal starts after RELAYOUT_YIELD_MS. A stat or unlink can stall for seconds (2026-10-27: 10-24 s on
     // the live disk); one still running at RELAYOUT_STEP_MS finishes after the lock is released. That is safe:
     // every reuse of a name by this store waits for its pending removal (`removing`), then writes it again.
     const workers=Promise.all(Array.from({length:SWEEP_PARALLEL},async()=>{
      while(files.length&&performance.now()<started+RELAYOUT_YIELD_MS)await removeFile(files.shift())
     }))
     let timer
     const late=await Promise.race([workers.then(()=>false),new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,started+RELAYOUT_STEP_MS-25-performance.now()),true)})])
     clearTimeout(timer)
     if(late)straggling=workers
     lockHolds++;maxLockMs=Math.max(maxLockMs,Math.round(performance.now()-started))
    }
    while(files.length){
     if(signal?.aborted){stopped=true;return}
     const pointer=await promotion.read(headPath)
     if(pointer===undefined)return
     // Mark what the current head reaches without the lock: a whole new index (a pruned record index) costs seconds.
     const {headId}=JSON.parse(pointer)
     if(headId!==markedHead){await mark(headId);markedHead=headId}
     if(dryRun)await step(pointer)
     else await exclusive(()=>promotion.update(headPath,async current=>{await step(current);return undefined}))
     await straggling;straggling=null
    }
   }
   for await(const shards of listed(blocks))for(const shard of shards){
    if(stopped)break
    if(!/^[a-f0-9]{2}$/.test(shard))continue
    for await(const names of listed(path.join(blocks,shard))){
     const files=[]
     for(const name of names){
      const ref=name.slice(0,-5)
      if(!name.endsWith('.json')||!HEX.test(ref))continue
      if(marked.has(ref))kept++;else files.push({file:path.join(blocks,shard,name),ref})
     }
     await removeAll(files)
     if(stopped)break
    }
   }
   // A pack no block name links to any more (its own name is the last link).
   if(!stopped)for await(const names of listed(path.join(blocks,'.packs'))){
    await removeAll(names.filter(name=>name.endsWith('.json')).map(name=>({file:path.join(blocks,'.packs',name),pack:true})))
    if(stopped)break
   }
   if(dryRun)for(const entry of inodes.values())if(entry.removed>=entry.nlink)bytes+=entry.size
   // Repack only rewrites links to identical content and frees packs nothing links to: no lock needed.
   const repacked=dryRun||stopped?{packs:0,bytes:0}:await repack(dir,cutoff)
   return {reachable:marked.size,kept,removed,bytes:bytes+repacked.bytes,repackedPacks:repacked.packs,lockHolds,maxLockMs,stopped}
  })
 }
 // every commit packs only the blocks it changed, so after thousands
 // of commits one floor's tree is spread over hundreds of packs and a cold open
 // re-reads each pack many times. Visit the head's blocks in the order an open
 // reads them: head, metadata, state (header, world), the page tree, then each
 // floor newest first, every floor's tree depth first. Each unit (the header part,
 // the page tree, one floor) counts the distinct packs it touches. Other revisions'
 // heads and the keyed-record index are not on this path.
 async function layout(dir,headId,visit){
  const seen=new Set(),pages=[]
  let unit=0
  async function load(ref){
   let value=cachedBlock(dir,ref)
   if(value===undefined)value=await scheduleRead(async()=>{
    const bytes=await readFile(blobPath(dir,ref))
    onIO({kind:'read',bytes:bytes.length,chatId:path.basename(dir),ref,reason:'relayout'})
    return admitFile(dir,ref,bytes)
   },'background').promise
   return {value,pack:packed.get(dir+'/'+ref)?.pack[0]??ref}
  }
  async function walk(roots){
   const stack=[...roots].reverse()
   while(stack.length){
    const [ref,required]=stack.pop()
    if(seen.has(ref))continue
    let loaded
    try{loaded=await load(ref)}catch(error){if(error.code==='ENOENT'&&!required)continue;throw error}
    const {value}=loaded
    if(ref!==headId&&['head','entries','entry'].includes(value.kind))continue
    seen.add(ref);await visit(ref,value,loaded.pack,unit)
    if(value.kind==='page')pages.push(value)
    const next=value.kind==='index'?value.children.filter(Boolean).map(child=>[child,true])
     :value.kind==='head'||value.kind==='page'?[]:hexRefs(value).map(child=>[child,false])
    for(let i=next.length-1;i>=0;i--)stack.push(next[i])
   }
  }
  const head=validateHead((await load(headId)).value,path.basename(dir))
  await walk([[headId,true],[head.metadataId,true],[head.stateId,true]])
  pages.length=0
  unit++
  if(head.root)await walk([[head.root,true]])
  for(let p=pages.length-1;p>=0;p--)for(let m=pages[p].messages.length-1;m>=0;m--){
   unit++
   await walk(hexRefs(pages[p].messages[m]).map(ref=>[ref,false]))
  }
 }
 // The same greedy grouping as commits and repack, in visiting order.
 function packer(flush){
  let group=[],groupBytes=64,index=0
  return {
   async add(entry,size){
    if(group.length&&(groupBytes+size>PACK_BYTES||group.length>=PACK_ENTRIES)){await flush(group,index++);group=[];groupBytes=64}
    group.push(entry);groupBytes+=size
    return index
   },
   async end(){if(group.length)await flush(group,index++)}
  }
 }
 // Measure the current head's layout; when it is fragmented, rewrite its blocks in
 // visiting order into fresh block packs (same format and refs) and repoint each
 // block's link atomically, as repack does. Reads and pack writes need no lock: the
 // head is immutable and packs are new files. Relinking holds the write lock for at
 // most about RELAYOUT_STEP_MS at a time so queued commits run in between. A link is valid
 // whatever head is current (content addressing); a block swept between two steps
 // may come back only as garbage for the next sweep. Old packs are freed by the sweep.
 async function relayout(id,{dryRun=false}={}){
  const dir=directory(id),pointer=await promotion.read(path.join(dir,'head.json'))
  if(pointer===undefined)return undefined
  const reference=JSON.parse(pointer)
  if(!readablePointer(reference.format))throw Error('Unsupported conversation format')
  if(reference.format===SQLITE_FORMAT){
   const headId=sqlite.getHeadId(dir)
   return {headId,blocks:0,bytes:0,packs:0,visits:0,ideal:0,relinked:0,written:0,measureMs:0,writeMs:0,relinkMs:0,lockHolds:0,maxLockMs:0,fragmented:false,skipped:'sqlite'}
  }
  const units=new Map(),sources=new Set()
  let blocks=0,bytes=0,phase=performance.now()
  forget(dir)
  const touch=(unit,key)=>{if(!units.has(unit))units.set(unit,{packs:new Set(),groups:new Set()});return units.get(unit)[key]}
  const ideal=packer(async()=>{})
  await layout(dir,reference.headId,async(ref,value,pack,unit)=>{
   const size=Buffer.byteLength(JSON.stringify(value))+70
   blocks++;bytes+=size;sources.add(pack);touch(unit,'packs').add(pack)
   touch(unit,'groups').add(await ideal.add(ref,size))
  })
  const sum=key=>[...units.values()].reduce((total,unit)=>total+unit[key].size,0)
  const result={headId:reference.headId,blocks,bytes,packs:sources.size,visits:sum('packs'),ideal:sum('groups'),relinked:0,written:0,
   measureMs:Math.round(performance.now()-phase),writeMs:0,relinkMs:0,lockHolds:0,maxLockMs:0}
  result.fragmented=result.visits>RELAYOUT_RATIO*result.ideal&&result.visits-result.ideal>=RELAYOUT_MIN_EXCESS
  if(dryRun||independentFiles||!result.fragmented)return result
  const packs=path.join(dir,'blocks','.packs'),written=[]
  await mkdir(packs,{recursive:true})
  const output=packer(async group=>{
   if(group.length===1)return
   const bytes=JSON.stringify({kind:'block-pack-v1',records:group})
   const target=path.join(packs,hash(bytes)+'.json'),staging=target+'.staging-'+randomUUID()
   let handle
   try{handle=await open(staging,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null
    await rename(staging,target)}finally{if(handle)await handle.close();await rm(staging,{force:true})}
   onIO({kind:'write',type:'block-pack',bytes:Buffer.byteLength(bytes),reason:'relayout'})
   result.written+=Buffer.byteLength(bytes)
   written.push({target,refs:group.map(([ref])=>ref)})
  })
  await layout(dir,reference.headId,async(ref,value)=>{await output.add([ref,value],Buffer.byteLength(JSON.stringify(value))+70)})
  await output.end()
  await syncDirectory(packs)
  result.writeMs=Math.round(performance.now()-(phase+result.measureMs));phase=performance.now()
  // A link to the new pack is made outside the lock under a temporary name (a single link can stall for hundreds of ms;
  // the sweep ignores temporary names, and the link only keeps the new pack alive). A step takes the write lock only to
  // rename prepared links over the blocks' names, bounded by measured time, not by block count: it stops once
  // RELAYOUT_YIELD_MS have passed and leaves the rest to the next step; renames still running near RELAYOUT_STEP_MS
  // finish after it releases the lock, before the next step. It syncs
  // its directories after releasing the lock: the queued commits run in between, and the sweep that frees the old packs
  // runs only after this pass has synced every link. Each step renames at least one link, so the pass makes progress.
  const skipped=error=>['ENOENT','EXDEV','EPERM','EACCES','ENOTSUP','EOPNOTSUPP','ENOSYS','EMLINK'].includes(error.code)
  let next=0,index=0
  const prepared=[]
  async function prepare(){
   const batch=[]
   while(batch.length<RELAYOUT_LINK_BATCH&&next<written.length){
    const {target,refs}=written[next]
    while(index<refs.length&&batch.length<RELAYOUT_LINK_BATCH)batch.push([target,refs[index++]])
    if(index>=refs.length){next++;index=0}
   }
   await Promise.all(Array.from({length:8},async()=>{
    while(batch.length){
     const [target,ref]=batch.shift(),destination=blobPath(dir,ref),temporary=destination+'.relink-'+randomUUID()
     try{await linkFile(target,temporary);prepared.push([temporary,destination])}
     catch(error){await rm(temporary,{force:true});if(!skipped(error))throw error}
    }
   }))
  }
  result.overBudget=0
  try{
   while(next<written.length||prepared.length){
    if(!prepared.length){await prepare();continue}
    let gone=false,straggling=null
    const directories=new Set()
    await promotion.update(path.join(dir,'head.json'),async current=>{
     if(current===undefined){gone=true;return undefined}
     const started=performance.now()
     let taken=0
     while(!straggling&&prepared.length&&(!taken||performance.now()<started+RELAYOUT_YIELD_MS)){
      const batch=prepared.splice(0,8)
      taken+=batch.length
      const renames=Promise.all(batch.map(async([temporary,destination])=>{
       try{await rename(temporary,destination);directories.add(path.dirname(destination));result.relinked++}
       catch(error){await rm(temporary,{force:true});if(!skipped(error))throw error}
      }))
      // A rename can stall for hundreds of ms too. One still running at the step's end finishes after the lock is
      // released: it swaps one link of a block for another link to the same content, which no commit or read depends on.
      let timer
      const late=await Promise.race([renames.then(()=>false),new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,started+RELAYOUT_STEP_MS-25-performance.now()),true)})])
      clearTimeout(timer)
      if(late)straggling=renames
     }
     const held=performance.now()-started
     result.lockHolds++;result.maxLockMs=Math.max(result.maxLockMs,Math.round(held));if(held>RELAYOUT_STEP_MS)result.overBudget++
     return undefined
    })
    await straggling
    for(const directory of directories)await syncDirectory(directory)
    if(gone)break
   }
  }finally{
   // A pass that stops early leaves no temporary link behind.
   for(const [temporary] of prepared.splice(0))await rm(temporary,{force:true})
  }
  result.relinkMs=Math.round(performance.now()-phase)
  return result
 }
 return Object.freeze({create,commit,readHead,openConversation,readHistoryPage,readState,writeRecord,writeRecords,readRecord,readEntries,sweep,pruneEntries,relayout,
  withSession:(id,work)=>sqlite.withSession(directory(id),work),close:id=>sqlite.close(directory(id)),closeAll:()=>sqlite.closeAll()})
}
