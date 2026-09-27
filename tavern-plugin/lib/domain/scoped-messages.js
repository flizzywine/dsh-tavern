// Internal transaction facade. Array algorithms and JSON projections can read
// it, but structuredClone must never receive it. Construction and point writes
// allocate only owned rows, not an array backing store proportional to history.
export function createScopedMessages(length, entries = [], readBase) {
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) throw new Error('Invalid message count')
  const owned = new Map()
  for (const [id, row] of entries) {
    if (!Number.isSafeInteger(id) || id < 0 || id >= length) throw new Error('Invalid scoped floor')
    owned.set(String(id), row)
  }
  const index = key => typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length
  return new Proxy([], {
    get(target, key, receiver) {
      if (key === 'length') return length
      if (index(key)) return owned.has(key) ? owned.get(key) : readBase?.(Number(key))
      return Reflect.get(target, key, receiver)
    },
    has(target, key) { return index(key) ? owned.has(key) || Boolean(readBase) : Reflect.has(target, key) },
    set(_target, key, value) {
      if (key === 'length' && value === length) return true
      if (!index(key)) throw new Error('Scoped messages cannot change history membership')
      owned.set(key, value)
      return true
    },
    ownKeys() { return [...owned.keys(), 'length'] },
    getOwnPropertyDescriptor(target, key) {
      if (owned.has(key)) return {value:owned.get(key),enumerable:true,writable:true,configurable:true}
      const descriptor = Reflect.getOwnPropertyDescriptor(target,key)
      return key === 'length' ? {...descriptor,value:length} : descriptor
    },
    deleteProperty() { throw new Error('Scoped messages cannot delete history') }
  })
}
