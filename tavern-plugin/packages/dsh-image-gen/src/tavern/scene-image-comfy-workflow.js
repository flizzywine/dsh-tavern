import { createHash, randomInt } from 'node:crypto'

const object = value => value && typeof value === 'object' && !Array.isArray(value)
const safeKey = value => typeof value === 'string' && /^[\w.:-]{1,120}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
const fail = message => { throw new Error('ComfyUI 工作流：' + message) }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function samplerSeedBinding(prompt, id) {
  const node = prompt[id], input = node.class_type === 'KSampler' ? 'seed' : 'noise_seed'
  const value = node.inputs[input]
  if (!Array.isArray(value)) return { node: id, input }
  // rgthree's sole output passes inputs.seed through. Keep the graph edge and
  // inject into its source, rather than guessing arbitrary custom-node semantics.
  // Contract: https://github.com/rgthree/rgthree-comfy/blob/main/py/seed.py
  if (value.length === 2 && typeof value[0] === 'string' && value[1] === 0 && prompt[value[0]]?.class_type === 'Seed (rgthree)') {
    return { node: value[0], input: 'seed' }
  }
  fail(`节点 ${id} 的输入 ${input} 使用了暂不支持自动识别的种子连接，请维护者提供映射文件`)
}

/** Import an API graph or a maintainer-prepared mapping. This never loads code,
 * probes a server, or guesses an arbitrary node's input semantics. */
export function comfyWorkflow(value) {
  if (value == null) return null
  if (!object(value) || Buffer.byteLength(JSON.stringify(value)) > 512000) fail('须为不超过 500 KB 的 API 格式 JSON')
  const wrapped = value.format === 'dsh-tavern-comfy-v1'
  const graph = wrapped ? value.prompt : value
  if (!object(graph) || Array.isArray(graph.nodes)) fail('请导出 API 格式，不能使用画布格式；复杂工作流需维护者提供映射文件')
  const entries = Object.entries(graph)
  if (!entries.length || entries.length > 200) fail('节点数须为 1–200')
  const prompt = Object.create(null)
  function check(value, depth = 0) {
    if (depth > 16) fail('嵌套过深')
    if (Array.isArray(value)) { for (const item of value) check(item, depth + 1); return }
    if (object(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (!safeKey(key) || /^(?:api_?key|token|password|secret|authorization)$/i.test(key)) fail('不能在工作流中保存凭据或危险字段；请由服务器配置认证')
        check(item, depth + 1)
      }
    } else if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) fail('参数须为 JSON 值')
  }
  for (const [id, node] of entries) {
    if (!safeKey(id) || !object(node) || typeof node.class_type !== 'string' || !node.class_type || node.class_type.length > 200 || !object(node.inputs)) fail('节点结构无效')
    check(node.inputs)
    prompt[id] = { class_type: node.class_type, inputs: structuredClone(node.inputs) }
  }
  let outputNode = wrapped ? value.outputNode : undefined
  if (!wrapped) {
    const outputs = entries.filter(([, node]) => node.class_type === 'SaveImage')
    if (outputs.length !== 1) fail('无法确定唯一图片输出，请维护者提供映射文件')
    outputNode = outputs[0][0]
  }
  if (!safeKey(outputNode) || !prompt[outputNode]) fail('指定的图片输出节点不存在')
  const reachable = new Set(), visiting = new Set()
  function visit(id) {
    if (visiting.has(id)) fail('节点之间存在循环')
    if (reachable.has(id)) return
    visiting.add(id)
    for (const value of Object.values(prompt[id].inputs)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1])) {
        if (!prompt[value[0]] || value[1] < 0) fail('节点连接无效')
        visit(value[0])
      }
    }
    visiting.delete(id); reachable.add(id)
  }
  visit(outputNode)
  let bindings = wrapped ? value.bindings : undefined
  if (!wrapped) {
    const samplers = [...reachable].filter(id => ['KSampler', 'KSamplerAdvanced'].includes(prompt[id].class_type))
    if (samplers.length !== 1) fail('无法自动识别采样节点，请维护者提供映射文件')
    const id = samplers[0], node = prompt[id], positive = node.inputs.positive, negative = node.inputs.negative
    if (!Array.isArray(positive) || prompt[positive[0]]?.class_type !== 'CLIPTextEncode' || typeof prompt[positive[0]].inputs.text !== 'string' || positive[0] === negative?.[0]) fail('无法区分正负提示词，请维护者提供映射文件')
    bindings = { positive: [{ node: positive[0], input: 'text' }], seed: [samplerSeedBinding(prompt, id)], batch: [] }
  }
  if (!object(bindings) || Object.keys(bindings).some(key => !['positive', 'seed', 'batch'].includes(key))) fail('映射只能包含 positive、seed、batch')
  const normalized = {}, used = new Set()
  for (const key of ['positive', 'seed', 'batch']) {
    const items = bindings[key] || []
    if (!Array.isArray(items) || items.length > 32 || key === 'positive' && !items.length) fail('正向提示词映射不能为空，单项最多 32 个')
    normalized[key] = items.map(item => {
      if (!object(item) || Object.keys(item).some(key => !['node', 'input'].includes(key)) || !safeKey(item.node) || !safeKey(item.input) || !reachable.has(item.node)) fail('映射指向无效或未连接到输出的节点')
      const value = prompt[item.node].inputs[item.input], slot = item.node + '/' + item.input
      const field = `节点 ${item.node} 的输入 ${item.input}`
      if (used.has(slot)) fail(`映射重复：${field} 已被使用`)
      if (!Object.hasOwn(prompt[item.node].inputs, item.input)) fail(`${field} 不存在，请检查映射字段`)
      if (Array.isArray(value)) fail(`${field} 是节点连接；种子等映射需指向源节点的实际字段，请维护者提供映射文件`)
      if (key === 'positive' && typeof value !== 'string') fail(`${field} 必须是直接填写的字符串`)
      if (key !== 'positive' && !Number.isSafeInteger(value)) fail(`${field} 必须是直接填写的安全整数（绝对值不超过 9007199254740991）`)
      used.add(slot)
      return { node: item.node, input: item.input }
    })
  }
  // Only the selected output's dependencies are submitted. Unrelated saved
  // outputs cannot run a second branch on the user's shared server.
  const selected = Object.fromEntries([...reachable].sort().map(id => [id, prompt[id]]))
  const name = wrapped && typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '已导入工作流'
  const result = { format: 'dsh-tavern-comfy-v1', name, prompt: selected, bindings: normalized, outputNode }
  return { ...result, digest: hash(result) }
}

export function compileComfyWorkflow(workflow, text) {
  const config = comfyWorkflow(workflow)
  if (!config) fail('请先导入工作流')
  if (typeof text !== 'string' || !text.trim() || text.length > 16000) fail('画面提示词为空或过长')
  const prompt = structuredClone(config.prompt), seed = randomInt(0, 2 ** 47)
  for (const item of config.bindings.positive) prompt[item.node].inputs[item.input] = text
  for (const item of config.bindings.seed) prompt[item.node].inputs[item.input] = seed
  for (const item of config.bindings.batch) prompt[item.node].inputs[item.input] = 1
  for (const node of Object.values(prompt)) if (Object.hasOwn(node.inputs, 'batch_size')) {
    if (typeof node.inputs.batch_size !== 'number') fail('批量数量由其他节点控制，请维护者改为单张模板')
    node.inputs.batch_size = 1
  }
  return { prompt, outputNode: config.outputNode, digest: config.digest, ...(config.bindings.seed.length ? { seed } : {}) }
}
