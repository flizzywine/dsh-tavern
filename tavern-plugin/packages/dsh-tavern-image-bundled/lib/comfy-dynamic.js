import { comfyWorkflowFields } from './comfy-inputs.js'
import { scanWorkflowLoras, applyWorkflowLora } from './comfy-lora.js'

const link = value => Array.isArray(value) && value.length === 2 && Number.isInteger(value[1])
const idFor = (prompt, prefix) => { let id = prefix; while (Object.hasOwn(prompt, id)) id += '_'; return id }
const fail = message => Object.assign(new Error(message), { submissionNotStarted: true })

/** Follow an IMAGE-only path from an explicitly bound loader to an expandable image input. */
export function dynamicImagePlan(workflow, binding) {
  if (workflow.dynamicImages === false || !binding) return null
  const fields = comfyWorkflowFields(workflow)
  const pending = [{ id: binding.node, path: [String(binding.node)] }], found = []
  while (pending.length) {
    const item = pending.shift()
    for (const field of fields.filter(field => field.linked && field.source === item.id)) {
      if (field.type !== 'IMAGE') continue
      const contract = workflow.nodeSchemas?.[workflow.prompt[field.node].class_type]?.inputs?.[field.input]
      if (contract?.dynamicGroup || contract?.optional && /^image\d+$/.test(field.input)) {
        const candidates = Object.keys(workflow.nodeSchemas[workflow.prompt[field.node].class_type].inputs)
          .filter(key => contract.dynamicGroup ? key.startsWith(contract.dynamicGroup + '.') : /^image\d+$/.test(key))
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        if (candidates[0] === field.input) found.push({ target: field.node, inputs: candidates, path: item.path })
      } else if (!item.path.includes(field.node)) {
        // A transform can be duplicated only when it has one IMAGE input.
        const imageInputs = fields.filter(other => other.node === field.node && other.type === 'IMAGE' && other.linked)
        if (imageInputs.length === 1) pending.push({ id: field.node, path: [...item.path, field.node] })
      }
    }
  }
  return found.length === 1 ? found[0] : null
}

export function comfyReferenceCapacity(workflow, bindings) {
  const plan = bindings?.length === 1 ? dynamicImagePlan(workflow, bindings[0]) : null
  return plan ? plan.inputs.length : bindings?.length || 0
}

/** Expand a per-job clone; the saved graph remains a reusable single-image template. */
export function expandComfyImageInputs(workflow, bindings, count) {
  const plan = bindings.length === 1 ? dynamicImagePlan(workflow, bindings[0]) : null
  if (!plan) return { workflow, bindings }
  if (count > plan.inputs.length) throw fail('这个工作流最多支持 ' + plan.inputs.length + ' 张输入图片')
  const prompt = structuredClone(workflow.prompt), expanded = [bindings[0]]
  // Managed dynamic slots never retain pictures from an earlier edit.
  for (const field of plan.inputs) if (field !== plan.inputs[0]) delete prompt[plan.target].inputs[field]
  const finalLink = workflow.prompt[plan.target].inputs[plan.inputs[0]]
  for (let index = 1; index < count; index++) {
    const ids = new Map(plan.path.map(id => [id, idFor(prompt, 'dsh_image_' + (index + 1) + '_' + id)]))
    for (const id of plan.path) {
      const node = structuredClone(workflow.prompt[id])
      for (const [key, value] of Object.entries(node.inputs)) if (link(value) && ids.has(String(value[0]))) node.inputs[key] = [ids.get(String(value[0])), value[1]]
      prompt[ids.get(id)] = node
    }
    prompt[plan.target].inputs[plan.inputs[index]] = [ids.get(String(finalLink[0])), finalLink[1]]
    expanded.push({ node: ids.get(String(bindings[0].node)), input: bindings[0].input })
  }
  return { workflow: { ...workflow, prompt }, bindings: expanded }
}

export function normalizeImageMentions(text, count) {
  return String(text ?? '').replace(/<image\s*(\d+)>|\bimage\s*<\s*(\d+)\s*>/gi, (_all, a, b) => {
    const index = Number(a || b)
    if (index < 1 || index > count) throw fail('提示词引用了 image' + index + '，本次只提供了 ' + count + ' 张图片')
    return '<image' + index + '>'
  })
}

export function normalizeCharacterLoras(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).flatMap(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || typeof item.workflowId !== 'string' || !item.workflowId.trim()) return []
    const strength = key => item[key] == null || item[key] === '' ? 1 : Number(item[key])
    if (![strength('strengthModel'), strength('strengthClip')].every(n => Number.isFinite(n) && Math.abs(n) <= 10)) return []
    return [{ workflowId: item.workflowId.slice(0, 240), node: String(item.node || '').slice(0, 120), name: item.name.trim().slice(0, 240),
      strengthModel: strength('strengthModel'), strengthClip: strength('strengthClip'), enabled: item.enabled !== false }]
  })
}

/** Append to rgthree slots or a standard MODEL/CLIP chain, never a guessed model input. */
export function applyDynamicLoras(prompt, requests) {
  const applied = [], seen = new Map(), tails = new Map()
  for (const request of requests.filter(item => item.enabled !== false)) {
    const identity = String(request.node || '') + '\n' + request.name
    if (seen.has(identity)) {
      const previous = seen.get(identity)
      if (previous.strengthModel !== request.strengthModel || previous.strengthClip !== request.strengthClip) throw fail('同一个人物 LoRA 的强度设置冲突：' + request.name)
      continue
    }
    seen.set(identity, request)
    let existing = scanWorkflowLoras(prompt)
    const terminals = [...new Set(existing.map(item => item.node))].filter(id => !existing.some(item => item.node !== id && link(prompt[item.node]?.inputs?.model) && String(prompt[item.node].inputs.model[0]) === id))
    const roots = Object.keys(prompt).filter(id => /^(UNETLoader|CheckpointLoaderSimple)$/.test(prompt[id].class_type))
    const target = tails.get(request.node) || request.node || (terminals.length === 1 ? terminals[0] : !terminals.length && roots.length === 1 ? roots[0] : '')
    if (!target || !prompt[target]) throw fail('人物 LoRA 需要指定一个已连接的 LoRA 加载节点')
    const matched = existing.find(item => item.node === target && item.name === request.name)
    if (matched) { applied.push(applyWorkflowLora(prompt, { ...matched, ...request, node: target, slot: matched.slot })); continue }
    const original = prompt[target]
    if (/Power Lora Loader/i.test(original.class_type)) {
      const next = Math.max(0, ...Object.keys(original.inputs).map(key => Number(/^lora_(\d+)$/.exec(key)?.[1] || 0))) + 1
      const slot = 'lora_' + next
      original.inputs[slot] = { on: true, lora: request.name, strength: request.strengthModel ?? 1, strengthTwo: request.strengthClip ?? request.strengthModel ?? 1 }
      applied.push(applyWorkflowLora(prompt, { ...request, node: target, slot }))
    } else if (/^(LoraLoader|LoraLoaderModelOnly)$/.test(original.class_type)) {
      const id = idFor(prompt, 'dsh_lora_' + applied.length)
      const node = structuredClone(original)
      node.inputs.model = [target, 0]
      if (original.class_type === 'LoraLoader') node.inputs.clip = [target, 1]
      for (const item of Object.values(prompt)) for (const [key, value] of Object.entries(item.inputs || {})) {
        if (link(value) && String(value[0]) === target && (value[1] === 0 || original.class_type === 'LoraLoader' && value[1] === 1)) item.inputs[key] = [id, value[1]]
      }
      prompt[id] = node
      applied.push(applyWorkflowLora(prompt, { ...request, node: id }))
      if (request.node) tails.set(request.node, id)
    } else if (/^(UNETLoader|CheckpointLoaderSimple)$/.test(original.class_type)) {
      const full = original.class_type === 'CheckpointLoaderSimple', id = idFor(prompt, 'dsh_lora_' + applied.length)
      for (const item of Object.values(prompt)) for (const [key, value] of Object.entries(item.inputs || {})) {
        if (link(value) && String(value[0]) === target && (value[1] === 0 || full && value[1] === 1)) item.inputs[key] = [id, value[1]]
      }
      prompt[id] = { class_type: full ? 'LoraLoader' : 'LoraLoaderModelOnly', inputs: { model: [target, 0], ...(full ? { clip: [target, 1], strength_clip: 1 } : {}), lora_name: request.name, strength_model: 1 } }
      applied.push(applyWorkflowLora(prompt, { ...request, node: id }))
    } else throw fail('这个自定义 LoRA 节点尚不支持自动扩展，请在工作流里配置对应槽位')
  }
  return applied.filter(Boolean)
}
