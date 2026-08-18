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
