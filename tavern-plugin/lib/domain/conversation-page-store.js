import {createHash, randomUUID} from 'node:crypto'
import {mkdir, open, readFile, readdir, rename, rm, link, stat} from 'node:fs/promises'
import path from 'node:path'
import {createDurableFilePromotion} from '../durable-file-promotion.js'

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
// several per file); older releases refuse it cleanly instead of misreading.
const POINTER_FORMAT=2
const readablePointer=format=>format===1||format===POINTER_FORMAT
const PACK_BYTES=64*1024, PACK_ENTRIES=256
const hash=value=>createHash('sha256').update(value).digest('hex')
const copy=value=>JSON.parse(JSON.stringify(value))
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
// Every 64-hex string inside a value, in document order: candidate block references.
function hexRefs(value,out=[]){
 if(typeof value==='string'){if(/^[a-f0-9]{64}$/.test(value))out.push(value)}
 else if(Array.isArray(value))for(const item of value)hexRefs(item,out)
 else if(record(value))for(const item of Object.values(value))hexRefs(item,out)
 return out
}
// A relayout rewrites the current head only when a cold open would read more than
// RELAYOUT_RATIO times the packs a contiguous layout needs, and at least
// RELAYOUT_MIN_EXCESS packs (about 4 MiB) more, so small saves never churn.
const RELAYOUT_RATIO=2,RELAYOUT_MIN_EXCESS=64,RELAYOUT_LOCK_MS=250
const UNLINKABLE=['EXDEV','EPERM','EACCES','ENOTSUP','EOPNOTSUPP','ENOSYS','EMLINK']
function conflict(){return Object.assign(new Error('Conversation revision conflict'),{code:'CONVERSATION_CONFLICT'})}
function integer(value,min=0){return Number.isSafeInteger(value)&&value>=min}

export function createConversationPageStore({root,onIO=()=>{},linkFile=link}={}) {
 if(!root)throw Error('Conversation store requires root')
 root=path.resolve(root)
 // A live, slow writer must never lose its lock merely due to elapsed time.
 // Dead process recovery and pending head promotion use the existing protocol.
 const promotion=createDurableFilePromotion({writeLockStaleMs:Number.MAX_SAFE_INTEGER})
 const packed=new Map();let packedBytes=0
 function cachePacked(dir,id,value,size){
  const key=dir+'/'+id,old=packed.get(key)
  if(old){packedBytes-=old.size;packed.delete(key)}
  while(packed.size&&packedBytes+size>8*1024*1024){const oldest=packed.keys().next().value;packedBytes-=packed.get(oldest).size;packed.delete(oldest)}
  if(size<=8*1024*1024){packed.set(key,{value,size});packedBytes+=size}
 }
 // `contents`, when given, receives the refs the file holds (a pack holds several).
 function decodeBlock(dir,id,bytes,contents){
  if(hash(bytes)===id){
   const value=JSON.parse(bytes)
   contents?.push(id)
   // Content hashes are immutable across revisions. Keep small index/record
   // blocks warm across field reads; the mutable head pointer is never cached.
   if(Buffer.byteLength(bytes)<=64*1024)cachePacked(dir,id,value,Buffer.byteLength(bytes)*2+128)
   return value
  }
  let pack
  try{pack=JSON.parse(bytes)}catch{throw Error('Immutable block checksum mismatch')}
  const blockPack=pack?.kind==='block-pack-v1'
  if(!blockPack&&pack?.kind!=='record-pack-v1'||!Array.isArray(pack.records)||pack.records.length>PACK_ENTRIES)throw Error('Immutable block checksum mismatch')
  const entries=[],seen=new Set()
  for(const entry of pack.records){
   if(!Array.isArray(entry)||entry.length!==2||seen.has(entry[0]))throw Error('Immutable pack checksum mismatch')
   const [ref,value]=entry,block=blockPack?value:{kind:'record',value},encoded=JSON.stringify(block)
   if(hash(encoded)!==ref)throw Error('Immutable pack checksum mismatch')
   seen.add(ref);entries.push([ref,block,Buffer.byteLength(encoded)*2+128])
  }
  if(!seen.has(id))throw Error('Immutable pack is missing requested block')
  for(const entry of entries)cachePacked(dir,...entry)
  contents?.push(...seen)
  return entries.find(entry=>entry[0]===id)[1]
 }
 function directory(id){
  if(typeof id!=='string'||!id||id==='.'||id==='..'||/[\\/\0]/.test(id))throw Error('Invalid conversation id')
  return path.join(root,id)
 }
 function blobPath(dir,id){
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid block reference')
  return path.join(dir,'blocks',id.slice(0,2),id+'.json')
 }
 async function syncDirectory(dir){
  if(relaxedDepth>0){relaxedDirectories.add(dir);return}
  await fsyncDirectoryRaw(dir)
 }
 async function writeBlock(dir,value,directories){
  const bytes=JSON.stringify(value),id=hash(bytes),target=blobPath(dir,id),parent=path.dirname(target)
  await mkdir(parent,{recursive:true})
  if(directories){directories.add(parent);directories.add(path.dirname(parent));directories.add(dir)}
  let existing
  try{existing=await readFile(target,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
  if(existing!==undefined){
   onIO({kind:'read',type:value.kind,bytes:Buffer.byteLength(existing),reason:'deduplication'})
   if(existing!==bytes&&JSON.stringify(decodeBlock(dir,id,existing))!==bytes)throw Error('Immutable block corruption')
   return id
  }
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
 function reader(dir){
  // Reader-local references sit over a bounded immutable block cache.
  const cache=new Map()
  return async function readBlock(id,kind){
   if(!cache.has(id)){
    const remembered=packed.get(dir+'/'+id)
    if(remembered){cache.set(id,remembered.value);packed.delete(dir+'/'+id);packed.set(dir+'/'+id,remembered)}
    else {
     const bytes=await readFile(blobPath(dir,id),'utf8'),value=decodeBlock(dir,id,bytes)
     cache.set(id,value);onIO({kind:'read',type:value.kind,bytes:Buffer.byteLength(bytes)})
    }
   }
   const value=cache.get(id)
   if(kind&&value.kind!==kind)throw Error('Invalid block type')
   return value
  }
 }
 function validateHead(head,id){
  if(head.format!==FORMAT||head.id!==id||!integer(head.revision,1)||!integer(head.count)||!integer(head.height)||head.height>10)throw Error('Invalid conversation head')
  return head
 }
 async function current(dir,id,read){
  const bytes=await promotion.read(path.join(dir,'head.json'))
  if(bytes===undefined)return undefined
  const pointer=JSON.parse(bytes)
  if(!readablePointer(pointer.format))throw Error('Unsupported conversation format')
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
 async function build(dir,messages){
  let refs=[]
  for(let i=0;i<messages.length;i+=PAGE_SIZE)refs.push(await writeBlock(dir,{kind:'page',messages:messages.slice(i,i+PAGE_SIZE)}))
  let height=0
  while(refs.length>1){
   const next=[]
   for(let i=0;i<refs.length;i+=FANOUT)next.push(await writeBlock(dir,{kind:'index',children:refs.slice(i,i+FANOUT)}))
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
  await promotion.update(path.join(dir,'head.json'),async current=>{
   if(current!==undefined)throw conflict()
   const messages=value.messages??[],tree=await build(dir,messages)
   const head={kind:'head',format:FORMAT,id,revision:1,count:messages.length,...tree,
    stateId:await writeBlock(dir,{kind:'state',value:value.state}),metadataId:await writeBlock(dir,{kind:'metadata',value:value.metadata??{}})}
   const headId=await writeBlock(dir,head)
   result={revision:1,snapshotId:headId}
   await verifyBeforePublish?.(headId)
   assertCurrent?.()
   return JSON.stringify({format:POINTER_FORMAT,headId})
  })
  return result
 }
 async function commit(id,input,{assertCurrent}={}){
  const dir=directory(id),change=copy(input),diskRead=reader(dir),pending=new Map()
  // References depend on content, not write order. Build the new immutable graph
  // in memory, then durably flush independent blocks before publishing its head.
  const write=async value=>{const id=hash(JSON.stringify(value));pending.set(id,value);return id}
  const read=async (id,kind)=>{
   if(!pending.has(id))return diskRead(id,kind)
   const value=pending.get(id)
   if(kind&&value.kind!==kind)throw Error('Invalid block type')
   return value
  }
  async function flush(){await writePacked(dir,[...pending.values()])}
  if(!integer(change.expectedRevision,1)||!Array.isArray(change.append??[])||!(change.append??[]).every(record)
    ||!Array.isArray(change.edits??[])||(Object.hasOwn(change,'state')&&!record(change.state)))throw Error('Invalid commit')
  let result
  await promotion.update(path.join(dir,'head.json'),async pointer=>{
   if(pointer===undefined)throw conflict()
   const reference=JSON.parse(pointer)
   if(!readablePointer(reference.format))throw Error('Unsupported conversation format')
   const head=validateHead(await read(reference.headId,'head'),id)
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
   const next={...head,revision:head.revision+1,count,root:treeRoot,height,previousHeadId:reference.headId}
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
   const headId=await write(next)
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
  const dir=directory(id),read=reader(dir)
  const selected=snapshotId?{head:validateHead(await read(snapshotId,'head'),id),headId:snapshotId}:await current(dir,id,read)
  if(!selected)return undefined
  const {head,headId}=selected
  return {revision:head.revision,messageCount:head.count,snapshotCursor:{snapshotId:headId,before:head.count},
   state:copy((await read(head.stateId,'state')).value),metadata:copy((await read(head.metadataId,'metadata')).value)}
 }
 async function openConversation(id,{limit=50,snapshotId}={}){
  pageLimit(limit)
  const dir=directory(id),read=reader(dir)
  const selected=snapshotId?{head:validateHead(await read(snapshotId,'head'),id),headId:snapshotId}:await current(dir,id,read)
  if(!selected)return undefined
  const {head,headId}=selected
  return {...await page(read,head,headId,head.count,limit),state:copy((await read(head.stateId,'state')).value),metadata:copy((await read(head.metadataId,'metadata')).value)}
 }
 async function readHistoryPage(id,{cursor,limit=50}={}){
  pageLimit(limit)
  if(!record(cursor))throw Error('Invalid history cursor')
  const read=reader(directory(id))
  let head
  try{head=await read(cursor.snapshotId,'head')}catch(error){
   if(error.code==='ENOENT')throw Error('Invalid history cursor')
   throw error
  }
  if(head.id!==id)throw Error('Foreign history cursor')
  validateHead(head,id)
  return page(read,head,cursor.snapshotId,cursor.before,limit)
 }
 async function readState(id,{snapshotId}={}){
  const dir=directory(id),read=reader(dir)
  const head=snapshotId?validateHead(await read(snapshotId,'head'),id):(await current(dir,id,read))?.head
  return head?copy((await read(head.stateId,'state')).value):undefined
 }
 // Detached immutable records let migration separate large historical state
 // and extension payloads from the page body. They are not a second mutable head.
 async function writeRecord(id,value){return writeBlock(directory(id),{kind:'record',value:copy(value)})}
 // Independent immutable blocks may be flushed concurrently. All files and
 // directory entries are durable before this returns and BEFORE head publication.
 async function writeRecords(id,values){
  return writePacked(directory(id),copy(values).map(value=>({kind:'record',value})))
 }
 // Durably store blocks, several per pack file. Each block keeps its own path
 // as a hard link to its pack, so lookups need no index; filesystems without
 // hard links fall back to one file per block. Everything (files and
 // directory entries) is synced before this returns, i.e. before any head
 // naming these blocks is published.
 async function writePacked(dir,blocks){
  const directories=new Set(),refs=new Array(blocks.length)
  const entries=new Map(),groups=[]
  for(let i=0;i<blocks.length;i++){
   const bytes=JSON.stringify(blocks[i]),ref=hash(bytes)
   refs[i]=ref;entries.set(ref,{ref,block:blocks[i],bytes})
  }
  let group=[],groupBytes=64
  for(const entry of entries.values()){
   let existing
   try{existing=await readFile(blobPath(dir,entry.ref),'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
   if(existing!==undefined){
    if(JSON.stringify(decodeBlock(dir,entry.ref,existing))!==entry.bytes)throw Error('Immutable block corruption')
    onIO({kind:'read',type:entry.block.kind,bytes:Buffer.byteLength(existing),reason:'deduplication'})
    continue
   }
   // Blocks are addressed by content, so a revision that changed one page still offers every
   // page again. Only the blocks that actually land create directory entries: syncing the
   // untouched directories too turned one game import into a thousand fsyncs on a phone.
   directories.add(path.dirname(blobPath(dir,entry.ref)))
   const size=Buffer.byteLength(entry.bytes)+70
   if(group.length&&(groupBytes+size>PACK_BYTES||group.length>=PACK_ENTRIES)){groups.push(group);group=[];groupBytes=64}
   group.push(entry);groupBytes+=size
  }
  if(group.length)groups.push(group)
  const packDirectory=path.join(dir,'blocks','.packs')
  if(groups.some(group=>group.length>1)){await mkdir(packDirectory,{recursive:true});directories.add(packDirectory)}
  let index=0
  const workers=Array.from({length:Math.min(8,groups.length)},async()=>{
   while(index<groups.length){
    const group=groups[index++]
    if(group.length===1){await writeBlock(dir,group[0].block,directories);continue}
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
        await writeBlock(dir,entry.block,directories)
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
 async function readRecord(id,reference){return copy((await reader(directory(id))(reference,'record')).value)}
 async function readEntries(id,keys,{snapshotId}={}){
  if(!Array.isArray(keys))throw Error('Invalid record keys')
  const routes=keys.map(recordKey),dir=directory(id),read=reader(dir)
  const head=snapshotId?validateHead(await read(snapshotId,'head'),id):(await current(dir,id,read))?.head
  if(!head)return undefined
  const entries=[]
  for(let i=0;i<keys.length;i++){
   const ref=await lookup(read,head.recordRoot,keys[i],routes[i])
   if(ref)entries.push([keys[i],copy((await read(ref,'record')).value)])
  }
  return Object.fromEntries(entries)
 }
 // Rewrite the keyed-record index keeping only keys the caller still needs
 // (e.g. per-revision pointers of revisions nothing reads any more). Publishes
 // a new head with the same messages and state; returns how many keys went.
 async function pruneEntries(id,keep){
  const dir=directory(id),diskRead=reader(dir),pending=new Map()
  const write=async value=>{const ref=hash(JSON.stringify(value));pending.set(ref,value);return ref}
  const read=async (ref,kind)=>pending.has(ref)?pending.get(ref):diskRead(ref,kind)
  let removed=0
  await promotion.update(path.join(dir,'head.json'),async pointer=>{
   if(pointer===undefined)throw conflict()
   const reference=JSON.parse(pointer)
   if(!readablePointer(reference.format))throw Error('Unsupported conversation format')
   const head=validateHead(await read(reference.headId,'head'),id)
   if(!head.recordRoot)return undefined
   const entries=[]
   async function collect(ref,depth=0){
    if(!ref)return
    const node=await read(ref)
    if(node.kind==='entry'){entries.push(node);return}
    if(node.kind!=='entries'||depth>=64)throw Error('Invalid record index')
    for(const child of Object.values(node.children))await collect(child,depth+1)
   }
   await collect(head.recordRoot)
   const kept=entries.filter(entry=>keep(entry.key))
   removed=entries.length-kept.length
   if(!removed)return undefined
   const recordRoot=kept.length?await putEntries(dir,read,null,kept.map(entry=>({key:entry.key,valueRef:entry.valueRef,route:recordKey(entry.key)})),0,write):undefined
   const next={...head,revision:head.revision+1,previousHeadId:reference.headId}
   if(recordRoot)next.recordRoot=recordRoot;else delete next.recordRoot
   const headId=await write(next)
   await writePacked(dir,[...pending.values()])
   return JSON.stringify({format:POINTER_FORMAT,headId})
  })
  return {removed}
 }
 // A pack keeps every block it was written with; once some are swept, the
 // rest still pin the whole file. Rewrite packs that are mostly dead (or
 // nearly empty), together with loose one-file blocks, into fresh block packs
 // holding only live blocks, and atomically repoint each block's link.
 async function repack(dir,cutoff){
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
   if(hash(bytes)===item.ref)live.set(item.ref,JSON.parse(bytes))
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
 async function sweep(id,{retainEntry=()=>true,graceMs=10*60*1000,dryRun=false,now=Date.now()}={}){
  const dir=directory(id),blocks=path.join(dir,'blocks'),HEX=/^[a-f0-9]{64}$/
  let result
  await promotion.update(path.join(dir,'head.json'),async pointer=>{
   if(pointer===undefined)throw Error('Conversation not found')
   const reference=JSON.parse(pointer)
   if(!readablePointer(reference.format))throw Error('Unsupported conversation format')
   const marked=new Set(),queue=[[reference.headId,true]]
   // Through the read cache: a pack is parsed once, not once per block it holds.
   async function load(ref,required){
    const cached=packed.get(dir+'/'+ref)
    if(cached)return cached.value
    let bytes
    try{bytes=await readFile(blobPath(dir,ref),'utf8')}catch(error){
     if(error.code==='ENOENT'&&!required)return undefined
     throw error
    }
    return decodeBlock(dir,ref,bytes)
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
    if(value.kind==='head'){for(const key of ['root','stateId','metadataId',...(ref===reference.headId?['recordRoot']:[])])if(value[key])strong.push(value[key])}
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
   // Packed records are hard links to one pack inode; space returns only
   // when every link, including the pack's own, is gone.
   let removed=0,kept=0
   const cutoff=now-graceMs,inodes=new Map()
   async function remove(file,info){
    const key=info.dev+':'+info.ino,entry=inodes.get(key)||{nlink:info.nlink,size:info.size,removed:0}
    entry.removed++;inodes.set(key,entry);removed++
    if(!dryRun)await rm(file,{force:true})
   }
   let shards=[]
   try{shards=await readdir(blocks)}catch(error){if(error.code!=='ENOENT')throw error}
   for(const shard of shards){
    if(!/^[a-f0-9]{2}$/.test(shard))continue
    for(const name of await readdir(path.join(blocks,shard))){
     const file=path.join(blocks,shard,name),ref=name.slice(0,-5)
     if(!name.endsWith('.json')||!HEX.test(ref))continue
     if(marked.has(ref)){kept++;continue}
     const info=await stat(file)
     if(info.mtimeMs>cutoff){kept++;continue}
     await remove(file,info)
     // A later mark must not find a removed block through the cache.
     const cached=!dryRun&&packed.get(dir+'/'+ref)
     if(cached){packedBytes-=cached.size;packed.delete(dir+'/'+ref)}
    }
   }
   const packs=path.join(blocks,'.packs')
   let packNames=[]
   try{packNames=await readdir(packs)}catch(error){if(error.code!=='ENOENT')throw error}
   for(const name of packNames){
    if(!name.endsWith('.json'))continue
    const file=path.join(packs,name),info=await stat(file),entry=inodes.get(info.dev+':'+info.ino)
    // Removed links already lowered nlink on disk; count against the first stat.
    if((entry?.nlink??info.nlink)-(entry?.removed??0)===1&&info.mtimeMs<=cutoff)await remove(file,info)
   }
   let bytes=0
   for(const entry of inodes.values())if(entry.removed>=entry.nlink)bytes+=entry.size
   const repacked=dryRun?{packs:0,bytes:0}:await repack(dir,cutoff)
   result={reachable:marked.size,kept,removed,bytes:bytes+repacked.bytes,repackedPacks:repacked.packs}
   return undefined
  })
  return result
 }
 // Each commit packs only the blocks it changed, so after many commits one floor's
 // tree is spread over hundreds of packs and a cold open parses each pack many
 // times. Visit the head's blocks in the order an open reads them: head, metadata,
 // state, the page tree, then each floor newest first, each floor's tree depth
 // first. Each unit (the header part, the page tree, one floor) counts the distinct
 // files it touches. Older heads and the keyed-record index are not on this path.
 async function layout(dir,headId,visit){
  const seen=new Set(),pages=[],fileOf=new Map()
  let unit=0
  async function load(ref){
   const cached=fileOf.has(ref)&&packed.get(dir+'/'+ref)
   if(cached)return cached.value
   const bytes=await readFile(blobPath(dir,ref),'utf8'),contents=[]
   const value=decodeBlock(dir,ref,bytes,contents)
   onIO({kind:'read',type:value.kind,bytes:Buffer.byteLength(bytes),reason:'relayout'})
   for(const sibling of contents)fileOf.set(sibling,contents[0])
   return value
  }
  async function walk(roots){
   const stack=[...roots].reverse()
   while(stack.length){
    const [ref,required]=stack.pop()
    if(seen.has(ref))continue
    let value
    try{value=await load(ref)}catch(error){if(error.code==='ENOENT'&&!required)continue;throw error}
    if(ref!==headId&&['head','entries','entry'].includes(value.kind))continue
    seen.add(ref);await visit(ref,value,fileOf.get(ref),unit)
    if(value.kind==='page')pages.push(value)
    const next=value.kind==='index'?value.children.filter(Boolean).map(child=>[child,true])
     :value.kind==='head'||value.kind==='page'?[]:hexRefs(value).map(child=>[child,false])
    for(let i=next.length-1;i>=0;i--)stack.push(next[i])
   }
  }
  const head=validateHead(await load(headId),path.basename(dir))
  await walk([[headId,true],[head.metadataId,true],[head.stateId,true]])
  pages.length=0
  unit++
  if(head.root)await walk([[head.root,true]])
  for(let p=pages.length-1;p>=0;p--)for(let m=pages[p].messages.length-1;m>=0;m--){
   unit++
   await walk(hexRefs(pages[p].messages[m]).map(ref=>[ref,false]))
  }
 }
 // The same greedy grouping as writePacked and repack, in visiting order.
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
 // block's link atomically, as repack does. Reading and writing packs needs no lock:
 // the head is immutable and packs are new files. Relinking holds the write lock
 // for at most RELAYOUT_LOCK_MS at a time so queued commits run in between. A link
 // is valid whatever head is current (content addressing); a block swept between
 // two steps may come back only as garbage for the next sweep. The sweep frees the
 // emptied old packs.
 async function relayout(id,{dryRun=false}={}){
  const dir=directory(id),pointer=await promotion.read(path.join(dir,'head.json'))
  if(pointer===undefined)return undefined
  const reference=JSON.parse(pointer)
  if(!readablePointer(reference.format))throw Error('Unsupported conversation format')
  const units=new Map(),files=new Set()
  let blocks=0,bytes=0,phase=performance.now()
  const touch=(unit,key)=>{if(!units.has(unit))units.set(unit,{files:new Set(),groups:new Set()});return units.get(unit)[key]}
  const ideal=packer(async()=>{})
  await layout(dir,reference.headId,async(ref,value,file,unit)=>{
   const size=Buffer.byteLength(JSON.stringify(value))+70
   blocks++;bytes+=size;files.add(file);touch(unit,'files').add(file)
   touch(unit,'groups').add(await ideal.add(ref,size))
  })
  const sum=key=>[...units.values()].reduce((total,unit)=>total+unit[key].size,0)
  const result={headId:reference.headId,blocks,bytes,files:files.size,visits:sum('files'),ideal:sum('groups'),relinked:0,written:0,
   measureMs:Math.round(performance.now()-phase),writeMs:0,relinkMs:0,lockHolds:0,maxLockMs:0}
  result.fragmented=result.visits>RELAYOUT_RATIO*result.ideal&&result.visits-result.ideal>=RELAYOUT_MIN_EXCESS
  if(dryRun||!result.fragmented)return result
  // Without hard links every block keeps its own file; there is nothing to repoint.
  const probe=blobPath(dir,reference.headId)+'.relink-'+randomUUID()
  try{await linkFile(blobPath(dir,reference.headId),probe)}
  catch(error){if(UNLINKABLE.includes(error.code))return result;throw error}
  finally{await rm(probe,{force:true})}
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
  let next=0
  while(next<written.length){
   let gone=false
   await promotion.update(path.join(dir,'head.json'),async current=>{
    if(current===undefined){gone=true;return undefined}
    const started=performance.now(),directories=new Set()
    while(next<written.length&&performance.now()<started+RELAYOUT_LOCK_MS){
     const {target,refs}=written[next++]
     let index=0
     await Promise.all(Array.from({length:8},async()=>{
      while(index<refs.length){
       const destination=blobPath(dir,refs[index++]),temporary=destination+'.relink-'+randomUUID()
       try{await linkFile(target,temporary);await rename(temporary,destination);directories.add(path.dirname(destination));result.relinked++}
       catch(error){
        await rm(temporary,{force:true})
        if(error.code!=='ENOENT'&&!UNLINKABLE.includes(error.code))throw error
       }
      }
     }))
    }
    for(const directory of directories)await syncDirectory(directory)
    result.lockHolds++;result.maxLockMs=Math.max(result.maxLockMs,Math.round(performance.now()-started))
    return undefined
   })
   if(gone)break
  }
  result.relinkMs=Math.round(performance.now()-phase)
  return result
 }
 return Object.freeze({create,commit,readHead,openConversation,readHistoryPage,readState,writeRecord,writeRecords,readRecord,readEntries,sweep,pruneEntries,relayout})
}
