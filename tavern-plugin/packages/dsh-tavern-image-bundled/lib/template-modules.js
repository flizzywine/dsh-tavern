/** Shared extension contract. JSON templates store values; installed plugins supply code. */
const modules = new Map()
const fieldTypes = new Set(['text', 'textarea', 'number', 'boolean', 'select', 'json'])
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value))
export function normalizeModuleValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const text = JSON.stringify(value)
  if (text.length > 65536) throw new Error('模块设置最多 64 KB')
  return JSON.parse(text)
}
export function registerTemplateModule(definition) {
  if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(definition?.id || '') || typeof definition.resolve !== 'function') throw new Error('请提供模块标识及 resolve 处理函数')
  if (modules.has(definition.id)) throw new Error('模块标识已注册：' + definition.id)
  const fields = (definition.fields || []).slice(0, 40).map(field => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(field.key || '') || !fieldTypes.has(field.type)) throw new Error('模块字段需要有效 key 和 type')
    const result = { key: field.key, label: String(field.label || field.key).slice(0, 80), type: field.type }
    for (const key of ['default', 'min', 'max', 'step', 'required']) if (field[key] !== undefined) result[key] = copy(field[key])
    if (field.type === 'select') result.options = (field.options || []).slice(0, 200).map(option => typeof option === 'object' ? { value: String(option.value), label: String(option.label || option.value) } : { value: String(option), label: String(option) })
    return result
  })
  if (new Set(fields.map(field => field.key)).size !== fields.length) throw new Error('模块字段 key 不可重复')
  const entry = { id: definition.id, name: String(definition.name || definition.id).slice(0, 80), fields, resolve: definition.resolve }
  modules.set(entry.id, entry)
  return () => { if (modules.get(entry.id) === entry) modules.delete(entry.id) }
}
export function listTemplateModules() {
  return [...modules.values()].map(({ resolve, ...definition }) => copy(definition))
}
function valuesFor(definition, block) {
  const values = normalizeModuleValues(block.values)
  for (const field of definition.fields) {
    let value = values[field.key] ?? copy(field.default)
    if (value === '' || value === undefined) { if (field.required) throw new Error(definition.name + '：请填写' + field.label); continue }
    if (field.type === 'number') {
      value = Number(value)
      if (!Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) throw new Error(definition.name + '：' + field.label + '数值无效')
    } else if (field.type === 'boolean') value = value === true
    else if (field.type === 'json' && typeof value === 'string') {
      try { value = JSON.parse(value) } catch { throw new Error(definition.name + '：' + field.label + '不是有效 JSON') }
    } else if (field.type === 'select' && !field.options.some(option => option.value === String(value))) throw new Error(definition.name + '：请重新选择' + field.label)
    values[field.key] = value
  }
  return values
}
function active(block, usage) { return block.kind === 'extension' && block.enabled !== false && (!block.usage || block.usage === (usage || 'story')) }
function entryFor(block) {
  const entry = modules.get(block.moduleId || 'core.custom')
  if (!entry) throw new Error('模块「' + block.title + '」未加载，请启用对应插件或停用这个模块')
  return entry
}
function contribution(block, value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模块「' + block.title + '」需要返回结果对象')
  const blocks = []
  for (const [key, kind] of [['positive', 'positive'], ['negative', 'negative'], ['rules', 'rule']]) {
    const text = String(value[key] || '').trim()
    if (text.length > 16000) throw new Error('模块「' + block.title + '」输出过长')
    if (text) blocks.push({ kind, title: block.title, text, ...(block.usage ? { usage: block.usage } : {}) })
  }
  const parameters = {}
  for (const key of ['seed', 'steps', 'cfg', 'width', 'height']) if (value.parameters?.[key] !== undefined && value.parameters[key] !== '') {
    const number = Number(value.parameters[key])
    if (!Number.isFinite(number) || ['seed', 'steps', 'width', 'height'].includes(key) && !Number.isSafeInteger(number) || key === 'seed' && number < 0 || ['width', 'height', 'steps'].includes(key) && number <= 0) throw new Error('模块「' + block.title + '」的参数 ' + key + ' 无效')
    parameters[key] = number
  }
  const workflowValues = (value.workflowValues || []).map(item => {
    if (!item || typeof item.node !== 'string' || typeof item.input !== 'string' || item.value === undefined) throw new Error('模块工作流参数需要 node、input 和 value')
    return { node: item.node, input: item.input, value: copy(item.value) }
  })
  return { blocks, parameters, workflowValues }
}
function materialize(structure, resolved) {
  if (!resolved.size) return { structure, parameters: {}, workflowValues: [], trace: [] }
  const parameters = {}, workflowValues = [], trace = []
  const blocks = (structure?.blocks || []).flatMap((block, index) => {
    const item = resolved.get(index)
    if (!item) return [block]
    Object.assign(parameters, item.parameters); workflowValues.push(...item.workflowValues)
    trace.push({ title: block.title, moduleId: block.moduleId || 'core.custom', parameters: copy(item.parameters), workflowValues: copy(item.workflowValues) })
    return item.blocks
  })
  return { structure: structure ? { ...structure, blocks, modulesResolved: true } : structure, parameters, workflowValues, trace }
}
function contextFor(block, context, entry) {
  return { scene: String(context.scene || ''), usage: context.usage || 'story', backend: context.backend || '',
    inputs: copy(context.inputs || {}), subjects: copy(context.subjects || []), definitions: copy(context.definitions || {}),
    values: valuesFor(entry, block), signal: context.signal }
}
export function materializeTemplateModules(structure, context = {}) {
  const resolved = new Map()
  for (const [index, block] of (structure?.blocks || []).entries()) if (active(block, context.usage)) {
    context.signal?.throwIfAborted(); const entry = entryFor(block)
    const result = entry.resolve(contextFor(block, context, entry))
    if (result && typeof result.then === 'function') { result.catch?.(() => {}); throw new Error('模块「' + block.title + '」需要异步生成接口，请使用 materializeTemplateModulesAsync 或 composePluginImagePromptAsync') }
    resolved.set(index, contribution(block, result))
  }
  return materialize(structure, resolved)
}
export async function materializeTemplateModulesAsync(structure, context = {}) {
  const resolved = new Map()
  for (const [index, block] of (structure?.blocks || []).entries()) if (active(block, context.usage)) {
    context.signal?.throwIfAborted(); const entry = entryFor(block)
    const value = await entry.resolve(contextFor(block, context, entry)); context.signal?.throwIfAborted()
    resolved.set(index, contribution(block, value))
  }
  return materialize(structure, resolved)
}
/** Apply literal input values to an isolated workflow, never the saved graph. */
export function applyModuleWorkflowValues(workflow, values = []) {
  if (!values.length) return workflow
  if (!workflow?.prompt) throw new Error('当前模板的节点参数需要 ComfyUI 工作流')
  const result = { ...workflow, prompt: copy(workflow.prompt) }
  for (const item of values) {
    const inputs = result.prompt[item.node]?.inputs
    if (!inputs || !Object.hasOwn(inputs, item.input)) throw new Error('模块引用的工作流输入不存在：' + item.node + '.' + item.input)
    if (Array.isArray(inputs[item.input]) && inputs[item.input].length === 2 && result.prompt[String(inputs[item.input][0])]) throw new Error('这个输入连接了其他节点，请调整上游输入：' + item.node + '.' + item.input)
    inputs[item.input] = copy(item.value)
  }
  return result
}
const render = (text, context) => String(text || '').replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g, (token, key) => {
  if (key === 'scene') return context.scene
  if (key === 'usage') return context.usage
  const name = key.startsWith('input.') ? key.slice(6) : key
  return Object.hasOwn(context.inputs, name) ? String(context.inputs[name]) : token
})
registerTemplateModule({ id: 'core.custom', name: '自制模块', fields: [
  { key: 'positive', label: '加入正面提示词', type: 'textarea' },
  { key: 'negative', label: '加入负面提示词', type: 'textarea' },
  { key: 'rules', label: '提示词生成要求', type: 'textarea' },
  { key: 'keywords', label: '触发关键词（留空始终使用）', type: 'text' },
  { key: 'parameters', label: '生成参数（JSON，可选）', type: 'json' },
  { key: 'workflowValues', label: '节点参数（JSON，可选）', type: 'json' },
], resolve(context) {
  const words = String(context.values.keywords || '').split(/[,，\n]/).map(word => word.trim()).filter(Boolean)
  if (words.length && !words.some(word => context.scene.toLocaleLowerCase().includes(word.toLocaleLowerCase()))) return {}
  return { positive: render(context.values.positive, context), negative: render(context.values.negative, context), rules: render(context.values.rules, context), parameters: context.values.parameters, workflowValues: context.values.workflowValues }
} })

export function applyModuleParameters(params, parameters = {}) {
  const result = { ...params }
  for (const key of ['seed', 'steps', 'cfg']) if (result[key] === undefined && parameters[key] !== undefined) result[key] = parameters[key]
  if (parameters.width !== undefined || parameters.height !== undefined) {
    if (!parameters.width || !parameters.height) throw new Error('模块尺寸需要同时提供 width 和 height')
    if (!result.explicitSize) { result.size = parameters.width + 'x' + parameters.height; result.moduleSize = true }
  }
  return result
}
