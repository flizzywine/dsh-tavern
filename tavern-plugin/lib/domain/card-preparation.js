import { inspectCardExtensions } from './card-extension-reading.js'

const TEXT_FIELDS = Object.freeze([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'system_prompt', 'post_history_instructions', 'creator_notes'
])

const CARD_FIELDS = new Set(TEXT_FIELDS.concat(['tags', 'alternate_greetings', 'character_book']))
const WORKSPACE_KIND = 'dsh-tavern-character-workspace'
const WORKSPACE_VERSION = 1

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isWorkspace(value) {
  return object(value) && value.kind === WORKSPACE_KIND && value.version === WORKSPACE_VERSION && object(value.raw)
}

function rawData(raw) {
  if (!object(raw)) throw new Error('人物卡格式错误')
  if ((raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3') && object(raw.data)) return raw.data
  return raw
}

function makeWorkspace(raw, meta = {}) {
  if (!object(raw)) throw new Error('人物卡格式错误')
  return {
    kind: WORKSPACE_KIND,
    version: WORKSPACE_VERSION,
    raw: clone(raw),
    meta: object(meta) ? clone(meta) : {}
  }
}

function rawOf(value) {
  return isWorkspace(value) ? value.raw : value
}

function normalizedList(value, limit) {
  const result = []
  for (const item of Array.isArray(value) ? value : []) {
    const text = str(item).trim()
    if (text !== '' && !result.includes(text)) result.push(text)
    if (result.length >= limit) break
  }
  return result
}

function worldBookOf(card) {
  const book = card !== null && typeof card === 'object' ? card.character_book : null
  if (book === null || typeof book !== 'object') return null
  return book
}

function worldBookEntries(book) {
  return book !== null && typeof book === 'object' && Array.isArray(book.entries) ? book.entries : []
}

function entryContentText(entry) {
  if (entry === null || typeof entry !== 'object') return ''
  if (Array.isArray(entry.content)) {
    return entry.content.map(function (item) { return item !== null && typeof item === 'object' ? str(item.content) : str(item) }).filter(Boolean).join('\n')
  }
  return str(entry.content)
}

function worldBookRef(value, total) {
  const match = /^entry:(\d+)$/.exec(str(value).trim())
  const index = match === null ? -1 : Number(match[1])
  if (!Number.isInteger(index) || index < 0 || index >= total) throw new Error('世界书条目不存在: ' + str(value))
  return index
}

function worldBookOverview(card) {
  const book = worldBookOf(card)
  if (book === null) return null
  const entries = worldBookEntries(book).map(function (entry, index) { return { entry, index } }).filter(function (item) {
    const entry = item.entry
    return entry !== null && typeof entry === 'object' && entry.enabled !== false
  })
  return {
    name: str(book.name),
    entryCount: entries.length,
    entries: entries.map(function (item) {
      const entry = item.entry
      const source = entry !== null && typeof entry === 'object' ? entry : {}
      return {
        ref: 'entry:' + item.index,
        keys: normalizedList(source.keys, 30),
        comment: str(source.comment || source.name).trim(),
        enabled: source.enabled !== false,
        constant: source.constant === true,
        chars: entryContentText(source).length
      }
    })
  }
}

function worldBookWindow(card, request) {
  const book = worldBookOf(card)
  if (book === null) return null
  const entries = worldBookEntries(book)
  const activeEntries = entries.map(function (entry, index) { return { entry, index } }).filter(function (item) {
    const entry = item.entry
    return entry !== null && typeof entry === 'object' && entry.enabled !== false
  })
  const query = str(request.query).trim().toLowerCase()
  const ref = str(request.ref).trim()
  const rawLimit = Number(request.limit)
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 10 ? rawLimit : 3
  let selected = []
  if (ref !== '') {
    const index = worldBookRef(ref, entries.length)
    selected = activeEntries.filter(function (item) { return item.index === index })
  } else if (query !== '') {
    for (const item of activeEntries) {
      if (selected.length >= limit) break
      const entry = item.entry
      const haystack = [str(entry.comment), str(entry.name), normalizedList(entry.keys, 30).join(' '), entryContentText(entry)].join('\n').toLowerCase()
      if (haystack.includes(query)) selected.push(item)
    }
  } else {
    const rawOffset = Number(request.offset)
    const start = Number.isInteger(rawOffset) && rawOffset >= 1 ? Math.min(activeEntries.length, rawOffset - 1) : 0
    selected = activeEntries.slice(start, start + limit)
  }
  return {
    name: str(book.name),
    total: activeEntries.length,
    ref,
    query,
    entries: selected.map(function (item) { return { ref: 'entry:' + item.index, entry: clone(item.entry) } })
  }
}

function applyWorldBookOperations(card, value) {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return false
  const operations = Array.isArray(value) ? value : [value]
  if (operations.length > 20) throw new Error('单次世界书修改不能超过 20 项')
  const current = worldBookOf(card)
  const book = current === null ? { name: '', entries: [] } : clone(current)
  book.entries = worldBookEntries(book).map(clone)
  const original = JSON.stringify(book)
  const additions = []
  const deletions = new Set()
  for (const operation of operations) {
    if (operation === null || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('世界书修改必须是操作对象或操作数组')
    const op = str(operation.op).trim()
    if (op === 'rename') {
      book.name = str(operation.name)
      continue
    }
    if (op === 'add') {
      if (operation.entry === null || typeof operation.entry !== 'object' || Array.isArray(operation.entry)) throw new Error('世界书 add 操作缺少 entry')
      additions.push(clone(operation.entry))
      continue
    }
    if (op === 'update') {
      const index = worldBookRef(operation.ref, book.entries.length)
      if (operation.patch === null || typeof operation.patch !== 'object' || Array.isArray(operation.patch)) throw new Error('世界书 update 操作缺少 patch')
      const patch = clone(operation.patch)
      if (Object.prototype.hasOwnProperty.call(patch, 'keys') && !Array.isArray(patch.keys)) throw new Error('世界书条目 keys 必须是数组')
      book.entries[index] = Object.assign({}, book.entries[index] !== null && typeof book.entries[index] === 'object' ? book.entries[index] : {}, patch)
      continue
    }
    if (op === 'delete') {
      deletions.add(worldBookRef(operation.ref, book.entries.length))
      continue
    }
    throw new Error('未知世界书操作: ' + op)
  }
  for (const index of Array.from(deletions).sort(function (a, b) { return b - a })) book.entries.splice(index, 1)
  book.entries.push.apply(book.entries, additions)
  if (JSON.stringify(book) === original) return false
  card.character_book = book
  return true
}

function importedObject(payload) {
  if (payload !== null && typeof payload === 'object' && payload.kind === 'png') {
    const text = Buffer.from(str(payload.b64), 'base64').toString('utf8')
    try { return JSON.parse(text) } catch (error) { throw new Error('人物卡 JSON 解析失败: ' + str(error && error.message || error)) }
  }
  if (payload !== null && typeof payload === 'object' && typeof payload.text === 'string') {
    try { return JSON.parse(payload.text) } catch (error) { throw new Error('人物卡 JSON 解析失败: ' + str(error && error.message || error)) }
  }
  if (payload !== null && typeof payload === 'object') return payload
  throw new Error('无法识别的人物卡导入数据')
}

function projectedCard(value) {
  const raw = rawOf(value)
  if (!object(raw)) throw new Error('人物卡格式错误')
  const data = rawData(raw)
  const book = object(data.character_book)
    ? data.character_book
    : (object(raw.character_book) ? raw.character_book : null)
  return {
    name: str(data.name).trim() || '未命名角色',
    description: str(data.description),
    personality: str(data.personality),
    scenario: str(data.scenario),
    first_mes: str(data.first_mes),
    mes_example: str(data.mes_example),
    system_prompt: str(data.system_prompt),
    post_history_instructions: str(data.post_history_instructions),
    alternate_greetings: normalizedList(data.alternate_greetings, 1000),
    creator_notes: str(data.creator_notes),
    tags: normalizedList(data.tags, 1000),
    character_book: clone(book),
    spec: str(raw.spec),
    spec_version: str(raw.spec_version)
  }
}

function legacyRaw(working) {
  const source = object(working) ? clone(working) : {}
  for (const field of ['id', 'path', 'importedAt', 'updatedAt', 'revision_history']) delete source[field]
  if ((source.spec === 'chara_card_v2' || source.spec === 'chara_card_v3') && !object(source.data)) {
    const data = {}
    for (const field of CARD_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(source, field)) data[field] = clone(source[field])
      delete source[field]
    }
    source.data = data
  }
  return source
}

function mergeLegacyFields(raw, working) {
  const result = clone(raw)
  const data = rawData(result)
  const baseline = projectedCard(raw)
  baseline.tags = normalizedList(rawData(raw).tags, 30)
  baseline.alternate_greetings = normalizedList(rawData(raw).alternate_greetings, 20)
  for (const field of CARD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(working, field) && JSON.stringify(working[field]) !== JSON.stringify(baseline[field])) data[field] = clone(working[field])
  }
  return result
}

function pointerParts(pointer) {
  const value = str(pointer)
  if (value === '') return []
  if (!value.startsWith('/')) throw new Error('raw 路径必须是 JSON Pointer')
  return value.slice(1).split('/').map(function (part) {
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (decoded === '__proto__' || decoded === 'prototype' || decoded === 'constructor') throw new Error('raw 路径包含不安全字段')
    return decoded
  })
}

function rawAt(raw, pointer) {
  let current = raw
  for (const part of pointerParts(pointer)) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part) || Number(part) >= current.length) throw new Error('raw 路径不存在: ' + pointer)
      current = current[Number(part)]
    } else if (object(current) && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part]
    } else throw new Error('raw 路径不存在: ' + pointer)
  }
  return current
}

function applyRawOperations(raw, operations) {
  if (operations === undefined || operations === null || (Array.isArray(operations) && operations.length === 0)) return []
  if (!Array.isArray(operations)) throw new Error('raw 修改必须是操作数组')
  if (operations.length > 20) throw new Error('单次 raw 修改不能超过 20 项')
  const changed = []
  for (const operation of operations) {
    if (!object(operation) || (operation.op !== 'set' && operation.op !== 'delete')) throw new Error('raw 修改操作不合法')
    if (operation.op === 'set' && !Object.prototype.hasOwnProperty.call(operation, 'value')) throw new Error('raw set 操作缺少 value')
    const pointer = str(operation.path)
    const parts = pointerParts(pointer)
    if (parts.length === 0) throw new Error('不能整体替换或删除人物卡 raw')
    const root = parts[0] === 'data' ? parts[1] : parts[0]
    if (root === 'character_book' || root === 'world_book') {
      throw new Error('世界书只能通过 tavern_update_worldbook 修改: ' + pointer)
    }
    let parent = raw
    for (const part of parts.slice(0, -1)) {
      if (Array.isArray(parent)) {
        if (!/^\d+$/.test(part) || Number(part) >= parent.length) throw new Error('raw 路径不存在: ' + pointer)
        parent = parent[Number(part)]
      } else if (object(parent)) {
        if (!Object.prototype.hasOwnProperty.call(parent, part)) {
          if (operation.op === 'delete') { parent = undefined; break }
          parent[part] = {}
        }
        parent = parent[part]
      } else throw new Error('raw 路径不能继续展开: ' + pointer)
    }
    if (parent === undefined) continue
    const key = parts.at(-1)
    if (Array.isArray(parent)) {
      if (operation.op === 'set') {
        if (key === '-') { parent.push(clone(operation.value)); changed.push(pointer); continue }
        if (!/^\d+$/.test(key) || Number(key) > parent.length) throw new Error('raw 数组位置不存在: ' + pointer)
        const index = Number(key)
        if (JSON.stringify(parent[index]) !== JSON.stringify(operation.value)) { parent[index] = clone(operation.value); changed.push(pointer) }
      } else if (/^\d+$/.test(key) && Number(key) < parent.length) {
        parent.splice(Number(key), 1)
        changed.push(pointer)
      }
    } else if (object(parent)) {
      if (operation.op === 'set') {
        if (JSON.stringify(parent[key]) !== JSON.stringify(operation.value)) { parent[key] = clone(operation.value); changed.push(pointer) }
      } else if (Object.prototype.hasOwnProperty.call(parent, key)) {
        delete parent[key]
        changed.push(pointer)
      }
    } else throw new Error('raw 路径父级不是对象或数组: ' + pointer)
  }
  if (!object(raw)) throw new Error('raw 修改后人物卡根节点必须是对象')
  rawData(raw)
  return changed
}

export function createCardPreparation(options = {}) {
  const nextId = typeof options.id === 'function' ? options.id : function () { return 'card-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }
  const now = typeof options.now === 'function' ? options.now : Date.now

  function project(value) {
    return projectedCard(value)
  }

  function create(request) {
    if (request === null || typeof request !== 'object') throw new Error('缺少人物卡准备请求')
    if (request.kind === 'import') {
      return makeWorkspace(importedObject(request.payload), { id: nextId(), importedAt: now(), revisionHistory: [] })
    }
    if (request.kind === 'draft') {
      const draft = request.draft !== null && typeof request.draft === 'object' ? request.draft : {}
      if (str(draft.name).trim() === '') throw new Error('新人物卡还没有角色名，请先在对话中确认')
      const player = str(request.player).trim()
      if (player === '' && request.allowMissingPlayer !== true) throw new Error('玩家身份还没有确认，无法保存人物卡')
      if (/^你是/.test(str(draft.system_prompt).trim())) throw new Error('人物卡使用第二人称描述角色，与玩家身份冲突')
      const data = {}
      for (const field of TEXT_FIELDS) data[field] = str(draft[field])
      data.name = str(draft.name).trim()
      data.tags = normalizedList(draft.tags, 30)
      data.alternate_greetings = normalizedList(draft.alternate_greetings, 20)
      if (object(draft.character_book)) data.character_book = clone(draft.character_book)
      const notes = str(data.creator_notes).trim()
      const provenance = '[卡片工作台] ' + (Array.isArray(request.sourcePaths) ? request.sourcePaths.join(',') : (Array.isArray(request.sourceIds) ? request.sourceIds.join(',') : '')) + '\n[玩家] ' + (player || '未确认（旧会话）')
      data.creator_notes = notes === '' ? provenance : notes + '\n' + provenance
      return makeWorkspace({ spec: 'chara_card_v3', spec_version: '3.0', data }, { id: nextId(), importedAt: now(), revisionHistory: [] })
    }
    throw new Error('未知人物卡准备类型: ' + str(request.kind))
  }

  function migrate(request) {
    if (!object(request) || !object(request.working)) throw new Error('缺少旧人物卡工作版')
    if (isWorkspace(request.working)) return clone(request.working)
    let original
    try { original = request.payload === undefined || request.payload === null ? legacyRaw(request.working) : importedObject(request.payload) } catch { original = legacyRaw(request.working) }
    const meta = {
      id: str(request.working.id) || nextId(),
      importedAt: Number(request.working.importedAt) || now(),
      ...(Number(request.working.updatedAt) > 0 ? { updatedAt: Number(request.working.updatedAt) } : {}),
      revisionHistory: Array.isArray(request.working.revision_history) ? clone(request.working.revision_history) : []
    }
    return makeWorkspace(mergeLegacyFields(original, request.working), meta)
  }

  function update(request) {
    if (request === null || typeof request !== 'object') throw new Error('缺少人物卡修改请求')
    if (request.kind !== 'card' && request.kind !== 'draft') throw new Error('未知人物卡修改类型: ' + str(request.kind))
    const patch = request.patch !== null && typeof request.patch === 'object' && !Array.isArray(request.patch) ? request.patch : {}
    const allowed = request.kind === 'draft' ? new Set(Array.from(CARD_FIELDS).concat(['player'])) : CARD_FIELDS
    for (const field of Object.keys(patch)) {
      if (!allowed.has(field)) throw new Error('未知人物卡字段: ' + field)
    }
    if (request.kind === 'draft') {
      const card = clone(object(request.card) ? request.card : {})
      const changedFields = []
      for (const field of TEXT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(patch, field)) continue
        const value = str(patch[field])
        if (value.trim() === '') continue
        if (card[field] !== value) { card[field] = value; changedFields.push(field) }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
        if (!Array.isArray(patch.tags)) throw new Error('人物卡字段 tags 必须是数组')
        const value = normalizedList(patch.tags, 30)
        if (JSON.stringify(card.tags || []) !== JSON.stringify(value)) { card.tags = value; changedFields.push('tags') }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'alternate_greetings')) {
        if (!Array.isArray(patch.alternate_greetings)) throw new Error('人物卡字段 alternate_greetings 必须是数组')
        const value = normalizedList(patch.alternate_greetings, 20)
        if (JSON.stringify(card.alternate_greetings || []) !== JSON.stringify(value)) { card.alternate_greetings = value; changedFields.push('alternate_greetings') }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'character_book')) {
        if (patch.character_book !== null && !object(patch.character_book)) throw new Error('人物卡字段 character_book 必须是对象或 null')
        const value = clone(patch.character_book)
        if (JSON.stringify(card.character_book || null) !== JSON.stringify(value)) { card.character_book = value; changedFields.push('character_book') }
      }
      card.name = str(card.name).trim()
      let player = str(request.player).trim()
      if (typeof patch.player === 'string' && patch.player.trim() !== '') player = patch.player.trim()
      return { card, player, changedFields, changed: changedFields.length > 0 || player !== str(request.player).trim() }
    }
    const workspace = isWorkspace(request.card)
      ? clone(request.card)
      : migrate({ working: object(request.card) ? request.card : {}, payload: null })
    const viewBefore = project(workspace)
    const changedFields = applyRawOperations(workspace.raw, request.rawOperations).map(function (pointer) { return 'raw:' + pointer })
    const data = rawData(workspace.raw)
    for (const field of TEXT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue
      const value = str(patch[field])
      if (viewBefore[field] !== value) {
        data[field] = value
        changedFields.push(field)
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
      if (!Array.isArray(patch.tags)) throw new Error('人物卡字段 tags 必须是数组')
      const value = normalizedList(patch.tags, 1000)
      if (JSON.stringify(viewBefore.tags || []) !== JSON.stringify(value)) { data.tags = value; changedFields.push('tags') }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'alternate_greetings')) {
      if (!Array.isArray(patch.alternate_greetings)) throw new Error('人物卡字段 alternate_greetings 必须是数组')
      const value = normalizedList(patch.alternate_greetings, 1000)
      if (JSON.stringify(viewBefore.alternate_greetings || []) !== JSON.stringify(value)) { data.alternate_greetings = value; changedFields.push('alternate_greetings') }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'character_book')) {
      if (patch.character_book !== null && typeof patch.character_book !== 'object') throw new Error('人物卡字段 character_book 必须是对象或 null')
      const value = clone(patch.character_book)
      if (JSON.stringify(viewBefore.character_book || null) !== JSON.stringify(value)) { data.character_book = value; changedFields.push('character_book') }
    }
    if (applyWorldBookOperations(data, request.worldBookOperations) && !changedFields.includes('character_book')) changedFields.push('character_book')
    data.name = str(data.name).trim() || '未命名角色'
    if (changedFields.length > 0) {
      workspace.meta.updatedAt = now()
      if (request.revision !== undefined && request.revision !== null) {
        workspace.meta.revisionHistory = Array.isArray(workspace.meta.revisionHistory) ? workspace.meta.revisionHistory : []
        workspace.meta.revisionHistory.push(clone(request.revision))
        workspace.meta.revisionHistory = workspace.meta.revisionHistory.slice(-30)
      }
    }
    return { card: workspace, view: project(workspace), player: str(request.player).trim(), changedFields, changed: changedFields.length > 0 }
  }

  function present(request) {
    if (request === null || typeof request !== 'object' || request.card === null || typeof request.card !== 'object') throw new Error('缺少人物卡')
    if (request.as === 'raw-section') {
      const pointer = str(request.pointer)
      const value = rawAt(rawOf(request.card), pointer)
      const serialized = JSON.stringify(value, null, 2)
      const text = serialized === undefined ? 'null' : serialized
      const offset = Number.isInteger(request.offset) && request.offset > 0 ? request.offset : 1
      const limit = Number.isInteger(request.limit) ? Math.max(1, Math.min(request.limit, 12000)) : 6000
      const start = Math.min(offset - 1, text.length)
      const chunk = text.slice(start, start + limit)
      return {
        pointer,
        text: chunk,
        totalChars: text.length,
        from: chunk.length > 0 ? start + 1 : 0,
        to: chunk.length > 0 ? start + chunk.length : 0,
        done: start + chunk.length >= text.length
      }
    }
    const card = project(request.card)
    if (request.as === 'world-book-overview') return worldBookOverview(card)
    if (request.as === 'world-book-window') return worldBookWindow(card, request)
    if (request.as === 'card-extensions') return inspectCardExtensions(request.card)
    const editable = {}
    for (const field of TEXT_FIELDS) editable[field] = card[field] || ''
    editable.tags = clone(card.tags || [])
    editable.alternate_greetings = clone(card.alternate_greetings || [])
    editable.character_book = clone(card.character_book || null)
    if (request.as === 'editable') return editable
    if (request.as === 'view') return Object.assign({ id: card.id }, editable)
    if (request.as === 'detail') {
      return Object.assign({ id: card.id }, editable, { extensions: inspectCardExtensions(request.card) })
    }
    if (request.as === 'raw' || request.as === 'sillytavern-v3') return clone(rawOf(request.card))
    throw new Error('未知人物卡展示类型: ' + str(request.as))
  }

  return Object.freeze({
    create,
    isWorkspace,
    migrate,
    project,
    update,
    present,
    textFields: TEXT_FIELDS
  })
}
