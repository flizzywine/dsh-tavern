import { inspectPreset } from './preset-reading.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function pointerParts(pointer) {
  const value = str(pointer)
  if (value === '') return []
  if (!value.startsWith('/')) throw new Error('预设路径必须是 JSON Pointer')
  return value.slice(1).split('/').map(function (part) { return part.replace(/~1/g, '/').replace(/~0/g, '~') })
}

function valueAt(document, pointer) {
  let current = document
  for (const part of pointerParts(pointer)) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part) || Number(part) >= current.length) throw new Error('预设路径不存在: ' + pointer)
      current = current[Number(part)]
    } else if (current !== null && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part]
    } else throw new Error('预设路径不存在: ' + pointer)
  }
  return current
}

function applyOperations(document, operations) {
  const changed = []
  for (const operation of Array.isArray(operations) ? operations : []) {
    const pointer = str(operation && operation.path)
    const parts = pointerParts(pointer)
    if (parts.length === 0) throw new Error('不能通过预设编辑工具修改或删除根节点')
    const key = parts.pop()
    let parent = document
    for (const part of parts) {
      if (Array.isArray(parent)) {
        if (!/^\d+$/.test(part) || Number(part) >= parent.length) throw new Error('预设路径不存在: ' + pointer)
        parent = parent[Number(part)]
      } else if (parent !== null && typeof parent === 'object' && Object.prototype.hasOwnProperty.call(parent, part)) {
        parent = parent[part]
      } else throw new Error('预设路径不存在: ' + pointer)
    }
    if (Array.isArray(parent)) {
      if (operation.op === 'set' && key === '-') {
        parent.push(clone(operation.value)); changed.push(pointer); continue
      }
      if (!/^\d+$/.test(key) || Number(key) >= parent.length) throw new Error('预设路径不存在: ' + pointer)
      const index = Number(key)
      if (operation.op === 'delete') { parent.splice(index, 1); changed.push(pointer); continue }
      if (operation.op !== 'set') throw new Error('未知预设修改操作: ' + str(operation.op))
      if (JSON.stringify(parent[index]) !== JSON.stringify(operation.value)) { parent[index] = clone(operation.value); changed.push(pointer) }
      continue
    }
    if (parent === null || typeof parent !== 'object') throw new Error('预设路径父级不是对象或数组: ' + pointer)
    if (operation.op === 'delete') {
      if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error('预设路径不存在: ' + pointer)
      delete parent[key]; changed.push(pointer); continue
    }
    if (operation.op !== 'set') throw new Error('未知预设修改操作: ' + str(operation.op))
    if (JSON.stringify(parent[key]) !== JSON.stringify(operation.value)) { parent[key] = clone(operation.value); changed.push(pointer) }
  }
  return changed
}

export function createPresetEditor(options = {}) {
  const normalizePath = options.normalizePath
  const readText = options.readText
  const writeText = options.writeText
  if (typeof normalizePath !== 'function' || typeof readText !== 'function' || typeof writeText !== 'function') {
    throw new Error('Preset Editor 缺少路径或存储 adapter')
  }

  async function load(path) {
    const normalized = normalizePath(path, 'preset')
    const text = await readText(normalized)
    if (text === undefined) throw new Error('预设不存在: ' + normalized)
    let document
    try { document = JSON.parse(text) } catch { throw new Error('预设工作版不是有效的 JSON: ' + normalized) }
    return { normalized, document }
  }

  async function read(path, request = {}) {
    const loaded = await load(path)
    const pointer = str(request.pointer)
    const text = JSON.stringify(valueAt(loaded.document, pointer), null, 2)
    const totalChars = text.length
    const from = Math.max(1, Number(request.offset) || 1)
    const limit = Math.min(12000, Math.max(1, Number(request.limit) || 6000))
    const sliced = text.slice(from - 1, from - 1 + limit)
    return { path: loaded.normalized, pointer, text: sliced, totalChars, from: totalChars === 0 ? 0 : from, to: totalChars === 0 ? 0 : Math.min(totalChars, from + sliced.length - 1), done: from - 1 + sliced.length >= totalChars }
  }

  async function update(path, operations) {
    const loaded = await load(path)
    const next = clone(loaded.document)
    const changed = applyOperations(next, operations)
    const text = JSON.stringify(next, null, 2)
    const inspected = inspectPreset(text, loaded.normalized)
    if (!inspected.valid) throw new Error(inspected.error || '修改后的预设无效')
    if (changed.length > 0) await writeText(loaded.normalized, text)
    return {
      path: loaded.normalized,
      changed,
      valid: inspected.valid,
      recognized: inspected.recognized,
      promptCount: inspected.promptCount,
      regexCount: inspected.regexCount,
      warning: inspected.warning
    }
  }

  return Object.freeze({ read, update })
}
