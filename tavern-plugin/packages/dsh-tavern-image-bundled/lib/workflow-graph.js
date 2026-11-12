import { validateComfyImageBindings } from './comfy-reference-images.js'
import { scanWorkflowLoras, applyWorkflowLora, loraBindingKey } from './comfy-lora.js'
import { createHash } from 'node:crypto'

export const workflowRevision = raw => createHash('sha256').update(JSON.stringify(raw)).digest('hex')
const own = (obj, key) => Object.hasOwn(obj ?? {}, key)
const record = value => value && typeof value === 'object' && !Array.isArray(value)

/** Modify parameters without replacing the graph, bindings or extension metadata. */
export function patchWorkflowGraph(raw, patch, revision) {
  if (revision !== workflowRevision(raw)) throw new Error('工作流已被其他操作修改，请重新打开后再保存')
  if (!record(patch) || !record(raw?.prompt)) throw new Error('工作流图格式不正确')
  const next = structuredClone(raw)
  if (patch.inputs !== undefined && !record(patch.inputs)) throw new Error('节点参数格式不正确')
  for (const [id, fields] of Object.entries(patch.inputs ?? {})) {
    if (!own(next.prompt, id) || !record(fields)) throw new Error('节点不存在或参数格式不正确')
    const inputs = next.prompt[id].inputs
    for (const [field, value] of Object.entries(fields)) {
      if (!own(inputs, field) || !['string', 'number', 'boolean'].includes(typeof inputs[field])) throw new Error('只能修改已有的普通参数，节点连线不可改写')
      if (typeof inputs[field] !== typeof value || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 100000)) throw new Error('参数类型或数值不正确')
      inputs[field] = value
    }
    // LoRA bindings are applied at generation time; keep them in sync with the editor.
    for (const lora of next.bindings?.loras ?? []) {
      if (String(lora.node) !== id) continue
      if (own(fields, 'lora_name')) lora.name = fields.lora_name
      if (own(fields, 'strength_model')) lora.strengthModel = fields.strength_model
      if (own(fields, 'strength_clip')) lora.strengthClip = fields.strength_clip
    }
  }
  if (patch.connections !== undefined) {
    if (!Array.isArray(patch.connections) || patch.connections.length > 200) throw new Error('连线修改格式不正确')
    for (const change of patch.connections) {
      const node = next.prompt[change.node], source = next.prompt[change.source]
      const contract = next.nodeSchemas?.[node?.class_type]?.inputs?.[change.input]
      const outputs = next.nodeSchemas?.[source?.class_type]?.outputs
      const type = outputs?.[change.output]
      if (!node || !source || !contract || !Number.isInteger(change.output) || change.output < 0 || !type
        || type !== '*' && contract.type !== '*' && type !== contract.type) throw new Error('连线两端的数据类型不匹配，请先识别节点')
      node.inputs[change.input] = [String(change.source), change.output]
      // Literal bindings may no longer write over a newly connected input.
      for (const [key, bindings] of Object.entries(next.bindings || {})) if (Array.isArray(bindings) && key !== 'loras') {
        next.bindings[key] = bindings.filter(item => String(item.node) !== String(change.node) || item.input !== change.input)
      }
      const visited = new Set(), active = new Set()
      const visit = id => {
        if (active.has(id)) throw new Error('这条连线会形成循环')
        if (visited.has(id)) return
        active.add(id)
        for (const value of Object.values(next.prompt[id]?.inputs || {})) if (Array.isArray(value) && value.length === 2 && own(next.prompt, String(value[0]))) visit(String(value[0]))
        active.delete(id); visited.add(id)
      }
      visit(String(change.node))
    }
  }
  if (patch.loras !== undefined) {
    if (!Array.isArray(patch.loras)) throw new Error('LoRA 修改格式不正确')
    const bindings = new Map(scanWorkflowLoras(next.prompt, next.bindings?.loras).map(item => [loraBindingKey(item), item]))
    for (const change of patch.loras) {
      const previous = bindings.get(loraBindingKey(change))
      if (!previous || typeof change.name !== 'string' || !change.name.trim() || ![change.strengthModel, change.strengthClip ?? 1].every(value => Number.isFinite(value) && Math.abs(value) <= 10)) throw new Error('LoRA 文件或强度无效')
      const updated = { ...previous, name: change.name, enabled: change.enabled !== false, strengthModel: change.strengthModel, strengthClip: change.strengthClip }
      applyWorkflowLora(next.prompt, updated)
      bindings.set(loraBindingKey(change), updated)
    }
    next.bindings = { ...next.bindings, loras: [...bindings.values()] }
  }
  if (patch.dynamicImages !== undefined) {
    if (typeof patch.dynamicImages !== 'boolean') throw new Error('动态图片输入设置无效')
    next.dynamicImages = patch.dynamicImages
  }
  if (patch.referenceImages !== undefined) {
    next.bindings = { ...next.bindings, referenceImages: validateComfyImageBindings(next, patch.referenceImages) }
  }
  if (patch.outputNode !== undefined) {
    const node = next.prompt[patch.outputNode]
    const schema = next.nodeSchemas?.[node?.class_type]
    if (!own(next.prompt, patch.outputNode) || !(/SaveImage|PreviewImage/i.test(node.class_type)
      || schema?.outputNode && Object.values(schema.inputs || {}).some(input => input.type === 'IMAGE'))) {
      throw new Error('请选择图片输出节点')
    }
    next.outputNode = patch.outputNode
  }
  if (patch.positions !== undefined) {
    if (!record(patch.positions)) throw new Error('节点位置格式不正确')
    next.graphPositions = { ...(next.graphPositions ?? {}) }
    for (const [id, position] of Object.entries(patch.positions)) {
      if (!own(next.prompt, id) || !record(position) || ![position.x, position.y].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)) throw new Error('节点位置超出范围')
      next.graphPositions[id] = { x: position.x, y: position.y }
    }
  }
  if (patch.inputs && next.bindings?.referenceImages?.length) validateComfyImageBindings(next, next.bindings.referenceImages)
  return next
}
