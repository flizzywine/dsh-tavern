import { randomUUID } from 'node:crypto'

export const CHARACTER_DESIGN_READ_TOOL_NAME = 'character_design_read'
export const CHARACTER_DESIGN_SAVE_TOOL_NAME = 'character_design_save'

const SPEC = 'dsh-tavern.character-design-document'
const REQUIRED_DESIGN_FIELDS = Object.freeze([
  'identity',
  'narrativeRole',
  'coreMotivation',
  'innerConflict',
  'personality',
  'appearance',
  'behaviorStyle',
  'speechStyle',
  'relationships',
  'defaultPresentation',
  'plotPotential'
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
    ? source.characters.filter(function (item) { return item !== null && typeof item === 'object' && !Array.isArray(item) }).map(clone)
    : []
  return Object.assign({}, source, { spec: SPEC, version: 1, characters })
}

function designFrom(input) {
  return Object.fromEntries(REQUIRED_DESIGN_FIELDS.map(function (field) {
    return [field, text(input[field], field)]
  }))
}

const stringProperty = description => ({ type: 'string', description })

const mvuFieldsProperty = Object.freeze({
  type: 'object',
  description: '依据当前人物卡 MVU Schema 为该人物填写的完整字段对象；必须覆盖目标模板的全部字段且不得使用未知占位值。',
  additionalProperties: true
})

export const CHARACTER_DESIGN_READ_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_READ_TOOL_NAME,
  description: '读取当前对话的人物设计档案。无参数时返回精简索引及 mvuCoverage 完整性；需要复用、补全或修改某人时按 characterId 或姓名读取完整方案。',
  countsTowardLimit: false,
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      characterId: stringProperty('索引返回的稳定人物编号。'),
      name: stringProperty('没有编号时按人物姓名查找。')
    }
  })
})

export const CHARACTER_DESIGN_SAVE_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
  description: '保存当前对话的重要人物完整方案及当前卡专属 MVU 投影；mvuFields 必须覆盖 mvuPath 对应模板的全部字段且不得含未知占位值。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      characterId: stringProperty('更新既有人物时传入索引中的稳定编号；新建时省略。'),
      name: stringProperty('人物姓名。'),
      aliases: { type: 'array', description: '可选别名。', items: { type: 'string' } },
      mvuPath: stringProperty('该人物在当前卡 stat_data 下的 JSON Pointer，例如 /在场女生/人物名。'),
      mvuFields: mvuFieldsProperty,
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
    required: ['name', 'mvuPath', 'mvuFields', ...REQUIRED_DESIGN_FIELDS]
  })
})

function pointerSegments(value) {
  const pointer = str(value).trim()
  if (pointer === '' || pointer[0] !== '/') throw new Error('人物设计 mvuPath 必须是 JSON Pointer')
  return pointer.split('/').slice(1).map(function (segment) {
    return segment.replaceAll('~1', '/').replaceAll('~0', '~')
  }).filter(function (_segment, index) { return index > 0 || _segment !== 'stat_data' })
}

function valueTypeMatches(value, type) {
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'null') return value === null
  return typeof value === type
}

function projectionContract(schemaValue, path) {
  const segments = pointerSegments(path)
  let schema = object(schemaValue)
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    const properties = object(schema.properties)
    if (Object.prototype.hasOwnProperty.call(properties, segment)) {
      schema = object(properties[segment])
      continue
    }
    if (index === segments.length - 1 && Object.keys(object(schema.template)).length > 0) {
      return { path: '/' + segments.join('/'), template: clone(schema.template), properties: {} }
    }
    if (schema.additionalProperties !== null && typeof schema.additionalProperties === 'object') {
      schema = object(schema.additionalProperties)
      continue
    }
    throw new Error('人物设计 mvuPath 不符合当前变量模板：/' + segments.join('/'))
  }
  return {
    path: '/' + segments.join('/'),
    template: clone(object(schema.template)),
    properties: clone(object(schema.properties))
  }
}

function concreteValue(value, field) {
  if (typeof value === 'string') {
    const result = value.trim()
    if (result === '') throw new Error('人物 MVU 字段 ' + field + ' 不能为空')
    const unknown = result.match(UNKNOWN_MARKER)
    if (unknown !== null) throw new Error('人物 MVU 字段 ' + field + ' 仍含未知占位值：' + unknown[0])
  }
  if (Array.isArray(value)) value.forEach(function (item, index) { concreteValue(item, field + '[' + index + ']') })
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) concreteValue(item, field + '.' + key)
  }
}

function normalizeMvuProjection(input, schemaValue) {
  const contract = projectionContract(schemaValue, input.mvuPath)
  const fields = object(clone(input.mvuFields))
  const template = object(contract.template)
  const properties = object(contract.properties)
  const required = Object.keys(template).length > 0
    ? Object.keys(template)
    : Object.keys(properties).filter(function (key) { return properties[key] && properties[key].required === true })
  const missing = required.filter(function (key) { return !Object.prototype.hasOwnProperty.call(fields, key) })
  if (missing.length > 0) throw new Error('人物 MVU 投影缺少模板字段：' + missing.join('、'))
  for (const key of required) {
    const value = fields[key]
    const property = object(properties[key])
    const expectedType = str(property.type) || (Object.prototype.hasOwnProperty.call(template, key)
      ? (Array.isArray(template[key]) ? 'array' : (template[key] === null ? '' : typeof template[key]))
      : '')
    if (expectedType !== '' && !valueTypeMatches(value, expectedType)) {
      throw new Error('人物 MVU 字段 ' + key + ' 类型应为 ' + expectedType)
    }
    concreteValue(value, key)
  }
  return { path: contract.path, fields }
}

function valueAtPath(value, path) {
  let current = object(value && value.stat_data !== undefined ? value.stat_data : value)
  for (const segment of pointerSegments(path)) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false }
    }
    current = current[segment]
  }
  return { exists: true, value: current }
}

function pointerForCharacter(variables, character) {
  const names = new Set([str(character.name)].concat(Array.isArray(character.aliases) ? character.aliases.map(str) : []).filter(Boolean))
  const root = object(variables && variables.stat_data !== undefined ? variables.stat_data : variables)
  let result = ''
  function walk(value, segments) {
    if (result !== '' || value === null || typeof value !== 'object') return
    if (!Array.isArray(value)) {
      const entries = Object.entries(value)
      const namedChild = entries.find(function ([key]) { return names.has(key) })
      if (namedChild !== undefined) {
        result = '/' + segments.concat(namedChild[0]).map(function (segment) { return segment.replaceAll('~', '~0').replaceAll('/', '~1') }).join('/')
        return
      }
      if (entries.some(function ([_key, item]) { return typeof item === 'string' && names.has(item.trim()) })) {
        result = '/' + segments.map(function (segment) { return segment.replaceAll('~', '~0').replaceAll('/', '~1') }).join('/')
        return
      }
      for (const [key, item] of entries) walk(item, segments.concat(key))
    } else {
      value.forEach(function (item, index) { walk(item, segments.concat(String(index))) })
    }
  }
  for (const [key, item] of Object.entries(root)) {
    if (names.has(key)) return '/' + key.replaceAll('~', '~0').replaceAll('/', '~1')
    walk(item, [key])
  }
  return result
}

/** One settlement-local draft. The caller persists document() only with its atomic Chat commit. */
export function createCharacterDesignDocumentSession(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const makeId = typeof options.id === 'function' ? options.id : function () { return 'character-' + randomUUID() }
  const original = normalizeDocument(options.document)
  const variableSchema = clone(object(options.variableSchema))
  const currentVariables = clone(object(options.currentVariables))
  let current = clone(original)
  let dirty = false
  const changedIds = new Set()

  function coverage(character) {
    const projection = object(character && character.mvuProjection)
    const path = str(projection.path) || pointerForCharacter(currentVariables, character)
    if (path === '') return { status: 'not-projected' }
    const currentValue = valueAtPath(currentVariables, path)
    if (!currentValue.exists) return { status: 'not-projected', path }
    try {
      normalizeMvuProjection({ mvuPath: path, mvuFields: currentValue.value }, variableSchema)
      return { status: 'complete', path }
    } catch (error) {
      return { status: 'incomplete', path, error: str(error && error.message || error) }
    }
  }

  function find(input) {
    const characterId = str(input.characterId).trim()
    const name = str(input.name).trim()
    if (characterId !== '') return current.characters.find(function (item) { return str(item.id) === characterId })
    if (name !== '') return current.characters.find(function (item) { return str(item.name) === name })
    return undefined
  }

  function read(args) {
    const input = object(args)
    const requested = str(input.characterId).trim() !== '' || str(input.name).trim() !== ''
    if (requested) {
      const character = find(input)
      return character === undefined
        ? { ok: true, found: false, character: null }
        : { ok: true, found: true, character: Object.assign(clone(character), { mvuCoverage: coverage(character) }) }
    }
    return {
      ok: true,
      characters: current.characters.map(function (item) {
        const design = object(item.design)
        return {
          characterId: str(item.id),
          name: str(item.name),
          identity: str(design.identity),
          narrativeRole: str(design.narrativeRole),
          mvuCoverage: coverage(item),
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
    const requestedId = str(input.characterId).trim()
    let existing = find(input)
    if (requestedId !== '' && existing === undefined) throw new Error('人物档案不存在：' + requestedId + '；请重新读取索引后再保存')
    if (existing === undefined) existing = current.characters.find(function (item) { return str(item.name) === name })
    const created = existing === undefined
    const timestamp = Math.max(0, Number(now()) || 0)
    const character = Object.assign({}, existing || {}, {
      id: created ? str(makeId()) : str(existing.id),
      name,
      aliases,
      design: designFrom(input),
      mvuProjection: normalizeMvuProjection(input, variableSchema),
      createdAt: created ? timestamp : Math.max(0, Number(existing.createdAt) || timestamp),
      updatedAt: timestamp
    })
    if (character.id === '') throw new Error('人物设计工具未能生成有效人物编号')
    const characters = current.characters.slice()
    if (created) characters.push(character)
    else characters[characters.indexOf(existing)] = character
    current = Object.assign({}, current, {
      characters,
      revision: Math.max(0, Number(current.revision) || 0) + 1,
      updatedAt: timestamp
    })
    dirty = true
    changedIds.add(character.id)
    return { ok: true, created, characterId: character.id, name: character.name, revision: current.revision }
  }

  function validateSubmission(operations) {
    for (const character of current.characters) {
      const currentCoverage = coverage(character)
      if (currentCoverage.status === 'incomplete' && !changedIds.has(str(character.id))) {
        throw new Error('人物 ' + character.name + ' 的 MVU 档案不完整（' + currentCoverage.error + '）；请先调用 skill 加载 tavern-character-design，再调用 character_design_save 补全后提交变量。')
      }
      if (!changedIds.has(str(character.id))) continue
      const projection = object(character.mvuProjection)
      const path = str(projection.path)
      const normalizedOperations = operations.map(function (item) {
        const itemPath = str(item && item.path).replace(/^\/stat_data(?=\/|$)/, '') || '/'
        return { item, path: itemPath }
      })
      const operation = normalizedOperations.find(function (entry) {
        return entry.item && ['insert', 'add', 'replace'].includes(entry.item.op) && entry.path === path
      })?.item
      const relatedOperation = normalizedOperations.some(function (entry) {
        return entry.path === path || entry.path.startsWith(path + '/') || path.startsWith(entry.path + '/')
      })
      const existing = valueAtPath(currentVariables, path)
      if (operation === undefined) {
        if (relatedOperation) throw new Error('人物 ' + character.name + ' 必须在 ' + path + ' 一次提交完整对象，不能只写部分字段')
        if (existing.exists) throw new Error('人物 ' + character.name + ' 的现有 MVU 档案需要用完整对象补全：' + path)
        continue
      }
      normalizeMvuProjection({ mvuPath: path, mvuFields: operation.value }, variableSchema)
    }
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
    tools: Object.freeze([CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL]),
    execute,
    validateSubmission,
    document: function () { return clone(current) },
    changed: function () { return dirty }
  })
}
