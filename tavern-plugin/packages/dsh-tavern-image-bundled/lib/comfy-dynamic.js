import { comfyWorkflowFields, comfyInputContract } from './comfy-inputs.js'
import { scanWorkflowLoras, applyWorkflowLora } from './comfy-lora.js'

const link = value => Array.isArray(value) && value.length === 2 && Number.isInteger(value[1])
const idFor = (prompt, prefix) => { let id = prefix; while (Object.hasOwn(prompt, id)) id += '_'; return id }
const fail = message => Object.assign(new Error(message), { submissionNotStarted: true })

export function comfyDynamicImageGroup(schema, node, input) {
  const contract = comfyInputContract(schema, input)
  if (!contract || contract.type !== 'IMAGE') return null
  const group = contract.dynamicGroup
  if (!group && !(contract.optional && /^image\d+$/.test(input))) return null
  const inputs = [...new Set([...Object.keys(schema.inputs), ...Object.keys(node.inputs)])]
    .filter(key => group ? key.startsWith(group + '.') : /^image\d+$/.test(key))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const parent = group && schema.inputs[group]
  return { inputs, min: group ? parent?.dynamicMin ?? (parent?.optional ? 0 : 1) : 0 }
}

/** Follow an IMAGE-only path from an explicitly bound loader to an expandable image input. */
export function dynamicImagePlan(workflow, binding, slot = 0) {
  if (workflow.dynamicImages === false || !binding) return null
  const fields = comfyWorkflowFields(workflow)
  const pending = [{ id: binding.node, path: [String(binding.node)] }], found = []
  while (pending.length) {
    const item = pending.shift()
    for (const field of fields.filter(field => field.linked && field.source === item.id)) {
      if (field.type !== 'IMAGE') continue
      const node = workflow.prompt[field.node]
      const group = comfyDynamicImageGroup(workflow.nodeSchemas?.[node.class_type], node, field.input)
      if (group) {
        if (group.inputs[slot] === field.input) found.push({ target: field.node, inputs: group.inputs, min: group.min, path: item.path })
      } else if (!item.path.includes(field.node)) {
        // A transform can be duplicated only when it has one IMAGE input.
        const imageInputs = fields.filter(other => other.node === field.node && other.type === 'IMAGE' && other.linked)
        if (imageInputs.length === 1) pending.push({ id: field.node, path: [...item.path, field.node] })
      }
    }
  }
  if (!found.length || found.some(plan => JSON.stringify(plan.inputs) !== JSON.stringify(found[0].inputs))) return null
  return { ...found[0], min: Math.max(...found.map(plan => plan.min)), targets: found }
}

function referenceImagePlan(workflow, bindings) {
  if (!bindings?.length) return null
  const plan = dynamicImagePlan(workflow, bindings[0])
  if (!plan) return null
  const signature = value => JSON.stringify(value.targets.map(target => [target.target, target.inputs]).sort((a,b) => a[0].localeCompare(b[0])))
  for (let index = 1; index < bindings.length; index++) {
    const other = dynamicImagePlan(workflow, bindings[index], index)
    if (!other || signature(other) !== signature(plan)) return null
  }
  return plan
}

export function comfyReferenceCapacity(workflow, bindings) {
  const plan = referenceImagePlan(workflow, bindings)
  return plan ? plan.inputs.length : bindings?.length || 0
}

/** Expand a per-job clone; the saved graph remains a reusable single-image template. */
export function expandComfyImageInputs(workflow, bindings, count) {
  const plan = referenceImagePlan(workflow, bindings)
  if (!plan || bindings.length > 1 && count <= bindings.length) return { workflow, bindings }
  if (count > plan.inputs.length) throw fail('这个工作流最多支持 ' + plan.inputs.length + ' 张输入图片')
  if (count < plan.min) throw fail('该工作流的图片输入至少需要 ' + plan.min + ' 张参考图')
  const prompt = structuredClone(workflow.prompt), expanded = [...bindings]
  // Positive and negative encoders share cloned loaders and transforms.
  const paths = [...new Set(plan.targets.flatMap(target => target.path))]
  for (const target of plan.targets) for (const field of target.inputs) {
    if (bindings.length === 1 && field !== target.inputs[0]) delete prompt[target.target].inputs[field]
  }
  for (let index = bindings.length; index < count; index++) {
    const ids = new Map(paths.map(id => [id, idFor(prompt, 'dsh_image_' + (index + 1) + '_' + id)]))
    for (const id of paths) {
      const node = structuredClone(workflow.prompt[id])
      for (const [key, value] of Object.entries(node.inputs)) if (link(value) && ids.has(String(value[0]))) node.inputs[key] = [ids.get(String(value[0])), value[1]]
      prompt[ids.get(id)] = node
    }
    for (const target of plan.targets) {
      const finalLink = workflow.prompt[target.target].inputs[target.inputs[0]]
      prompt[target.target].inputs[target.inputs[index]] = [ids.get(String(finalLink[0])), finalLink[1]]
    }
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
