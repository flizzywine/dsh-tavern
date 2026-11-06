import {createHash} from 'node:crypto'
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
   const bytes=JSON.stringify({kind:'record',value})
   const ref=createHash('sha256').update(bytes).digest('hex')
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
  const expected=[...selected.keys()],refs=await writeMany([...selected.values()])
  if(refs.some((ref,i)=>ref!==expected[i])||refs.length!==selected.size)throw Error('Buffered record hash mismatch')
 }
 return Object.freeze({tree,flush})
}
