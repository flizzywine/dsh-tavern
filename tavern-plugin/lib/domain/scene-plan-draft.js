const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const string = maxLength => ({ type: 'string', maxLength })
const fields = ['appearance', 'clothing', 'action', 'expression', 'position']
const sceneFields = ['environment', 'composition']
const visual = object({ text: string(600), tags: string(1200) }, ['text', 'tags'])
const propertiesFor = (names, schema) => Object.fromEntries(names.map(name => [name, schema]))
export const SCENE_CHARACTER_TOOL = {
  name: 'submit_scene_character', description: '向当前画面草稿提交一个人物。按 id 合并变化字段；不会保存正式人物方案或生成图片。',
  parameters: object({ id: string(100), name: string(100), fields: object(propertiesFor(fields, visual)),
    expressions: object(propertiesFor(fields, string(1200))) }, ['id', 'fields'])
}
export const SCENE_LAYOUT_TOOL = {
  name: 'submit_scene_layout', description: '保存当前画面草稿的场景、构图和人物顺序。不会生成图片。',
  parameters: object({ description: string(1000), subjects: { type: 'array', items: string(100), maxItems: 8 },
    continuity: { type: 'string', enum: ['continued', 'changed', 'uncertain'] },
    scene: object(propertiesFor(sceneFields, visual)), expressions: object(propertiesFor(sceneFields, string(1200)))
  }, ['description', 'subjects', 'continuity', 'scene'])
}
export const SCENE_PLAN_TOOL = {
  name: 'submit_scene_plan', description: '无参数确认当前草稿。校验后请求一张图片并等待保存，返回成功或具体失败结果。服务失败不会自动重发。不要重复携带 plan 或人物描述。',
  parameters: object({})
}
export const SCENE_DRAFT_TOOLS = [SCENE_CHARACTER_TOOL, SCENE_LAYOUT_TOOL, SCENE_PLAN_TOOL]
// Initial failure plus three corrections; successful draft calls do not consume this budget.
export const SCENE_PLAN_MAX_FAILURES = 4
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
function invalid(path, message) { throw new Error('参数内容错误：' + path + ' ' + message) }
function validate(value, schema, path) {
  const actual = typeOf(value)
  if (actual !== schema.type) invalid(path, '应为 ' + schema.type + '，实际为 ' + actual)
  if (schema.enum && !schema.enum.includes(value)) invalid(path, '须为 ' + schema.enum.join(' / '))
  if (schema.type === 'string' && value.length > schema.maxLength) invalid(path, '超过 ' + schema.maxLength + ' 字符')
  if (schema.type === 'array') {
    if (value.length > schema.maxItems) invalid(path, '最多 ' + schema.maxItems + ' 项')
    value.forEach((item, index) => validate(item, schema.items, path + '[' + index + ']'))
  }
  if (schema.type === 'object') {
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) invalid(path, '包含未知字段 ' + key)
    for (const key of schema.required) if (!Object.hasOwn(value, key)) invalid(path + '.' + key, '缺失')
    for (const [key, item] of Object.entries(value)) validate(item, schema.properties[key], path + '.' + key)
  }
}

/** Preserve only the matching current call's raw JSON, before host fallback hides its syntax error. */
export function imageToolCall(name, args, execution, events = [], start = 0) {
  const call = { name, arguments: args }
  if (!execution?.callId) return call
  for (let index = events.length - 1; index >= start; index--) {
    const event = events[index]
    if (event.type === 'tool/call' && event.data?.callId === execution.callId && event.data.name === name) {
      if (typeof event.data.arguments === 'string') call.rawArguments = event.data.arguments
      break
    }
  }
  return call
}

export function readImageToolArguments(call) {
  let args = call.rawArguments ?? call.arguments
  if (typeof args === 'string') {
    const raw = args
    try { args = JSON.parse(raw) } catch (error) {
      const position = Number(error.message.match(/position (\d+)/)?.[1] ?? raw.length)
      const before = raw.slice(0, position)
      const line = before.split('\n').length
      const column = position - before.lastIndexOf('\n')
      const expected = /Expected ',' or ']'/.test(error.message) ? '此处预期 , 或 ]'
        : /Expected ',' or '}'/.test(error.message) ? '此处预期 , 或 }'
          : /property name|double-quoted property/.test(error.message) ? '对象字段名须用双引号'
            : /end of JSON/.test(error.message) ? '参数提前结束，请检查未闭合括号或引号' : '请检查此处的引号、逗号和括号'
      const near = raw.slice(Math.max(0, position - 24), position + 24)
      throw new Error('JSON 语法错误：第 ' + line + ' 行第 ' + column + ' 列（位置 ' + position + '），遇到 ' +
        (position < raw.length ? JSON.stringify(raw[position]) : '文本末尾') + '；' + expected + '。附近：' + JSON.stringify(near) + '。未解析成功，不是方案字段缺失；不要改字段名来修复语法。')
    }
  }
  if (typeOf(args) !== 'object') invalid('arguments', '应为 object，实际为 ' + typeOf(args))
  return args
}

/** Pure draft changes. The caller persists each accepted change in its existing image job. */
export function updateSceneDraft(draft, name, args) {
  const tool = SCENE_DRAFT_TOOLS.find(tool => tool.name === name)
  if (!tool) invalid('tool', '未知工具 ' + name)
  validate(args, tool.parameters, name)
  const next = structuredClone({ characters: {}, layout: null, ...draft })
  if (name === SCENE_CHARACTER_TOOL.name) {
    if (!args.id.trim()) invalid(name + '.id', '不能为空')
    const previous = Object.hasOwn(next.characters, args.id) ? next.characters[args.id] : undefined
    if (!previous && Object.keys(next.characters).length >= 8) invalid('characters', '最多 8 人')
    for (const [field, value] of Object.entries(args.fields)) {
      if (Boolean(value.text.trim()) !== Boolean(value.tags.trim())) invalid(name + '.fields.' + field, 'text 和 tags 须同时为空或非空')
    }
    next.characters = { ...next.characters, [args.id]: { ...previous, ...args,
      fields: { ...previous?.fields, ...args.fields }, expressions: { ...previous?.expressions, ...args.expressions } } }
  } else if (name === SCENE_LAYOUT_TOOL.name) {
    if (new Set(args.subjects).size !== args.subjects.length) invalid(name + '.subjects', '人物 id 不得重复')
    for (const [field, value] of Object.entries(args.scene)) {
      if (Boolean(value.text.trim()) !== Boolean(value.tags.trim())) invalid(name + '.scene.' + field, 'text 和 tags 须同时为空或非空')
    }
    next.layout = structuredClone(args)
  }
  return next
}

export function assembleSceneDraft(draft) {
  if (!draft.layout) invalid('scene', '缺少场景草稿，请调用 submit_scene_layout')
  const { expressions: sceneExpressions = {}, ...layout } = draft.layout
  const characters = Object.values(draft.characters || {}).map(({ expressions, ...person }) => person)
  const expressions = Object.values(draft.characters || {}).flatMap(person => Object.entries(person.expressions || {}).map(([field, tags]) => ({ owner: person.id, field, tags })))
  expressions.push(...Object.entries(sceneExpressions).map(([field, tags]) => ({ owner: 'scene', field, tags })))
  return { ...structuredClone(layout), characters, expressions }
}

export function sceneDraftSummary(draft) {
  return { characters: Object.values(draft.characters || {}).map(person => ({ id: person.id, name: person.name, savedFields: Object.keys(person.fields) })),
    layoutSaved: Boolean(draft.layout), instruction: '已保存部分无需重发；可按 id 修改。完成后调用 submit_scene_plan({})。' }
}
