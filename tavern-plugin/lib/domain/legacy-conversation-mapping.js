import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {lastTavernHelperVariables} from './tavern-helper-context.js'

const FORMAT='legacy-chat-mapping-v1'
const CONTENT_FIELDS=new Set(['id','role','text','sourceText','ts','turn','greeting','native','name','tavernRole','tavernHidden'])
const STATE_FIELDS=new Set(['variables','posture','ledger','scriptState','settleStatus','settleError','lastSettle','tavernHelperScriptVariables','macroState'])
const digest=text=>createHash('sha256').update(text).digest('hex')
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const clone=value=>JSON.parse(JSON.stringify(value))
const conflict=()=>Object.assign(new Error('Conversation revision conflict'),{code:'CONVERSATION_CONFLICT'})

// Persisted JSON is the migration contract. Reject values JSON.stringify would
// silently remove/change; an import must never certify such a conversion.
function assertJson(value,parents=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return
 if(typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return
 if(typeof value!=='object'||parents.has(value))throw Error('Legacy mapping requires lossless JSON data')
 const prototype=Object.getPrototypeOf(value)
 if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)throw Error('Legacy mapping requires plain JSON objects')
 const keys=Object.keys(value)
 if(Object.getOwnPropertyNames(value).length!==keys.length+(Array.isArray(value)?1:0))throw Error('Legacy mapping rejects hidden fields')
 if(Array.isArray(value)&&(keys.length!==value.length||keys.some((key,i)=>key!==String(i))))throw Error('Legacy mapping rejects sparse or extended arrays')
 if(Object.getOwnPropertySymbols(value).length)throw Error('Legacy mapping rejects symbol fields')
 parents.add(value)
 for(const key of keys){
  const descriptor=Object.getOwnPropertyDescriptor(value,key)
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('Legacy mapping rejects accessor fields')
  assertJson(descriptor.value,parents)
 }
 parents.delete(value)
}

// Shadow import only: no source deletion, source pointer switch, or domain
// writes. The old Chat remains authoritative until the later cutover protocol.
export function createLegacyConversationMapping({store}){
 function recordReader(id){
  const cache=new Map();let bytes=0
  return async reference=>{
   if(cache.has(reference)){
    const entry=cache.get(reference);cache.delete(reference);cache.set(reference,entry)
    return clone(entry.value)
   }
   const value=await store.readRecord(id,reference),size=Buffer.byteLength(JSON.stringify(value))
   if(size<=16*1024*1024){
    cache.set(reference,{value,size});bytes+=size
    while(cache.size>256||bytes>16*1024*1024){const first=cache.keys().next().value;bytes-=cache.get(first).size;cache.delete(first)}
   }
   return clone(value)
  }
 }
 async function restoreMessage(read,row){
  if(!object(row)||!Array.isArray(row.originalKeys)||!object(row.content))throw Error('Invalid legacy message mapping')
  const details=await read(row.fieldsRef)
  const variables=Object.hasOwn(row,'variablesRef')?await read(row.variablesRef):undefined
  const baseline=Object.hasOwn(row,'baselineRef')?await read(row.baselineRef):undefined
  return Object.fromEntries(row.originalKeys.map(key=>{
   if(Object.hasOwn(row.content,key))return [key,row.content[key]]
   if(key==='variables'&&Object.hasOwn(row,'variablesRef'))return [key,variables]
   if(key==='mvuBaseline'&&Object.hasOwn(row,'baselineRef'))return [key,baseline]
   if(!Object.hasOwn(details,key))throw Error('Missing legacy message field: '+key)
   return [key,details[key]]
  }))
 }
 async function importChat(id,input){
  assertJson(input)
  if(!object(input)||typeof input.id!=='string'||!input.id||!Array.isArray(input.messages)||!input.messages.every(object))throw Error('Invalid legacy Chat')
  // Capture before the first await. Later edits by the caller do not change
  // which snapshot is being verified and imported.
  const sourceText=JSON.stringify(input),source=JSON.parse(sourceText)
  if(await store.openConversation(id,{limit:1}))throw conflict()
  const writes=new Map()
  async function put(value){
   const key=digest(JSON.stringify(value))
   if(writes.has(key)){
    const ref=writes.get(key);writes.delete(key);writes.set(key,ref);return ref
   }
   const ref=await store.writeRecord(id,value)
   writes.set(key,ref)
   if(writes.size>256)writes.delete(writes.keys().next().value)
   return ref
  }
  const chatFields=Object.fromEntries(Object.entries(source).filter(([key])=>STATE_FIELDS.has(key)))
  const coldHeader=Object.fromEntries(Object.entries(source).filter(([key])=>key!=='messages'&&!STATE_FIELDS.has(key)))
  const state={chatFields}
  const messageVariables=lastTavernHelperVariables(source.messages)
  if(messageVariables!==undefined)state.messageVariables=messageVariables
  const metadata={format:FORMAT,sourceId:source.id,sourceRevision:source._storageRevision??null,
   sourceDigest:digest(sourceText),originalKeys:Object.keys(source),headerRef:await put(coldHeader)}
  const messages=[]
  const read=recordReader(id)
  for(let position=0;position<source.messages.length;position++){
   const original=source.messages[position]
   const content=Object.fromEntries(Object.entries(original).filter(([key])=>CONTENT_FIELDS.has(key)))
   const details=Object.fromEntries(Object.entries(original).filter(([key])=>!CONTENT_FIELDS.has(key)&&key!=='variables'&&key!=='mvuBaseline'))
   const row={id:'legacy:'+source.id+':'+position,originalKeys:Object.keys(original),content,fieldsRef:await put(details)}
   if(Object.hasOwn(original,'variables'))row.variablesRef=await put(original.variables)
   if(Object.hasOwn(original,'mvuBaseline'))row.baselineRef=await put(original.mvuBaseline)
   // Verify detached records from disk, not just the in-memory encoder.
   const restored=await restoreMessage(read,row)
   if(!isDeepStrictEqual(restored,original)||JSON.stringify(restored)!==JSON.stringify(original))throw Error('Legacy message mapping verification failed')
   messages.push(row)
  }
  const storedHeader=await read(metadata.headerRef)
  const restoredHeader=Object.fromEntries(metadata.originalKeys.filter(key=>key!=='messages').map(key=>[key,Object.hasOwn(chatFields,key)?chatFields[key]:storedHeader[key]]))
  const expectedHeader=Object.fromEntries(Object.entries(source).filter(([key])=>key!=='messages'))
  if(!isDeepStrictEqual(restoredHeader,expectedHeader)||JSON.stringify(restoredHeader)!==JSON.stringify(expectedHeader))throw Error('Legacy header mapping verification failed')
  const committed=await store.create(id,{state,metadata,messages})
  return {...committed,verified:true,sourceId:source.id,sourceRevision:metadata.sourceRevision,sourceDigest:metadata.sourceDigest,messageCount:messages.length}
 }
 async function exportChat(id,{snapshotId}={}){
  const opened=await store.openConversation(id,{limit:500,snapshotId})
  if(!opened)return undefined
  if(opened.metadata?.format!==FORMAT||!object(opened.state?.chatFields))throw Error('Invalid legacy mapping state')
  const read=recordReader(id),messages=new Array(opened.messageCount)
  let page=opened
  while(true){
   for(const row of page.messages)messages[row.position]=await restoreMessage(read,row.message)
   if(!page.previousCursor)break
   page=await store.readHistoryPage(id,{cursor:page.previousCursor,limit:500})
  }
  const header=await read(opened.metadata.headerRef),state=opened.state.chatFields
  const restored=Object.fromEntries(opened.metadata.originalKeys.map(key=>{
   if(key==='messages')return [key,messages]
   if(Object.hasOwn(state,key))return [key,state[key]]
   if(!Object.hasOwn(header,key))throw Error('Missing legacy header field: '+key)
   return [key,header[key]]
  }))
  if(digest(JSON.stringify(restored))!==opened.metadata.sourceDigest)throw Error('Legacy mapping digest mismatch')
  return restored
 }
 async function readMessage(id,{cursor,position}){
  if(!Number.isSafeInteger(position)||position<0)throw Error('Invalid message position')
  const page=await store.readHistoryPage(id,{cursor:{...cursor,before:position+1},limit:1})
  return restoreMessage(recordReader(id),page.messages[0].message)
 }
 return Object.freeze({importChat,exportChat,readMessage})
}
