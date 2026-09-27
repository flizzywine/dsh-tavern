import {copyJsonTree} from './copy-json-tree.js'
import {createScopedMessages} from './scoped-messages.js'

function lazyArray(source) {
  const detached=new Map()
  const rows=createScopedMessages(source.length,[],index=>{
    if(!detached.has(index))detached.set(index,copyJsonTree(source[index]))
    return detached.get(index)
  })
  // Unlike transaction-owned rows, a readable history array must enumerate
  // every index when explicitly requested. Enumeration pays for its own output.
  return new Proxy(rows,{
    ownKeys(){return [...Array.from({length:source.length},(_,index)=>String(index)),'length']},
    getOwnPropertyDescriptor(target,key){
      if(typeof key==='string' && /^(0|[1-9]\d*)$/.test(key) && Number(key)<source.length)
        return {enumerable:true,configurable:true,get:()=>target[key]}
      return Reflect.getOwnPropertyDescriptor(target,key)
    }
  })
}

// Internal record reads detach only the requested keys. The store keeps source
// versions immutable; writes/deletes here are private overlays on that version.
function lazyRecord(source) {
  const target = {}, removed = new Set()
  const owns = key => Object.hasOwn(target,key)
  function read(key,receiver) {
    if (owns(key)) return Reflect.get(target,key,receiver)
    if (removed.has(key)) return undefined
    if (Object.hasOwn(source,key)) {
      const value = copyJsonTree(source[key])
      Object.defineProperty(target,key,{value,writable:true,enumerable:true,configurable:true})
      return value
    }
    return Reflect.get(target,key,receiver)
  }
  return new Proxy(target,{
    get: (object,key,receiver) => read(key,receiver),
    has: (object,key) => owns(key) || !removed.has(key) && Object.hasOwn(source,key) || Reflect.has(target,key),
    ownKeys() {
      const keys = [...new Set([...Reflect.ownKeys(source).filter(key=>!removed.has(key)),...Reflect.ownKeys(target)])]
      const numeric = key => typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key)<0xffffffff
      return [...keys.filter(numeric).sort((a,b)=>Number(a)-Number(b)),...keys.filter(key=>typeof key==='string' && !numeric(key)),...keys.filter(key=>typeof key==='symbol')]
    },
    getOwnPropertyDescriptor(object,key) {
      if (owns(key)) return Reflect.getOwnPropertyDescriptor(target,key)
      if (removed.has(key) || !Object.hasOwn(source,key)) return undefined
      return {enumerable:true,configurable:true,get(){return read(key,target)}}
    },
    set(object,key,value) { Object.defineProperty(target,key,{value,writable:true,enumerable:true,configurable:true});return true },
    deleteProperty(object,key) { if (!Reflect.deleteProperty(target,key)) return false;removed.add(key);return true },
    defineProperty(object,key,descriptor) { const ok=Reflect.defineProperty(target,key,descriptor);return ok }
  })
}

// Internal display/activity inputs only. Rollback payloads can contain entire
// historical Chats; retain their immutable source version and detach on access.
// Default public reads still materialize ordinary, structuredClone-safe arrays.
export function copyLazyHistoryHeader(source) {
  const timeline=source.timeline, undo=source.rollbackUndo
  const head={...source}
  const records = new Map()
  for (const key of ['regeneratedDshTurns','runtimeInputs']) {
    const value = head[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) { records.set(key,value);head[key]=undefined }
  }
  if(Array.isArray(timeline?.checkpoints))head.timeline={...timeline,checkpoints:[]}
  if(undo && typeof undo==='object') {
    head.rollbackUndo={...undo}
    if(Object.hasOwn(undo,'before'))head.rollbackUndo.before=undefined
    if(Array.isArray(undo.background))head.rollbackUndo.background=[]
    if(Array.isArray(undo.foreground?.nodes))head.rollbackUndo.foreground={...undo.foreground,nodes:[]}
  }
  const result=copyJsonTree(head)
  for (const [key,value] of records) result[key]=lazyRecord(value)
  if(Array.isArray(timeline?.checkpoints))result.timeline.checkpoints=lazyArray(timeline.checkpoints)
  if(Array.isArray(undo?.foreground?.nodes))result.rollbackUndo.foreground.nodes=lazyArray(undo.foreground.nodes)
  if(Array.isArray(undo?.background))result.rollbackUndo.background=lazyArray(undo.background)
  if(undo && Object.hasOwn(undo,'before')) {
    Object.defineProperty(result.rollbackUndo,'before',{
      enumerable:true,configurable:true,
      get(){const value=copyJsonTree(undo.before);Object.defineProperty(this,'before',{value,writable:true,enumerable:true,configurable:true});return value},
      set(value){Object.defineProperty(this,'before',{value,writable:true,enumerable:true,configurable:true})}
    })
  }
  return result
}
