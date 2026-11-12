const number = (value, fallback) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback
export const loraBindingKey = binding => binding.slot ? String(binding.node) + ':' + binding.slot : String(binding.node)

function slotsOf(node) {
  const inputs = node?.inputs ?? {}
  const type = String(node?.class_type ?? '')
  const slots = new Map()
  const add = (slot, target, name, model, clip, enabled) => {
    if (typeof target?.[name] !== 'string' || typeof target?.[model] !== 'number') return
    slots.set(slot, { target, name, model, clip: typeof target[clip] === 'number' ? clip : '', enabled })
  }
  if (!type || /lora|efficient loader/i.test(type)) {
    const name = ['lora_name', 'loraName', 'lora'].find(key => typeof inputs[key] === 'string')
    const model = ['strength_model', 'lora_model_strength', 'lora_strength', 'strength'].find(key => typeof inputs[key] === 'number')
    const clip = ['strength_clip', 'lora_clip_strength', 'lora_strength_clip', 'clip_strength'].find(key => typeof inputs[key] === 'number')
    if (name && model) add('', inputs, name, model, clip)
  }
  if (!/lora/i.test(type)) return slots
  const stack = Array.isArray(inputs.loras) ? inputs.loras : inputs.loras?.__value__
  if (Array.isArray(stack)) stack.forEach((entry, index) => add('stack:' + index, entry, 'name', 'strength', 'clipStrength', 'active'))
  const numbered = Object.keys(inputs).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  for (const key of numbered) {
    if (/^lora_\d+$/.test(key)) add(key, inputs[key], 'lora', 'strength', 'strengthTwo', 'on')
    const match = /^lora_name_?(\d+)$/.exec(key)
    if (!match) continue
    const suffix = match[1]
    const model = ['model_weight_', 'model_strength_', 'strength_model_'].map(prefix => prefix + suffix).find(field => typeof inputs[field] === 'number')
    const clip = ['clip_weight_', 'clip_strength_', 'strength_clip_'].map(prefix => prefix + suffix).find(field => typeof inputs[field] === 'number')
    if (model) add(key, inputs, key, model, clip)
  }
  if (/lora.*tag|tag.*lora/i.test(type)) {
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value !== 'string') continue
      const pattern = /<lora:([^:>]+):(-?\d+(?:\.\d+)?)(?::(-?\d+(?:\.\d+)?))?>/gi
      const tags = [...value.matchAll(pattern)]
      for (const [index, match] of tags.entries()) {
        const target = { name: match[1], strength: Number(match[2]), clipStrength: Number(match[3] ?? match[2]) }
        const field = { target, name: 'name', model: 'strength', clip: 'clipStrength',
          write() {
            let at = 0
            inputs[key] = inputs[key].replace(pattern, original => {
              if (at++ !== index) return original
              return '<lora:' + target.name + ':' + target.strength + ':' + target.clipStrength + '>'
            })
          } }
        slots.set('tag:' + key + ':' + index, field)
      }
    }
  }
  return slots
}

export function scanWorkflowLoras(prompt, saved = []) {
  const existing = new Map(saved.map(binding => [loraBindingKey(binding), binding]))
  const bindings = Object.entries(prompt ?? {}).flatMap(([node, value]) => Array.from(slotsOf(value), ([slot, field]) => {
    const strengthModel = field.target[field.model]
    const strengthClip = field.clip ? field.target[field.clip] : undefined
    return { node, ...(slot ? { slot } : {}), input: slot || field.name, name: field.target[field.name],
      strengthModel, strengthClip, enabled: field.enabled ? field.target[field.enabled] !== false : true,
      ...existing.get(loraBindingKey({ node, slot })) }
  }))
  const depth = new Map()
  for (const binding of bindings) {
    const seen = new Set()
    let current = binding.node
    while (current && !seen.has(current)) {
      seen.add(current)
      const link = prompt[current]?.inputs?.model
      current = Array.isArray(link) ? String(link[0]) : ''
    }
    depth.set(binding.node, seen.size)
  }
  return bindings.sort((a, b) => depth.get(a.node) - depth.get(b.node))
}

export function loraOrderPairs(prompt, bindings) {
  const pairs = []
  for (let i = 0; i + 1 < bindings.length; i++) {
    const [a, b] = [bindings[i], bindings[i + 1]]
    const first = slotsOf(prompt[a.node]).get(a.slot || '')
    const second = slotsOf(prompt[b.node]).get(b.slot || '')
    if (!first || !second || Boolean(first.clip) !== Boolean(second.clip)) continue
    const inputs = prompt[b.node]?.inputs ?? {}
    const directlyLinked = Array.isArray(inputs.model) && String(inputs.model[0]) === a.node &&
      (!first.clip || Array.isArray(inputs.clip) && String(inputs.clip[0]) === a.node)
    const sameStack = a.node === b.node && a.slot && b.slot
    if (sameStack || (!a.slot && !b.slot && directlyLinked)) pairs.push([loraBindingKey(a), loraBindingKey(b)])
  }
  return pairs
}

export function applyWorkflowLora(prompt, binding) {
  const field = slotsOf(prompt[binding.node]).get(binding.slot || '')
  if (!field) return null
  const { target, model, clip, enabled, name } = field
  if (binding.name) {
    if (field.write && /[<>:]/.test(binding.name)) throw new Error('标签 LoRA 文件名不能包含尖括号或冒号')
    target[name] = String(binding.name)
  }
  const modelWeight = number(binding.strengthModel, target[model])
  const clipWeight = clip ? number(binding.strengthClip, target[clip]) : undefined
  if (enabled) target[enabled] = binding.enabled !== false
  target[model] = !enabled && binding.enabled === false ? 0 : modelWeight
  if (clip) target[clip] = !enabled && binding.enabled === false ? 0 : clipWeight
  field.write?.()
  const result = { node: binding.node, ...(binding.slot ? { slot: binding.slot } : {}), name: target[name] }
  return binding.enabled === false ? { ...result, off: true } : { ...result, model: modelWeight, clip: clipWeight }
}
