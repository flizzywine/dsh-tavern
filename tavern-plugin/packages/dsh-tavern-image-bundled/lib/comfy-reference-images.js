import { expandComfyImageInputs } from './comfy-dynamic.js'
import { comfyWorkflowFields, comfyFieldKey, comfyPromptMarkers, validateComfyTextBindings } from './comfy-inputs.js'
const record = value => value && typeof value === 'object' && !Array.isArray(value)

function compareNodeIds(a, b) {
  const left = String(a), right = String(b)
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const x = BigInt(left), y = BigInt(right)
    return x < y ? -1 : x > y ? 1 : 0
  }
  return left.localeCompare(right, 'en', { numeric: true })
}

export function validateComfyImageBindings(workflow, bindings) {
  let fields
  try { fields = validateComfyTextBindings(workflow, bindings, '参考图映射') }
  catch { throw new Error('workflow bindings.referenceImages 只能指向不同 LoadImage 或自定义加载节点的可写文字字段') }
  const markers = comfyPromptMarkers(workflow.prompt)
  const promptFields = new Set([...markers.positive, ...markers.negative].map(comfyFieldKey))
  if (fields.some(field => promptFields.has(comfyFieldKey(field)))) throw new Error('同一个字段不能同时接入提示词和参考图')
  return fields
}

/** Uploaded filenames can target any explicitly selected literal input. */
export function comfyLoadImageBindings(workflow) {
  if (!record(workflow?.prompt)) throw new Error('ComfyUI 工作流 prompt 格式不正确')
  const nodes = comfyWorkflowFields(workflow).filter(field => field.image && field.editable
    && typeof workflow.prompt[field.node].inputs[field.input] === 'string')
    .sort((a, b) => compareNodeIds(a.node, b.node))
    .map(({ node, input }) => ({ node, input }))
  const configured = workflow.bindings?.referenceImages
  if (configured !== undefined) {
    if (!Array.isArray(configured)) throw new Error('workflow bindings.referenceImages 必须是节点映射数组')
    if (configured.length) return validateComfyImageBindings(workflow, configured)
  }
  if (nodes.length > 1) throw new Error('当前 workflow 有 ' + nodes.length + ' 个图片加载字段，无法判断哪些接收角色/服装参考图；请在 workflow bindings 中明确配置 referenceImages')
  return nodes
}

// Remove an unused image branch only when every live route ends at an optional image input.
function detachOptionalImageBranch(workflow, prompt, start) {
  const schema = workflow.nodeSchemas || {}
  const roots = Object.keys(prompt).filter(id => id === String(workflow.outputNode || '')
    || schema[prompt[id]?.class_type]?.outputNode === true || /^(SaveImage|PreviewImage)$/.test(prompt[id]?.class_type || ''))
  if (!roots.length) return false
  const live = new Set()
  const visit = id => {
    if (live.has(id) || !prompt[id]) return
    live.add(id)
    for (const value of Object.values(prompt[id].inputs || {})) {
      if (Array.isArray(value) && value.length === 2 && Number.isInteger(value[1]) && prompt[String(value[0])]) visit(String(value[0]))
    }
  }
  roots.forEach(visit)
  if (!live.has(start)) return true
  const removals = [], seen = new Set()
  function walk(id) {
    if (seen.has(id)) return false
    seen.add(id)
    const source = prompt[id], outputTypes = schema[source.class_type]?.outputs
    const uses = []
    for (const target of live) for (const [input, value] of Object.entries(prompt[target]?.inputs || {})) {
      if (!Array.isArray(value) || value.length !== 2 || String(value[0]) !== id || !Number.isInteger(value[1])) continue
      uses.push({ target, input, output: value[1] })
    }
    if (!uses.length) return false
    for (const use of uses) {
      const sourceType = outputTypes?.[use.output] || (/^(LoadImage)$/.test(source.class_type) && use.output === 0 ? 'IMAGE' : '')
      const target = prompt[use.target], targetSchema = schema[target.class_type]
      const contract = targetSchema?.inputs?.[use.input]
      if (sourceType !== 'IMAGE' || contract?.type !== 'IMAGE') return false
      if (contract.optional === true || contract.dynamicGroup) {
        const group = contract.dynamicGroup
        const first = group && Object.keys(targetSchema.inputs).filter(key => targetSchema.inputs[key]?.dynamicGroup === group)
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0]
        if (group && targetSchema.inputs[group]?.optional !== true && first === use.input) return false
        removals.push([use.target, use.input])
      }
      else {
        // Only pass through a known, single-image-input transform with no other outputs.
        const imageInputs = Object.values(targetSchema?.inputs || {}).filter(item => item.type === 'IMAGE' && !item.optional)
        if (targetSchema?.outputNode || imageInputs.length !== 1 || !Array.isArray(targetSchema?.outputs)
          || targetSchema.outputs.length !== 1 || targetSchema.outputs[0] !== 'IMAGE' || !walk(use.target)) return false
      }
    }
    return true
  }
  if (!walk(start)) return false
  for (const [node, input] of removals) delete prompt[node].inputs[input]
  return true
}

export function applyComfyReferenceImages(workflow, imageNames) {
  if (!Array.isArray(imageNames) || imageNames.some(name => typeof name !== 'string' || !name.trim())) {
    throw new Error('ComfyUI 参考图上传结果无效')
  }
  const expanded = expandComfyImageInputs(workflow, comfyLoadImageBindings(workflow), imageNames.length)
  workflow = expanded.workflow
  const bindings = expanded.bindings
  if (!bindings.length) throw new Error('当前 ComfyUI 工作流没有图片加载字段；请调整并重新导入完整 workflow 后再提交')
  if (imageNames.length > bindings.length) {
    throw new Error(`当前 ComfyUI 工作流只有 ${bindings.length} 个图片加载字段，选中的参考图有 ${imageNames.length} 张；请调整 workflow 后再提交`)
  }
  const prompt = structuredClone(workflow.prompt)
  const fields = new Map(comfyWorkflowFields(workflow).map(field => [comfyFieldKey(field), field]))
  for (let index = 0; index < imageNames.length; index++) {
    const binding = bindings[index]
    const field = fields.get(comfyFieldKey(binding))
    const name = imageNames[index]
    prompt[binding.node].inputs[binding.input] = field?.verified && field.image && field.imageFolder !== 'input' && !/\[(?:input|output|temp)\]$/.test(name)
      ? name + ' [input]' : name
  }
  // An empty LoadImage resolves to ComfyUI's input directory and fails inside
  // the image decoder. Detach optional branches or stop before any upload.
  const imageFields = comfyWorkflowFields({ ...workflow, prompt }).filter(field => field.image && field.editable)
  for (const field of imageFields) {
    if (!field.image || !field.editable || typeof field.node !== 'string') continue
    const value = prompt[field.node]?.inputs?.[field.input]
    if (typeof value !== 'string' || value.trim()) continue
    const sharesNode = imageFields.some(other => other.node === field.node && other.input !== field.input
      && typeof prompt[other.node]?.inputs?.[other.input] === 'string' && prompt[other.node].inputs[other.input].trim())
    if (sharesNode || !detachOptionalImageBranch(workflow, prompt, field.node)) {
      throw Object.assign(new Error('工作流图片节点 #' + field.node + '（' + field.input + '）没有图片；请补充参考图或在工作流中配置该节点的图片'), { submissionNotStarted: true })
    }
  }
  return { prompt, bindings: bindings.slice(0, imageNames.length) }
}

