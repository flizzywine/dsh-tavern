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
  return { prompt, bindings: bindings.slice(0, imageNames.length) }
}

