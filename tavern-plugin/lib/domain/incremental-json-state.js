import {copyJsonTree} from './copy-json-tree.js'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'

const fail=message=>Object.assign(new Error(message),{code:'STATE_DELTA_INVALID'})
const digest=key=>createHash('sha256').update(key).digest('hex')
const own=(value,key)=>Object.hasOwn(value,key)
export function captureJson(value){
 let copy
 try{copy=JSON.parse(JSON.stringify(value))}catch{throw fail('Expected lossless JSON')}
 if(!isDeepStrictEqual(value,copy))throw fail('Expected lossless JSON')
 return copy
}
function pathParts(path){
 if(typeof path!=='string'||(path!==''&&!path.startsWith('/'))||/~(?:[^01]|$)/.test(path))throw fail('Invalid JSON pointer')
 return path===''?[]:path.slice(1).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~'))
}
function indexOf(key,length,append=false){
 if(append&&key==='-')return length
 if(!/^(0|[1-9]\d*)$/.test(key))throw fail('Invalid array index')
 const index=Number(key)
 if(!Number.isSafeInteger(index)||index<0||index>=length+(append?1:0))throw fail('Array index out of range')
 return index
}

/** Owned, bounded decoded values for immutable record references. */
export function createDecodedJsonCache(maxBytes = 0) {
 const entries = new Map(); let bytes = 0
 return {
  get(ref) {
   const entry = entries.get(ref)
   if (entry) { entries.delete(ref); entries.set(ref, entry) }
   return entry
  },
  // `owned`: the value is a decoder-owned tree no caller holds (callers get
  // copies), so it is kept as is and may share subtrees with other entries.
  remember(ref, value, owned = false) {
   if (!(maxBytes > 0)) return
   const size = JSON.stringify(value).length * 4 + 256
   if (size > maxBytes) return
   if (entries.has(ref)) { bytes -= entries.get(ref).size; entries.delete(ref) }
   while (entries.size && bytes + size > maxBytes) {
    const key = entries.keys().next().value; bytes -= entries.get(key).size; entries.delete(key)
   }
   entries.set(ref, { value: owned ? value : copyJsonTree(value), size }); bytes += size
  }
 }
}

// A shared decoder cache is valid only for one immutable reference namespace.
// Native storage uses content hashes; unrelated opaque-reference stores must
// retain the default private cache.
// shareSubtrees is for short-lived instances (one storage operation). Floors of a
// chat repeat most of their tree (variables, card state); with it each referenced
// subtree is built once per instance and shared inside the decoder-owned trees.
// Callers still receive detached copies.
export function createIncrementalJsonState({read,write,decodedCacheBytes=0,decodedCache=createDecodedJsonCache(decodedCacheBytes),shareSubtrees=false}){
 const rememberDecoded = (ref,value,owned) => decodedCache.remember(ref,value,owned)
 const subtrees=shareSubtrees?new Map():null
 function session(){
  const cache=new Map()
  return {get:async ref=>{if(!cache.has(ref))cache.set(ref,await read(ref));return cache.get(ref)},
   put:async node=>{const ref=await write(node);cache.set(ref,node);return ref}}
 }
 async function bucket(s,items,depth=0){
  if(items.length<=32||depth===64)return s.put({type:'bucket',items:items.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)})
  const groups={}
  for(const item of items)(groups[digest(item[0])[depth]]??=[]).push(item)
  const children={}
  for(const slot of Object.keys(groups).sort())children[slot]=await bucket(s,groups[slot],depth+1)
  return s.put({type:'branches',children})
 }
 async function lookup(s,ref,key,route=digest(key),depth=0){
  if(!ref)return undefined
  const node=await s.get(ref)
  if(node.type==='bucket')return node.items.find(item=>item[0]===key)
  if(node.type!=='branches'||depth>=64)throw fail('Corrupt state index')
  return lookup(s,node.children[route[depth]],key,route,depth+1)
 }
 async function change(s,ref,key,item,route=digest(key),depth=0){
  if(!ref)return item?bucket(s,[item],depth):null
  const node=await s.get(ref)
  if(node.type==='bucket'){
   const items=node.items.filter(entry=>entry[0]!==key)
   if(item)items.push(item)
   return items.length?bucket(s,items,depth):null
  }
  if(node.type!=='branches'||depth>=64)throw fail('Corrupt state index')
  const slot=route[depth],children={...node.children},next=await change(s,children[slot],key,item,route,depth+1)
  if(next)children[slot]=next;else delete children[slot]
  if(!Object.keys(children).length)return null
  return s.put({type:'branches',children:Object.fromEntries(Object.entries(children).sort(([a],[b])=>a.localeCompare(b)))})
 }
 async function entries(s,ref){
  if(!ref)return []
  const node=await s.get(ref)
  if(node.type==='bucket')return node.items
  if(node.type!=='branches')throw fail('Corrupt state index')
  const result=[]
  for(const child of Object.values(node.children))result.push(...await entries(s,child))
  return result
 }
 async function encode(s,value){
  if(value===null||typeof value!=='object'){
   return JSON.stringify(value).length<=128?{value}:{ref:await s.put({type:'scalar',value})}
  }
  const items=[],array=Array.isArray(value),keys=Object.keys(value)
  for(let order=0;order<keys.length;order++)items.push([keys[order],await encode(s,value[keys[order]]),order])
  return {ref:await s.put({type:array?'array':'object',size:keys.length,nextOrder:keys.length,entries:items.length?await bucket(s,items):null})}
 }
 async function decode(s,link,cacheResult=true){
  if(own(link,'value'))return link.value
  const previous=decodedCache.get(link.ref)
  // With shared subtrees a nested result stays inside a decoder-owned tree.
  if(previous)return subtrees&&!cacheResult?previous.value:copyJsonTree(previous.value)
  if(subtrees&&!cacheResult){
   let work=subtrees.get(link.ref)
   if(!work){work=build(s,link);subtrees.set(link.ref,work);work.catch(()=>subtrees.delete(link.ref))}
   return work
  }
  const value=await build(s,link)
  // Budget only requested projections. Retaining every nested subtree repeats
  // the same large strings and evicts otherwise reusable resource snapshots.
  if(!cacheResult)return value
  if(!subtrees){rememberDecoded(link.ref,value);return value}
  rememberDecoded(link.ref,value,true)
  return copyJsonTree(value)
 }
 async function build(s,link){
  const node=await s.get(link.ref)
  if(node.type==='scalar')return node.value
  if(!['object','array'].includes(node.type))throw fail('Corrupt state value')
  const value=node.type==='array'?[]:{}
  for(const [key,child] of (await entries(s,node.entries)).sort((a,b)=>a[2]-b[2])){
   Object.defineProperty(value,key,{value:await decode(s,child,false),enumerable:true,writable:true,configurable:true})
  }
  return value
 }
 async function locate(s,link,parts){
  for(const key of parts){
   if(!link.ref)return undefined
   const node=await s.get(link.ref)
   if(!['object','array'].includes(node.type))return undefined
   if(node.type==='array')indexOf(key,node.size)
   const item=await lookup(s,node.entries,key)
   if(!item)return undefined
   link=item[1]
  }
  return link
 }
 async function modify(s,link,parts,op){
  if(!parts.length){
   if(op.op==='remove')throw fail('Cannot remove root')
   let value=op.value
   if(op.op==='delta'){
    const previous=await decode(s,link)
    if(typeof previous!=='number'||!Number.isFinite(previous+value))throw fail('Delta requires a finite numeric target')
    value+=previous
   }
   return {link:await encode(s,value),value}
  }
  if(!link.ref)throw fail('Missing parent object')
  const node=await s.get(link.ref),[key,...rest]=parts
  if(!['object','array'].includes(node.type))throw fail('Missing parent object')
  if(node.type==='array')indexOf(key,node.size,!rest.length&&op.op==='set')
  const normalized=node.type==='array'&&key==='-'?String(node.size):key
  const item=await lookup(s,node.entries,normalized)
  if(rest.length&&!item)throw fail('Missing parent path')
  if(!rest.length&&op.op==='remove'){
   if(!item)throw fail('Cannot remove missing path')
   // Removing an array element shifts its suffix by JSON semantics. This is
   // explicitly proportional to the affected array, not unrelated variables.
   if(node.type==='array'){
    const array=await decode(s,link);array.splice(Number(normalized),1)
    return {link:await encode(s,array)}
   }
   return {link:{ref:await s.put({...node,size:node.size-1,entries:await change(s,node.entries,normalized,null)})}}
  }
  if(!item&&op.op==='delta'&&!rest.length)throw fail('Delta target missing')
  const result=await modify(s,item?.[1]??{value:null},rest,op)
  const next={...node,size:node.size+(item?0:1),nextOrder:node.nextOrder+(item?0:1),
   entries:await change(s,node.entries,normalized,[normalized,result.link,item?.[2]??node.nextOrder])}
  return {link:{ref:await s.put(next)},value:result.value}
 }
 async function create(value){return (await encode(session(),captureJson(value))).ref??write({type:'scalar',value:captureJson(value)})}
 async function get(root,path=''){
  const s=session(),link=await locate(s,{ref:root},pathParts(path))
  return link?decode(s,link):undefined
 }
 async function apply(root,input){
  const operations=captureJson(input)
  if(!Array.isArray(operations))throw fail('Expected changes array')
  // Validate all operations before writing any prepared blocks.
  for(const op of operations){
   if(!op||!['set','remove','delta'].includes(op.op))throw fail('Unsupported change')
   pathParts(op.path)
   if(op.op!=='remove'&&!own(op,'value'))throw fail('Missing change value')
   if(op.op==='delta'&&(typeof op.value!=='number'||!Number.isFinite(op.value)))throw fail('Delta must be finite')
  }
  const s=session(),changes=[]
  let link={ref:root}
  for(const op of operations){
   const result=await modify(s,link,pathParts(op.path),op)
   link=result.link
   changes.push(op.op==='remove'?{op:'remove',path:op.path}:{op:'set',path:op.path,value:result.value})
  }
  const nextRoot=link.ref??await s.put({type:'scalar',value:link.value})
  return {baseRoot:root,nextRoot,changes}
 }
 async function calculate(root,callback){
  if(typeof callback!=='function')throw fail('Expected calculation function')
  let current=root,queue=Promise.resolve()
  const changes=[]
  const enqueue=fn=>{const task=queue.then(fn);queue=task;task.catch(()=>{});return task}
  const mutate=op=>enqueue(async()=>{const result=await apply(current,[op]);current=result.nextRoot;changes.push(...result.changes)})
  await callback(Object.freeze({get:path=>enqueue(()=>get(current,path)),
   set:(path,value)=>mutate({op:'set',path,value:captureJson(value)}),
   delta:(path,value)=>mutate({op:'delta',path,value}),remove:path=>mutate({op:'remove',path})}))
  await queue
  return {baseRoot:root,nextRoot:current,changes}
 }
 async function keys(root,path=''){
  const s=session(),link=await locate(s,{ref:root},pathParts(path))
  if(!link?.ref)throw fail('Expected container')
  const node=await s.get(link.ref)
  if(!['array','object'].includes(node.type))throw fail('Expected container')
  return (await entries(s,node.entries)).slice().sort((a,b)=>a[2]-b[2]).map(([key])=>key)
 }
 async function size(root,path=''){
  const s=session(),link=await locate(s,{ref:root},pathParts(path))
  if(!link?.ref)throw fail('Expected container')
  const node=await s.get(link.ref)
  if(!['array','object'].includes(node.type))throw fail('Expected container')
  return node.size
 }
 async function type(root,path=''){
  const s=session(),link=await locate(s,{ref:root},pathParts(path))
  if(!link)return undefined
  if(own(link,'value'))return link.value===null?'null':typeof link.value
  const node=await s.get(link.ref)
  return node.type==='scalar'?(node.value===null?'null':typeof node.value):node.type
 }
 async function exportSnapshot(root){
  const s=session(),blocks=new Map()
  async function visit(ref){
   if(!ref||blocks.has(ref))return
   const node=await s.get(ref);blocks.set(ref,node)
   if(node.type==='object'||node.type==='array')await visit(node.entries)
   else if(node.type==='branches'){for(const child of Object.values(node.children))await visit(child)}
   else if(node.type==='bucket'){for(const [,link] of node.items)if(link.ref)await visit(link.ref)}
   else if(node.type!=='scalar')throw fail('Corrupt state snapshot')
  }
  await visit(root)
  return {version:1,root,blocks:[...blocks]}
 }
 async function importSnapshot(input){
  const snapshot=captureJson(input)
  if(snapshot?.version!==1||typeof snapshot.root!=='string'||!Array.isArray(snapshot.blocks))throw fail('Invalid state snapshot')
  const seen=new Set()
  for(const entry of snapshot.blocks){
   if(!Array.isArray(entry)||entry.length!==2||seen.has(entry[0]))throw fail('Invalid snapshot block')
   seen.add(entry[0])
   if(await write(entry[1])!==entry[0])throw fail('Snapshot checksum mismatch')
  }
  // A self-contained resync must not quietly rely on unrelated local blocks.
  const tree=createIncrementalJsonState({write,read:ref=>{if(!seen.has(ref))throw fail('Incomplete snapshot');return read(ref)}})
  await tree.get(snapshot.root)
  return snapshot.root
 }
 async function receive(root,input){
  const delta=captureJson(input)
  if(!delta||typeof delta.baseRoot!=='string'||typeof delta.nextRoot!=='string'||!Array.isArray(delta.changes))throw fail('Invalid state delta')
  if(root===delta.nextRoot)return root
  if(root!==delta.baseRoot)throw Object.assign(new Error('State delta requires its exact base'),{code:'STATE_DELTA_BASE_MISMATCH'})
  const result=await apply(root,delta.changes)
  if(result.nextRoot!==delta.nextRoot)throw fail('State delta result mismatch')
  return result.nextRoot
 }
 return Object.freeze({create,get,type,size,keys,apply,calculate,receive,exportSnapshot,importSnapshot})
}
