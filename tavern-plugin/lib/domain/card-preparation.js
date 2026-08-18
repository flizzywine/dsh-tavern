const TEXT_FIELDS = Object.freeze([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'system_prompt', 'post_history_instructions', 'creator_notes'
])

const CARD_FIELDS = new Set(TEXT_FIELDS.concat(['tags', 'alternate_greetings', 'character_book']))

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
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
  const match = /^wb-(\d+)$/.exec(str(value).trim())
  const index = match === null ? -1 : Number(match[1])
  if (!Number.isInteger(index) || index < 0 || index >= total) throw new Error('世界书条目不存在: ' + str(value))
  return index
}

function worldBookOverview(card) {
  const book = worldBookOf(card)
  if (book === null) return null
  const entries = worldBookEntries(book)
  return {
    name: str(book.name),
    entryCount: entries.length,
    entries: entries.map(function (entry, index) {
      const source = entry !== null && typeof entry === 'object' ? entry : {}
      return {
        ref: 'wb-' + index,
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
  const query = str(request.query).trim().toLowerCase()
  const ref = str(request.ref).trim()
  const rawLimit = Number(request.limit)
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 10 ? rawLimit : 3
  let selected = []
  if (ref !== '') {
    const index = worldBookRef(ref, entries.length)
    selected = [{ index, entry: entries[index] }]
  } else if (query !== '') {
    for (let index = 0; index < entries.length && selected.length < limit; index++) {
      const entry = entries[index] !== null && typeof entries[index] === 'object' ? entries[index] : {}
      const haystack = [str(entry.comment), str(entry.name), normalizedList(entry.keys, 30).join(' '), entryContentText(entry)].join('\n').toLowerCase()
      if (haystack.includes(query)) selected.push({ index, entry })
    }
  } else {
    const rawOffset = Number(request.offset)
    const start = Number.isInteger(rawOffset) && rawOffset >= 1 ? Math.min(entries.length, rawOffset - 1) : 0
    selected = entries.slice(start, start + limit).map(function (entry, relative) { return { index: start + relative, entry } })
  }
  return {
    name: str(book.name),
    total: entries.length,
    ref,
    query,
    entries: selected.map(function (item) { return { ref: 'wb-' + item.index, entry: clone(item.entry) } })
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
    if (operation === null || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('worldBookPatch 必须是操作对象或操作数组')
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

export function createCardPreparation(options = {}) {
  const nextId = typeof options.id === 'function' ? options.id : function () { return 'card-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }
  const now = typeof options.now === 'function' ? options.now : Date.now

  function canonical(raw) {
    if (raw === null || typeof raw !== 'object') throw new Error('人物卡格式错误')
    const data = raw.data !== null && typeof raw.data === 'object' ? raw.data : raw
    const book = data.character_book !== null && typeof data.character_book === 'object'
      ? data.character_book
      : (raw.character_book !== null && typeof raw.character_book === 'object' ? raw.character_book : null)
    return {
      id: nextId(),
      name: str(data.name).trim() || '未命名角色',
      description: str(data.description),
      personality: str(data.personality),
      scenario: str(data.scenario),
      first_mes: str(data.first_mes),
      mes_example: str(data.mes_example),
      system_prompt: str(data.system_prompt),
      post_history_instructions: str(data.post_history_instructions),
      alternate_greetings: normalizedList(data.alternate_greetings, 20),
      creator_notes: str(data.creator_notes),
      tags: normalizedList(data.tags, 30),
      character_book: clone(book),
      spec: str(raw.spec),
      spec_version: str(raw.spec_version),
      importedAt: now()
    }
  }

  function create(request) {
    if (request === null || typeof request !== 'object') throw new Error('缺少人物卡准备请求')
    if (request.kind === 'import') return canonical(importedObject(request.payload))
    if (request.kind === 'extract') {
      const draft = request.draft !== null && typeof request.draft === 'object' ? request.draft : {}
      if (str(draft.name).trim() === '') throw new Error('草稿还没有角色名，请先在对话中确认')
      const player = str(request.player).trim()
      if (player === '' && request.allowMissingPlayer !== true) throw new Error('玩家身份还没有确认，无法保存人物卡')
      if (/^你是/.test(str(draft.system_prompt).trim())) throw new Error('人物卡使用第二人称描述角色，与玩家身份冲突')
      const card = canonical(draft)
      const notes = str(card.creator_notes).trim()
      const provenance = '[抽取生成] ' + (Array.isArray(request.sourceIds) ? request.sourceIds.join(',') : '') + '\n[玩家] ' + (player || '未确认（旧会话）')
      card.creator_notes = notes === '' ? provenance : notes + '\n' + provenance
      return card
    }
    throw new Error('未知人物卡准备类型: ' + str(request.kind))
  }

  function update(request) {
    if (request === null || typeof request !== 'object') throw new Error('缺少人物卡修改请求')
    if (request.kind !== 'card' && request.kind !== 'draft') throw new Error('未知人物卡修改类型: ' + str(request.kind))
    const patch = request.patch !== null && typeof request.patch === 'object' && !Array.isArray(request.patch) ? request.patch : {}
    const allowed = request.kind === 'draft' ? new Set(Array.from(CARD_FIELDS).concat(['player'])) : CARD_FIELDS
    for (const field of Object.keys(patch)) {
      if (!allowed.has(field)) throw new Error('未知人物卡字段: ' + field)
    }
    const card = clone(request.card !== null && typeof request.card === 'object' ? request.card : {})
    const changedFields = []
    for (const field of TEXT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue
      const value = str(patch[field])
      if (request.kind === 'draft' && value.trim() === '') continue
      if (card[field] !== value) {
        card[field] = value
        changedFields.push(field)
      }
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
      if (patch.character_book !== null && typeof patch.character_book !== 'object') throw new Error('人物卡字段 character_book 必须是对象或 null')
      const value = clone(patch.character_book)
      if (JSON.stringify(card.character_book || null) !== JSON.stringify(value)) { card.character_book = value; changedFields.push('character_book') }
    }
    if (request.kind === 'card' && applyWorldBookOperations(card, request.worldBookOperations) && !changedFields.includes('character_book')) changedFields.push('character_book')
    card.name = str(card.name).trim() || (request.kind === 'draft' ? '' : '未命名角色')
    let player = str(request.player).trim()
    if (request.kind === 'draft' && typeof patch.player === 'string') {
      const nextPlayer = patch.player.trim()
      if (nextPlayer !== '') player = nextPlayer
    }
    if (changedFields.length > 0) {
      card.updatedAt = now()
      if (request.kind === 'card' && request.revision !== undefined && request.revision !== null) {
        card.revision_history = Array.isArray(card.revision_history) ? card.revision_history : []
        card.revision_history.push(clone(request.revision))
        card.revision_history = card.revision_history.slice(-30)
      }
    }
    return { card, player, changedFields, changed: changedFields.length > 0 || (request.kind === 'draft' && player !== str(request.player).trim()) }
  }

  function present(request) {
    if (request === null || typeof request !== 'object' || request.card === null || typeof request.card !== 'object') throw new Error('缺少人物卡')
    const card = request.card
    if (request.as === 'world-book-overview') return worldBookOverview(card)
    if (request.as === 'world-book-window') return worldBookWindow(card, request)
    const editable = {}
    for (const field of TEXT_FIELDS) editable[field] = card[field] || ''
    editable.tags = clone(card.tags || [])
    editable.alternate_greetings = clone(card.alternate_greetings || [])
    editable.character_book = clone(card.character_book || null)
    if (request.as === 'editable') return editable
    if (request.as === 'view') return Object.assign({ id: card.id }, editable)
    if (request.as === 'sillytavern-v3') {
      return {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: clone(editable)
      }
    }
    throw new Error('未知人物卡展示类型: ' + str(request.as))
  }

  return Object.freeze({
    create,
    update,
    present,
    textFields: TEXT_FIELDS
  })
}
