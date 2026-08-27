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

function entryOperations(inspected, entryKey, patch) {
  const entry = (inspected.entries || []).find(function (item) { return item.entryKey === str(entryKey) })
  if (!entry) throw new Error('预设条目不存在: ' + str(entryKey))
  const input = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const allowed = new Set(['name', 'role', 'content', 'enabled'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error('不支持修改预设字段: ' + key)
  const operations = []
  const promptPath = entry.edit && entry.edit.promptPath
  for (const field of ['name', 'role', 'content']) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue
    if (promptPath === null || promptPath === undefined) throw new Error('该占位条目在 prompts 中没有定义，不能修改' + field)
    if (typeof input[field] !== 'string') throw new Error('预设条目 ' + field + ' 必须是字符串')
    if (field === 'role' && !['system', 'user', 'assistant'].includes(input[field])) throw new Error('预设条目角色必须是 system、user 或 assistant')
    operations.push({ op: 'set', path: promptPath + '/' + field, value: input[field] })
  }
  if (Object.prototype.hasOwnProperty.call(input, 'enabled')) {
    if (typeof input.enabled !== 'boolean') throw new Error('预设条目 enabled 必须是布尔值')
    for (const path of (entry.edit && entry.edit.enabledPaths) || []) operations.push({ op: 'set', path, value: input.enabled })
  }
  return operations
}

export function createPresetEditor(options = {}) {
  const normalizePath = options.normalizePath
  const readText = options.readText
  const writeText = options.writeText
  const inspectRegexScripts = options.inspectRegexScripts
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

  async function updateEntry(path, entryKey, patch) {
    const loaded = await load(path)
    const inspected = inspectPreset(JSON.stringify(loaded.document), loaded.normalized)
    if (!inspected.valid || !inspected.recognized) throw new Error(inspected.error || '预设没有可编辑的 prompts 结构')
    const next = clone(loaded.document)
    const changed = applyOperations(next, entryOperations(inspected, entryKey, patch))
    const text = JSON.stringify(next, null, 2)
    const nextInspected = inspectPreset(text, loaded.normalized)
    if (!nextInspected.valid) throw new Error(nextInspected.error || '修改后的预设无效')
    if (changed.length > 0) await writeText(loaded.normalized, text)
    return {
      path: loaded.normalized,
      changed,
      valid: nextInspected.valid,
      recognized: nextInspected.recognized,
      promptCount: nextInspected.promptCount,
      regexCount: nextInspected.regexCount,
      warning: nextInspected.warning
    }
  }

  async function updateRegex(path, regexKey, patch) {
    if (typeof inspectRegexScripts !== 'function') throw new Error('Preset Editor 缺少正则编辑 adapter')
    const input = typeof patch === 'boolean' ? { enabled: patch } : (patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {})
    const allowed = new Set(['name', 'findRegex', 'replaceString', 'enabled'])
    for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error('不支持修改预设正则字段: ' + key)
    const loaded = await load(path)
    const inspected = inspectPreset(JSON.stringify(loaded.document), loaded.normalized)
    const script = inspectRegexScripts(inspected, loaded.document).find(function (item) { return item.regexKey === str(regexKey) })
    if (!script || !script.edit || !script.edit.disabledPath) throw new Error('预设正则不存在: ' + str(regexKey))
    const operations = []
    for (const field of ['name', 'findRegex', 'replaceString']) {
      if (!Object.prototype.hasOwnProperty.call(input, field)) continue
      if (typeof input[field] !== 'string') throw new Error('预设正则 ' + field + ' 必须是字符串')
      const pathKey = field === 'name' ? 'scriptNamePath' : field + 'Path'
      if (!script.edit[pathKey]) throw new Error('该预设正则不能修改 ' + field)
      operations.push({ op: 'set', path: script.edit[pathKey], value: input[field] })
    }
    if (Object.prototype.hasOwnProperty.call(input, 'enabled')) {
      if (typeof input.enabled !== 'boolean') throw new Error('预设正则 enabled 必须是布尔值')
      operations.push({ op: 'set', path: script.edit.disabledPath, value: !input.enabled })
    }
    return await update(loaded.normalized, operations)
  }

  return Object.freeze({ read, update, updateEntry, updateRegex })
}
