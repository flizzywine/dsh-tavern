import {recordBlock} from './conversation-page-store.js'
import {createIncrementalJsonState} from './incremental-json-state.js'

/** One transaction's private JSON tree builder. Intermediate roots never escape
 * to disk. Flush only nodes reachable from the roots that the head will publish.
 * A failed transaction can leave immutable orphans, never a partial active head.
 */
export function createBufferedJsonRecords({read,writeMany}){
 const pending=new Map(),loaded=new Map()
 const tree=createIncrementalJsonState({
  async read(ref){
   if(pending.has(ref))return structuredClone(pending.get(ref))
   if(!loaded.has(ref))loaded.set(ref,await read(ref))
   return structuredClone(loaded.get(ref))
  },
  async write(value){
   const {bytes,ref}=recordBlock(value)
   if(!pending.has(ref))pending.set(ref,JSON.parse(bytes).value)
   return ref
  }
 })
 async function flush(roots){
  const selected=new Map()
  function visit(ref){
   if(!pending.has(ref)||selected.has(ref))return
   const value=pending.get(ref)
   selected.set(ref,value)
   if(value.type==='object'||value.type==='array')visit(value.entries)
   else if(value.type==='branches')Object.values(value.children).forEach(visit)
   else if(value.type==='bucket')value.items.forEach(([,link])=>{if(link.ref)visit(link.ref)})
   else if(value.type!=='scalar')throw Error('Invalid buffered JSON tree node')
  }
  roots.forEach(visit)
  // refs come from the store's own record encoding (recordBlock); the store reuses them
  // rather than hashing every record again and comparing.
  await writeMany([...selected.values()],[...selected.keys()])
 }
 return Object.freeze({tree,flush})
}
