import { applyCharacterDesignWorldbook, characterDesignWorldbookSnapshot, characterWorldbookEntries } from './character-design-worldbook.js'

export const CHARACTER_DESIGN_READ_TOOL_NAME = 'character_design_read'
export const CHARACTER_DESIGN_SAVE_TOOL_NAME = 'character_design_save'
export const CHARACTER_DESIGN_REUSE_TOOL_NAME = 'character_design_reuse'

const SPEC = 'dsh-tavern.character-design-document'
const REQUIRED_DESIGN_FIELDS = Object.freeze([
  'identity', 'personality', 'appearance', 'speechStyle', 'narrativeRole'
])
const PRESENTATION_FIELDS = Object.freeze([
  ['identity', '身份'],
  ['personality', '性格'],
  ['appearance', '外貌'],
  ['speechStyle', '说话方式'],
  ['narrativeRole', '剧情作用'],
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

function mergeDesign(value) {
  const design = object(value)
  const merge = keys => [...new Set(keys.map(key => str(design[key]).trim()).filter(Boolean))].join('\n\n')
  return {
    ...Object.fromEntries(REQUIRED_DESIGN_FIELDS.map(key => [key, design[key]])),
    narrativeRole: merge(['narrativeRole', 'plotPotential']),
    personality: str(design.personality),
    appearance: merge(['appearance', 'defaultPresentation'])
  }
}

function normalizeDocument(value) {
  const source = object(clone(value))
  const characters = Array.isArray(source.characters)
    ? source.characters.filter(function (item) { return item !== null && typeof item === 'object' && !Array.isArray(item) }).map(function (item) {
      const normalized = clone(item)
      normalized.design = mergeDesign(normalized.design)
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
  input = mergeDesign(input)
  return Object.fromEntries(REQUIRED_DESIGN_FIELDS.map(function (field) {
    return [field, text(input[field], field)]
  }))
}

const stringProperty = description => ({ type: 'string', description })

export const CHARACTER_DESIGN_READ_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_READ_TOOL_NAME,
  description: '设计前先查本局世界书和人物档案。无参数返回两者索引；按姓名或别名查询返回匹配世界书原文及已有档案。判断世界书已有完整人物设定时调用 character_design_reuse，不重复建档。正文提及不等于完整人物设定；静态资料可按需通过 skill 和 read 查阅，动态内容以本轮运行时提供的内容为准。',
  countsTowardLimit: false,
  parameters: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: { name: stringProperty('索引返回的人物姓名。') }
  })
})

export const CHARACTER_DESIGN_REUSE_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_REUSE_TOOL_NAME,
  description: '确认已读取的本局世界书足以提供该人物设定，直接复用，成功结束该人物设计而不创建档案或修改世界书。仅姓名或零散提及时不要使用。',
  countsTowardLimit: false,
  parameters: { type: 'object', additionalProperties: false, properties: {
    name: stringProperty('已查询的人物姓名或别名。'),
    refs: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'character_design_read 返回并已核对的世界书条目编号。' }
  }, required: ['name', 'refs'] }
})

export const CHARACTER_DESIGN_SAVE_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
  description: '保存当前对话的重要人物完整方案，并自动写入本局世界书。新人物以姓名和别名触发非常驻条目，后续保存更新对应条目；不修改原始卡库或世界书库，不覆盖手动修改的正文。人物卡状态变量由对应结算工具单独更新。',
  parameters: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: {
      name: stringProperty('人物姓名。'),
      aliases: { type: 'array', description: '可选别名。', items: { type: 'string' } },
      identity: stringProperty('完整身份与社会位置。'),
      personality: stringProperty('鲜明、可观察且彼此一致的性格。'),
      appearance: stringProperty('外貌、体型、辨识特征与日常穿着。'),
      speechStyle: stringProperty('语言习惯、语气与表达方式。'),
      narrativeRole: stringProperty('剧情作用：人物在故事中的作用及可能的发展方向，不预写既成剧情。'),
    },
    required: ['name', ...REQUIRED_DESIGN_FIELDS]
  })
})

/** One in-memory draft. Persistence policy belongs to the adapter at the caller's seam. */
export function createCharacterDesignDocumentSession(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  let current = normalizeDocument(options.document)
  let dirty = false
  const readWorldbooks = new Map(), reused = new Map()
  const worldbookEntries = names => characterWorldbookEntries(options.worldbook?.(), names)

  function find(input) {
    const name = str(input.name).trim()
    return name === '' ? undefined : current.characters.find(function (item) { return str(item.name) === name || item.aliases?.includes(name) })
  }

  function read(args) {
    const input = object(args)
    if (str(input.name).trim() !== '') {
      const character = find(input)
      const entries = worldbookEntries([input.name, ...(character?.aliases || []), character?.name])
      readWorldbooks.set(str(input.name).trim(), new Map(entries.map(entry => [entry.ref, entry.content])))
      return { ok: true, found: Boolean(character) || entries.length > 0, character: clone(character) ?? null, worldbook: entries }
    }
    return {
      ok: true,
      worldbook: worldbookEntries([]).map(({ content, ...entry }) => entry),
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
    const existing = find(input)
    const name = text(existing?.name || input.name, 'name', 200)
    const aliases = Array.isArray(input.aliases)
      ? Array.from(new Set(input.aliases.map(function (item) { return text(item, 'aliases', 200) })))
      : []
    const created = existing === undefined
    const timestamp = Math.max(0, Number(now()) || 0)
    const character = Object.assign({}, existing || {}, {
      name, aliases, design: designFrom(input),
      createdAt: created ? timestamp : Math.max(0, Number(existing.createdAt) || timestamp),
      updatedAt: timestamp
    })
    const applied = options.onSave?.(clone(character))
    const characters = current.characters.slice()
    if (created) characters.push(character)
    else characters[characters.indexOf(existing)] = character
    current = Object.assign({}, current, {
      characters, revision: Math.max(0, Number(current.revision) || 0) + 1, updatedAt: timestamp
    })
    dirty = true
    return { ok: true, created, name: character.name, revision: current.revision, ...(applied ? { worldbook: applied.worldbook } : {}) }
  }

  async function execute(call) {
    try {
      if (call && call.name === CHARACTER_DESIGN_READ_TOOL_NAME) return JSON.stringify(read(call.arguments))
      if (call && call.name === CHARACTER_DESIGN_SAVE_TOOL_NAME) return JSON.stringify(save(call.arguments))
      if (call?.name === CHARACTER_DESIGN_REUSE_TOOL_NAME) {
        const name = text(call.arguments?.name, 'name', 200), refs = call.arguments?.refs
        const read = readWorldbooks.get(name), entries = worldbookEntries([name])
        if (!Array.isArray(refs) || !refs.length || refs.some(ref => !read?.has(ref) || !entries.some(entry => entry.ref === ref && entry.content === read.get(ref)))) {
          throw new Error('请先按该人物姓名读取本局世界书，再提交返回的有效条目编号')
        }
        reused.set(name, refs.map(ref => ({ ref, content: read.get(ref) })))
        return JSON.stringify({ ok: true, reused: true, name, refs, created: false })
      }
      return JSON.stringify({ ok: false, retryable: true, error: '不是人物档案工具调用' })
    } catch (error) {
      return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
    }
  }

  return Object.freeze({
    tools: Object.freeze([CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL, CHARACTER_DESIGN_REUSE_TOOL]), execute,
    reused: () => [...reused].map(([name, entries]) => ({ name, entries })),
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
        const snapshot = characterDesignWorldbookSnapshot(chat, chat.openingWorldbookSnapshot?.version === 1
          ? null : await options.readWorldBook?.(chat))
        return await createCharacterDesignDocumentSession({ document: chat.characterDesignDocument, now,
          worldbook: () => snapshot.document }).execute(call)
      }
      let output = JSON.stringify({ ok: false, retryable: true, error: '人物设计所属聊天不存在' })
      await store.updateChat(chatId, async function (chat) {
        if (!chat) return undefined
        const snapshot = characterDesignWorldbookSnapshot(chat, chat.openingWorldbookSnapshot?.version === 1
          ? null : await options.readWorldBook?.(chat))
        const session = createCharacterDesignDocumentSession({ document: chat.characterDesignDocument, now,
          onSave: character => applyCharacterDesignWorldbook(chat, character, snapshot) })
        output = await session.execute(call)
        const result = JSON.parse(output)
        if (result.ok !== true || !session.changed()) return undefined
        chat.characterDesignDocument = session.document()
        if (options.publishWorldbook) await options.publishWorldbook(chat, [chat.characterDesignDocument.characters.find(character => character.name === result.name)])
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
