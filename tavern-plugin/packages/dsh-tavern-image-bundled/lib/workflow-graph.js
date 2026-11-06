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
  if (patch.positions !== undefined) {
    if (!record(patch.positions)) throw new Error('节点位置格式不正确')
    next.graphPositions = { ...(next.graphPositions ?? {}) }
    for (const [id, position] of Object.entries(patch.positions)) {
      if (!own(next.prompt, id) || !record(position) || ![position.x, position.y].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)) throw new Error('节点位置超出范围')
      next.graphPositions[id] = { x: position.x, y: position.y }
    }
  }
  return next
}
