export const CHARACTER_DESIGN_READ_TOOL_NAME = 'character_design_read'
export const CHARACTER_DESIGN_SAVE_TOOL_NAME = 'character_design_save'

const SPEC = 'dsh-tavern.character-design-document'
const REQUIRED_DESIGN_FIELDS = Object.freeze([
  'identity', 'narrativeRole', 'coreMotivation', 'innerConflict', 'personality', 'appearance',
  'behaviorStyle', 'speechStyle', 'relationships', 'defaultPresentation', 'plotPotential'
])
const PRESENTATION_FIELDS = Object.freeze([
  ['identity', '身份'],
  ['narrativeRole', '剧情作用'],
  ['coreMotivation', '核心动机'],
  ['innerConflict', '内在矛盾'],
  ['personality', '性格'],
  ['appearance', '外貌'],
  ['behaviorStyle', '行为方式'],
  ['speechStyle', '说话方式'],
  ['relationships', '人物关系'],
  ['defaultPresentation', '默认形象'],
  ['plotPotential', '剧情潜力']
])
const UNKNOWN_MARKER = /未明确|未知|待定|不详|尚未设定|暂未决定/

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function timestamp(value) {
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : 0
}

function text(value, field, limit = 4000) {
  const result = str(value).trim()
  if (result === '') throw new Error('人物设计缺少 ' + field)
  if (result.length > limit) throw new Error('人物设计字段 ' + field + ' 超过 ' + limit + ' 字')
  if (UNKNOWN_MARKER.test(result)) throw new Error('人物设计字段 ' + field + ' 仍含未知占位值：' + result.match(UNKNOWN_MARKER)[0])
  return result
}

function normalizeDocument(value) {
  const source = object(clone(value))
  const characters = Array.isArray(source.characters)
    ? source.characters.filter(function (item) { return item !== null && typeof item === 'object' && !Array.isArray(item) }).map(function (item) {
      const normalized = clone(item)
      delete normalized.id
      return normalized
    })
    : []
  return Object.assign({}, source, { spec: SPEC, version: 1, characters })
}

/** Stable read-only projection for user surfaces; callers never depend on the stored schema. */
export function projectCharacterDesignDocument(value) {
  const document = normalizeDocument(value)
  return {
    revision: Math.max(0, Number(document.revision) || 0),
    updatedAt: timestamp(document.updatedAt),
    characters: document.characters.map(function (item) {
      const design = object(item.design)
      return {
        name: str(item.name),
        aliases: Array.isArray(item.aliases) ? item.aliases.map(str).filter(Boolean) : [],
        identity: str(design.identity),
        narrativeRole: str(design.narrativeRole),
        updatedAt: timestamp(item.updatedAt),
        sections: PRESENTATION_FIELDS.map(function ([key, label]) {
          return { key, label, text: str(design[key]) }
        }).filter(function (section) { return section.text !== '' })
      }
    }).filter(function (item) { return item.name !== '' })
  }
}

function designFrom(input) {
  return Object.fromEntries(REQUIRED_DESIGN_FIELDS.map(function (field) {
    return [field, text(input[field], field)]
  }))
}

const stringProperty = description => ({ type: 'string', description })

export const CHARACTER_DESIGN_READ_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_READ_TOOL_NAME,
  description: '读取当前对话的人物设计档案。无参数时返回精简索引；需要复用、补全或修改某人时按姓名读取完整方案。',
  countsTowardLimit: false,
  parameters: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: { name: stringProperty('索引返回的人物姓名。') }
  })
})

export const CHARACTER_DESIGN_SAVE_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
  description: '保存当前对话的重要人物完整方案。人物设计独立于人物卡变量；若当前卡另有状态变量，由对应结算工具单独更新。',
  parameters: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: {
      name: stringProperty('人物姓名。'),
      aliases: { type: 'array', description: '可选别名。', items: { type: 'string' } },
      identity: stringProperty('完整身份与社会位置。'),
      narrativeRole: stringProperty('人物在故事中的持续作用。'),
      coreMotivation: stringProperty('核心欲望与行动动力。'),
      innerConflict: stringProperty('内在矛盾、顾虑或代价。'),
      personality: stringProperty('鲜明、可观察且彼此一致的性格。'),
      appearance: stringProperty('完整外貌、体型与辨识特征。'),
      behaviorStyle: stringProperty('行为习惯、反应方式与动作风格。'),
      speechStyle: stringProperty('语言习惯、语气与表达方式。'),
      relationships: stringProperty('与现有人物或群体的关系立场。'),
      defaultPresentation: stringProperty('完整默认形象与穿着，可在剧情中继续更新。'),
      plotPotential: stringProperty('可能推动后续剧情的动机、矛盾或关系接口；不预写既成剧情。')
    },
    required: ['name', ...REQUIRED_DESIGN_FIELDS]
  })
})

/** One in-memory draft. Persistence policy belongs to the adapter at the caller's seam. */
export function createCharacterDesignDocumentSession(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  let current = normalizeDocument(options.document)
  let dirty = false

  function find(input) {
    const name = str(input.name).trim()
    return name === '' ? undefined : current.characters.find(function (item) { return str(item.name) === name })
  }

  function read(args) {
    const input = object(args)
    if (str(input.name).trim() !== '') {
      const character = find(input)
      return character === undefined ? { ok: true, found: false, character: null } : { ok: true, found: true, character: clone(character) }
    }
    return {
      ok: true,
      characters: current.characters.map(function (item) {
        const design = object(item.design)
        return {
          name: str(item.name), identity: str(design.identity), narrativeRole: str(design.narrativeRole),
          updatedAt: Math.max(0, Number(item.updatedAt) || 0)
        }
      })
    }
  }

  function save(args) {
    const input = object(args)
    const name = text(input.name, 'name', 200)
    const aliases = Array.isArray(input.aliases)
      ? Array.from(new Set(input.aliases.map(function (item) { return text(item, 'aliases', 200) })))
      : []
    const existing = find(input)
    const created = existing === undefined
    const timestamp = Math.max(0, Number(now()) || 0)
    const character = Object.assign({}, existing || {}, {
      name, aliases, design: designFrom(input),
      createdAt: created ? timestamp : Math.max(0, Number(existing.createdAt) || timestamp),
      updatedAt: timestamp
    })
    const characters = current.characters.slice()
    if (created) characters.push(character)
    else characters[characters.indexOf(existing)] = character
    current = Object.assign({}, current, {
      characters, revision: Math.max(0, Number(current.revision) || 0) + 1, updatedAt: timestamp
    })
    dirty = true
    return { ok: true, created, name: character.name, revision: current.revision }
  }

  async function execute(call) {
    try {
      if (call && call.name === CHARACTER_DESIGN_READ_TOOL_NAME) return JSON.stringify(read(call.arguments))
      if (call && call.name === CHARACTER_DESIGN_SAVE_TOOL_NAME) return JSON.stringify(save(call.arguments))
      return JSON.stringify({ ok: false, retryable: true, error: '不是人物档案工具调用' })
    } catch (error) {
      return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
    }
  }

  return Object.freeze({
    tools: Object.freeze([CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL]), execute,
    document: function () { return clone(current) }, changed: function () { return dirty }
  })
}

/** Expose read/save tools backed by the current Chat, persisting every valid save immediately. */
export function createCharacterDesignDocumentTools(options = {}) {
  const store = options.store
  const now = typeof options.now === 'function' ? options.now : Date.now
  if (!store || typeof store.readChat !== 'function' || typeof store.updateChat !== 'function') {
    throw new Error('Character Design Document Tools 缺少 Chat Store adapter')
  }

  async function execute(chatId, call) {
    try {
      if (!call || ![CHARACTER_DESIGN_READ_TOOL_NAME, CHARACTER_DESIGN_SAVE_TOOL_NAME].includes(call.name)) {
        return JSON.stringify({ ok: false, retryable: true, error: '不是人物档案工具调用' })
      }
      if (call.name === CHARACTER_DESIGN_READ_TOOL_NAME) {
        const chat = await store.readChat(chatId)
        if (!chat) throw new Error('人物设计所属聊天不存在')
        return await createCharacterDesignDocumentSession({ document: chat.characterDesignDocument, now }).execute(call)
      }
      let output = JSON.stringify({ ok: false, retryable: true, error: '人物设计所属聊天不存在' })
      await store.updateChat(chatId, async function (chat) {
        if (!chat) return undefined
        const session = createCharacterDesignDocumentSession({ document: chat.characterDesignDocument, now })
        output = await session.execute(call)
        const result = JSON.parse(output)
        if (result.ok !== true || !session.changed()) return undefined
        chat.characterDesignDocument = session.document()
        return chat
      }, { source: 'character-design.save' })
      return output
    } catch (error) {
      return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
    }
  }

  return Object.freeze({
    tools: Object.freeze([CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL]),
    execute
  })
}
