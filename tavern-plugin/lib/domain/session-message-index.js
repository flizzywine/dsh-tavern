import {createIndexedArrayApi} from './indexed-array.js'
import {createScopedMessages} from './scoped-messages.js'
import {copyJsonTree} from './copy-json-tree.js'
import {projectSessionMessage} from './chat-session-state.js'

// Retain only compact metadata, never a strong reference to full variable history.
export function createSessionMessageIndex({maxBytes=8*1024*1024,maxEntries=8}={}) {
  const cache=new Map()
  let bytes=0
  const index=createIndexedArrayApi({
    eligible:row=>Boolean(row.pending),
    measure:row=>JSON.stringify(row).length*2
  })
  function rowOf(source) {
    const pending=source?.role==='assistant' && source.mvu?.pending===true
    return {message:copyJsonTree(projectSessionMessage(source)),pending:pending ? {
      hasSubmission:Boolean(source.mvu.pendingSubmission),prepared:Boolean(source.mvu.delivery?.prepared)
    }:null}
  }
  function forget(id) {
    const old=cache.get(id)
    if(old)bytes-=old.bytes
    cache.delete(id)
  }
  function remember(id,source,rows) {
    forget(id)
    const size=index.info(rows).bytes
    if(size>maxBytes || maxEntries<=0)return
    while(cache.size && (cache.size>=maxEntries || bytes+size>maxBytes))forget(cache.keys().next().value)
    cache.set(id,{source:new WeakRef(source),rows,bytes:size});bytes+=size
  }
  function advance(id,before,after,indices) {
    const old=cache.get(id)
    if(old?.source.deref()!==before || before.length!==after.length)return
    const rows=index.update(old.rows,indices.map(i=>[i,rowOf(after[i])]))
    remember(id,after,rows)
  }
  function project(chat) {
    const source=Array.isArray(chat.messages) ? chat.messages : []
    const old=cache.get(chat.id)
    const rows=old?.source.deref()===source ? old.rows : index.from(source.map(rowOf))
    if(old?.source.deref()!==source)remember(chat.id,source,rows)
    const pending=index.previous(rows,rows.length)
    const owned=new Map()
    const messages=createScopedMessages(rows.length,[],id=>{
      if(!owned.has(id))owned.set(id,copyJsonTree(rows[id].message))
      return owned.get(id)
    })
    return {messages,pendingMvuSettlement:pending<0 ? null : copyJsonTree(rows[pending].pending)}
  }
  return {project,advance,forget}
}
