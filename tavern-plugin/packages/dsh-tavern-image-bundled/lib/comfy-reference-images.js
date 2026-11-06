const record = value => value && typeof value === 'object' && !Array.isArray(value)

function compareNodeIds(a, b) {
  const left = String(a), right = String(b)
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const x = BigInt(left), y = BigInt(right)
    return x < y ? -1 : x > y ? 1 : 0
  }
  return left.localeCompare(right, 'en', { numeric: true })
}

/** LoadImage nodes are the only safe generic ComfyUI reference inputs. */
export function comfyLoadImageBindings(workflow) {
  if (!record(workflow?.prompt)) throw new Error('ComfyUI 工作流 prompt 格式不正确')
  const nodes = Object.entries(workflow.prompt)
    .filter(([, node]) => node?.class_type === 'LoadImage')
    .sort(([a], [b]) => compareNodeIds(a, b))
    .map(([node, value]) => {
      if (!record(value.inputs) || !Object.hasOwn(value.inputs, 'image') || typeof value.inputs.image !== 'string') {
        throw new Error(`ComfyUI LoadImage 节点 ${node} 缺少可替换的 image 输入`)
      }
      return { node, input: 'image' }
    })
  const configured = workflow.bindings?.referenceImages
  if (configured !== undefined) {
    if (!Array.isArray(configured)) throw new Error('workflow bindings.referenceImages 必须是节点映射数组')
    if (configured.length) {
      const seen = new Set()
      return configured.map(binding => {
        const node = String(binding?.node ?? '')
        const input = String(binding?.input ?? '')
        if (input !== 'image' || !nodes.some(item => item.node === node) || seen.has(node)) {
          throw new Error('workflow bindings.referenceImages 只能指向不同 LoadImage 节点的 image 输入')
        }
        seen.add(node)
        return { node, input }
      })
    }
  }
  if (nodes.length > 1) throw new Error(`当前 workflow 有 ${nodes.length} 个 LoadImage 节点，无法判断哪些接收角色/服装参考图；请在 workflow bindings 中明确配置 referenceImages`)
  return nodes
}

export function applyComfyReferenceImages(workflow, imageNames) {
  if (!Array.isArray(imageNames) || imageNames.some(name => typeof name !== 'string' || !name.trim())) {
    throw new Error('ComfyUI 参考图上传结果无效')
  }
  const bindings = comfyLoadImageBindings(workflow)
  if (!bindings.length) throw new Error('当前 ComfyUI 工作流没有 LoadImage 接图节点；请调整并重新导入完整 workflow 后再提交')
  if (imageNames.length > bindings.length) {
    throw new Error(`当前 ComfyUI 工作流只有 ${bindings.length} 个 LoadImage 接图节点，选中的参考图有 ${imageNames.length} 张；请调整 workflow 后再提交`)
  }
  const prompt = structuredClone(workflow.prompt)
  for (let index = 0; index < imageNames.length; index++) {
    const binding = bindings[index]
    prompt[binding.node].inputs[binding.input] = imageNames[index]
  }
  return { prompt, bindings: bindings.slice(0, imageNames.length) }
}

