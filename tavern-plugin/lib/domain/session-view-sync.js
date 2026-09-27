import { createHash, randomUUID } from 'node:crypto'
import { createIndexedArrayApi } from './indexed-array.js'
import { createImmutableTurnFields, immutableTurnFieldChanges, isImmutableJson, immutableArrayChanges, isImmutableOrderedArray, immutableOrderedChanges } from './freeze-json.js'

// Reader cursors retain fingerprints only; never retain another full chat snapshot.
export function createSessionViewSync({ maxReaders = 32 } = {}) {
  const readers = new Map()
  const fieldHashes = createImmutableTurnFields()
  const messageHashes = createIndexedArrayApi()
  const immutableHashes = new WeakMap()
  function hashValue(value) {
    if (isImmutableJson(value) && immutableHashes.has(value)) return immutableHashes.get(value)
    const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex')
    if (isImmutableJson(value)) immutableHashes.set(value,hash)
    return hash
  }
  function parts(view, keyedReceipts) {
    const result = new Map()
    function add(path, value) {
      if (value === undefined) return
      const key = JSON.stringify(path)
      result.set(key, { path, value, hash: hashValue(value) })
    }
    for (const [key, value] of Object.entries(view || {})) {
      if(keyedReceipts && key==='mvuReceipts')continue
      if (['replyProjections','mvuReceipts'].includes(key) && Array.isArray(value)) {
        add([key, 'length'], value.length)
        // Row hashes are retained separately, like Helper messages.
      } else if (['inputSources', 'inputTemplateDisplays', 'regeneratedDshTurns'].includes(key) && value && typeof value === 'object') {
        add([key], {})
      } else if (key === 'tavernHelper' && value && typeof value === 'object') {
        add([key], {})
        for (const [field, item] of Object.entries(value)) {
          if (key === 'tavernHelper' && field === 'messages' && Array.isArray(item)) {
            add([key, field, 'length'], item.length)
            // Per-floor hashes live in a persistent index, outside the small header map.
            // A trusted dirty set covers edits; append/truncation are explicit.
          } else add([key, field], item)
        }
      } else add([key], value)
    }
    return result
  }
  function synchronize(sessionId, view, cursor, options = {}) {
    if (view === null) return { view: null, viewCursor: null }
    const previous = readers.get(cursor)
    const dirtyMessageIndices = options.dirtyMessageIndices instanceof Set ? options.dirtyMessageIndices : null
    let base = previous?.sessionId === sessionId ? previous : null
    const keyedReceipts=options.receiptSync===1 && isImmutableOrderedArray(view?.mvuReceipts)
    const keyedChanges=keyedReceipts && base?.receiptSync ? immutableOrderedChanges(base.receiptSource?.deref(),view.mvuReceipts) : null
    if(Boolean(base?.receiptSync)!==keyedReceipts || keyedReceipts && base && !keyedChanges)base=null
    const current = parts(view,keyedReceipts)
    const inputFields = new Map(), inputSet = [], inputRemove = []
    for (const field of ['inputSources','inputTemplateDisplays','regeneratedDshTurns']) {
      const value=view[field], old=base?.inputFields?.get(field)
      if(isImmutableJson(value) && old?.source?.deref()===value){inputFields.set(field,old);continue}
      const changed=old && immutableTurnFieldChanges(old.source?.deref(),value)
      if(changed){
        const sets=[],removes=[]
        for(const entry of changed){
          if(entry.after===undefined){removes.push(entry.key);if(Object.hasOwn(old.hashes,entry.key))inputRemove.push([field,entry.key])}
          else {const hash=hashValue(entry.after);sets.push([entry.key,hash]);if(old.hashes[entry.key]!==hash)inputSet.push([[field,entry.key],entry.after])}
        }
        inputFields.set(field,{hashes:fieldHashes.update(old.hashes,sets,removes),source:new WeakRef(value)})
        continue
      }
      const hashes=Object.create(null)
      if(value && typeof value==='object')for(const [key,item] of Object.entries(value)){
        if(item===undefined)continue
        const hash=hashValue(item);hashes[key]=hash
        if(old?.hashes[key]!==hash)inputSet.push([[field,key],item])
      }
      if(old)for(const key of Object.keys(old.hashes))if(!Object.hasOwn(hashes,key))inputRemove.push([field,key])
      inputFields.set(field,{hashes:fieldHashes.from(hashes),source:isImmutableJson(value)?new WeakRef(value):undefined})
    }
    const messages = view?.tavernHelper?.messages, replies = view?.replyProjections
    const receipts=view?.mvuReceipts
    const receiptChanges=keyedReceipts ? null : immutableArrayChanges(base?.receiptSource?.deref(),receipts)
    const replyChanges = immutableArrayChanges(base?.replySource?.deref(),replies)
    const sameReplies = isImmutableJson(replies) && base?.replySource?.deref() === replies
    const arrays = [
      {path:['tavernHelper','messages'],value:messages,previous:base?.messageHashes,dirty:dirtyMessageIndices},
      {path:['replyProjections'],value:replies,previous:base?.replyHashes,dirty:replyChanges ? new Set(replyChanges) : sameReplies ? new Set() : null},
      ...keyedReceipts ? [] : [{path:['mvuReceipts'],value:receipts,previous:base?.receiptHashes,dirty:receiptChanges ? new Set(receiptChanges) : null}]
    ]
    const messageSet = [], messageRemove = []
    for (const field of arrays) {
      if (Array.isArray(field.value)) {
        const canReuse = field.previous && field.dirty
        const indices = canReuse ? new Set(field.dirty) : new Set(field.value.keys())
        if (canReuse) for (let i=field.previous.length;i<field.value.length;i++) indices.add(i)
        const updates=[]
        for (const index of indices) {
          if (!Number.isSafeInteger(index) || index<0 || index>=field.value.length) continue
          const value=field.value[index],hash=hashValue(value)
          updates.push([index,hash])
          if (!field.previous || field.previous[index]!==hash) messageSet.push([[...field.path,index],value])
        }
        field.next=messageHashes.update(canReuse ? field.previous : [],updates,field.value.length)
      }
      if (field.previous) {
        const length=Array.isArray(field.value) ? field.value.length : 0
        for(let i=length;i<field.previous.length;i++) messageRemove.push([...field.path,i])
      }
    }
    const nextCursor = randomUUID()
    const hashes = new Map()
    for (const [key, item] of current) hashes.set(key, item.hash)
    readers.set(nextCursor, {
      sessionId,
      hashes,
      inputFields,
      messageHashes: arrays[0].next,
      replyHashes: arrays[1].next,
      receiptHashes: arrays[2]?.next,
      receiptSync: keyedReceipts,
      receiptSource: isImmutableJson(receipts) ? new WeakRef(receipts) : undefined,
      replySource: isImmutableJson(replies) ? new WeakRef(replies) : undefined,
      revision: Number.isSafeInteger(options.revision) ? options.revision : previous?.revision
    })
    while (readers.size > maxReaders) readers.delete(readers.keys().next().value)
    if (!base) return { view, viewCursor: nextCursor, ...(keyedReceipts ? {receiptSync:1} : {}) }
    const set = [], remove = [...messageRemove,...inputRemove]
    for (const [key, item] of current) {
      if (previous.hashes.get(key) === item.hash) continue
      set.push([item.path, item.value])
    }
    for (const key of previous.hashes.keys()) if (!current.has(key)) remove.push(JSON.parse(key))
    for (const entry of inputSet) set.push(entry)
    for (const entry of messageSet) set.push(entry)
    return { viewCursor: nextCursor, viewDelta: { baseCursor: cursor, set, remove, ...(keyedReceipts ? {receiptDelta:{set:keyedChanges.filter(row=>row.after!==undefined).map(row=>row.after),remove:keyedChanges.filter(row=>row.after===undefined).map(row=>row.key)}} : {}) } }
  }
  synchronize.peek = function peek(cursor) {
    return readers.get(cursor) || null
  }
  return synchronize
}
