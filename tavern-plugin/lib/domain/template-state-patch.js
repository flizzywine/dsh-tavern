// JSON state equality without allocating a serialized copy of the history.
export function sameTemplateValue(a, b) {
  if (Object.is(a,b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const keys=Object.keys(a)
  if (keys.length !== Object.keys(b).length || (Array.isArray(a) && a.length !== b.length)) return false
  return keys.every(key => Object.prototype.hasOwnProperty.call(b,key) && sameTemplateValue(a[key],b[key]))
}

/** Copy changed paths only; unchanged history remains immutable and shared. */
export function applyTemplateStateChanges(input, changes) {
  let result=input
  for (const change of changes) {
    const path=change.path
    if (!Array.isArray(path) || path.some(key => key === '__proto__' || (typeof key !== 'string' && (!Number.isSafeInteger(key) || key < 0)))) throw new Error('Invalid template patch path')
    const apply = (value, depth) => {
      if (depth === path.length) {
        if (change.op === 'set') return structuredClone(change.value)
        if (change.op === 'splice') {
          if (!Array.isArray(value) || !Number.isSafeInteger(change.index) || !Number.isSafeInteger(change.deleteCount) || change.index<0 || change.deleteCount<0 || change.index+change.deleteCount>value.length || !Array.isArray(change.items)) throw new Error('Invalid template splice')
          const next=value.slice();next.splice(change.index,change.deleteCount,...structuredClone(change.items));return next
        }
        throw new Error('Invalid template patch operation')
      }
      if (!value || typeof value !== 'object') throw new Error('Missing template patch parent')
      const key=path[depth], next=Array.isArray(value)?value.slice():{...value}
      if (depth === path.length-1 && change.op === 'delete') {
        if (Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value,key)) throw new Error('Invalid template delete')
        delete next[key]
      } else {
        if (depth < path.length-1 && !Object.prototype.hasOwnProperty.call(value,key)) throw new Error('Missing template patch parent')
        Object.defineProperty(next,key,{value:apply(value[key],depth+1),writable:true,configurable:true,enumerable:true})
      }
      return next
    }
    result=apply(result,0)
  }
  return result
}
