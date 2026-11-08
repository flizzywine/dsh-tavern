function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

// A change is persisted through the JSON state tree, which rejects any value
// its JSON round-trip cannot reproduce. Normalize to the JSON contract here so
// an undefined member, NaN, Date or class instance becomes the value the store
// would read back instead of aborting the whole write transaction.
function jsonValue(value) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    throw new Error('JSON 变更只能包含可序列化值: ' + (error?.message || error), {cause: error})
  }
}

function pathLabel(path) {
  return path.length === 0 ? '<root>' : path.map(String).join('.')
}

function assertPath(path) {
  if (!Array.isArray(path)) throw new Error('JSON mutation path 必须是数组')
  for (const part of path) {
    if (typeof part !== 'string' && (!Number.isSafeInteger(part) || part < 0)) {
      throw new Error('JSON mutation path 包含非法节点: ' + String(part))
    }
  }
}

function diffValue(before, after, path, changes) {
  if (Object.is(before, after)) return
  if (Array.isArray(before) && Array.isArray(after)) {
    const common = Math.min(before.length, after.length)
    for (let index = 0; index < common; index++) diffValue(before[index], after[index], path.concat(index), changes)
    if (after.length > before.length) {
      changes.push({ op: 'splice', path: clone(path), index: before.length, deleteCount: 0, items: clone(after.slice(before.length)) })
    } else if (after.length < before.length) {
      changes.push({ op: 'splice', path: clone(path), index: after.length, deleteCount: before.length - after.length, items: [] })
    }
    return
  }
  if (object(before) && object(after)) {
    const keys = Array.from(new Set(Object.keys(before).concat(Object.keys(after)))).sort()
    for (const key of keys) {
      const inBefore = Object.hasOwn(before, key)
      const inAfter = Object.hasOwn(after, key)
      if (!inAfter) changes.push({ op: 'delete', path: path.concat(key) })
      else if (!inBefore) changes.push({ op: 'set', path: path.concat(key), value: clone(after[key]) })
      else diffValue(before[key], after[key], path.concat(key), changes)
    }
    return
  }
  changes.push({ op: 'set', path: clone(path), value: clone(after) })
}

/** Diff storage-owned trees that have already crossed the JSON normalization boundary. */
export function diffNormalizedJson(before, after) {
  const changes = []
  diffValue(before, after, [], changes)
  return changes
}

/** Create readable path mutations without carrying unchanged JSON subtrees. */
export function diffJson(before, after) {
  return diffNormalizedJson(jsonValue(before), jsonValue(after))
}

function parentAt(root, path) {
  let value = root
  for (let index = 0; index < path.length - 1; index++) {
    const part = path[index]
    if (value === null || typeof value !== 'object') throw new Error('JSON mutation 找不到路径: ' + pathLabel(path.slice(0, index + 1)))
    if (!Object.hasOwn(value, part)) throw new Error('JSON mutation 找不到路径: ' + pathLabel(path.slice(0, index + 1)))
    value = value[part]
  }
  return value
}

function valueAt(root, path) {
  let value = root
  for (let index = 0; index < path.length; index++) {
    const part = path[index]
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) {
      throw new Error('JSON mutation 找不到路径: ' + pathLabel(path.slice(0, index + 1)))
    }
    value = value[part]
  }
  return value
}

function setValue(root, path, value) {
  if (path.length === 0) return clone(value)
  const parent = parentAt(root, path)
  if (parent === null || typeof parent !== 'object') throw new Error('JSON mutation 无法设置路径: ' + pathLabel(path))
  parent[path[path.length - 1]] = clone(value)
  return root
}

function deleteValue(root, path) {
  if (path.length === 0) throw new Error('JSON mutation 不允许删除 root')
  const parent = parentAt(root, path)
  if (parent === null || typeof parent !== 'object') throw new Error('JSON mutation 无法删除路径: ' + pathLabel(path))
  if (!Object.hasOwn(parent, path[path.length - 1])) throw new Error('JSON mutation 找不到待删除路径: ' + pathLabel(path))
  if (Array.isArray(parent)) throw new Error('JSON mutation 必须使用 splice 删除数组元素: ' + pathLabel(path))
  delete parent[path[path.length - 1]]
  return root
}

function spliceValue(root, change) {
  const target = valueAt(root, change.path)
  if (!Array.isArray(target)) throw new Error('JSON mutation splice 目标不是数组: ' + pathLabel(change.path))
  const index = Number(change.index)
  const deleteCount = Number(change.deleteCount)
  if (!Number.isSafeInteger(index) || index < 0 || index > target.length) throw new Error('JSON mutation splice index 非法: ' + String(change.index))
  if (!Number.isSafeInteger(deleteCount) || deleteCount < 0 || index + deleteCount > target.length) throw new Error('JSON mutation splice deleteCount 非法: ' + String(change.deleteCount))
  const items = Array.isArray(change.items) ? clone(change.items) : []
  target.splice(index, deleteCount, ...items)
  return root
}

/** Apply one mutation frame to a cloned JSON value. */
export function applyJsonChanges(input, changes) {
  let result = clone(input)
  if (!Array.isArray(changes)) throw new Error('JSON mutation changes 必须是数组')
  for (const change of changes) {
    if (change === null || typeof change !== 'object') throw new Error('JSON mutation change 不合法')
    assertPath(change.path)
    if (change.op === 'set') result = setValue(result, change.path, change.value)
    else if (change.op === 'delete') result = deleteValue(result, change.path)
    else if (change.op === 'splice') result = spliceValue(result, change)
    else throw new Error('未知 JSON mutation op: ' + String(change.op))
  }
  return result
}

/** Internal immutable update: copy ancestors and changed values, share untouched branches. */
export function applyJsonChangesShared(input, changes) {
  let result = input
  // Reuse only ancestors allocated by this batch, never caller-owned nodes.
  const owned = new WeakSet()
  for (const change of changes) {
    assertPath(change.path)
    if (change.path.includes('__proto__')) throw new Error('Invalid mutation path')
    const visit = (value, depth) => {
      if (depth === change.path.length) {
        if (change.op === 'set') return clone(change.value)
        // A splice changes array membership, not the untouched elements. Keep
        // internal immutable rows shared and detach only newly supplied items.
        if (change.op === 'splice' && Array.isArray(value)) {
          const target = owned.has(value) ? value : value.slice()
          owned.add(target)
          return spliceValue(target, { ...change, path: [] })
        }
        return applyJsonChanges(value, [{...change,path:[]}])
      }
      if (!value || typeof value !== 'object') throw new Error('Missing mutation parent')
      const key=change.path[depth]
      const next=owned.has(value)?value:(Array.isArray(value)?value.slice():{...value})
      owned.add(next)
      if(depth===change.path.length-1) {
        if(change.op==='delete') {
          if(Array.isArray(value)||!Object.hasOwn(value,key))throw new Error('Invalid delete')
          delete next[key]
        } else Object.defineProperty(next,key,{value:visit(value[key],depth+1),enumerable:true,writable:true,configurable:true})
      } else {
        if(!Object.hasOwn(value,key))throw new Error('Missing mutation parent')
        Object.defineProperty(next,key,{value:visit(value[key],depth+1),enumerable:true,writable:true,configurable:true})
      }
      return next
    }
    result=visit(result,0)
  }
  return result
}
