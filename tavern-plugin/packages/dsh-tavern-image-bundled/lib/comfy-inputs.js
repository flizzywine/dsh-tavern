const object = value => value && typeof value === 'object' && !Array.isArray(value)
export const comfyFieldKey = binding => JSON.stringify([String(binding.node), String(binding.input)])
const promptToken = /%(prompt|negative)(?![a-zA-Z0-9_])/g

/** Retain the input contract, without copying installed model or filename catalogues. */
export function compactComfySchema(info) {
  if (!object(info?.input)) return null
  const inputs = Object.create(null)
  for (const group of ['required', 'optional']) {
    for (const [key, spec] of Object.entries(info.input[group] || {})) {
      if (!Array.isArray(spec)) continue
      const options = object(spec[1]) ? spec[1] : {}
      const choices = Array.isArray(spec[0]) ? spec[0] : spec[0] === 'COMBO' && Array.isArray(options.options) ? options.options : null
      inputs[key] = {
        type: Array.isArray(spec[0]) ? 'COMBO' : String(spec[0]),
        optional: group === 'optional',
        ...(['string', 'number', 'boolean'].includes(typeof options.default) ? { default: options.default } : {}),
        ...(options.multiline === true ? { multiline: true } : {}),
        ...(options.image_upload === true ? { imageUpload: true, imageFolder: String(options.image_folder || 'input') } : {}),
        ...(options.forceInput === true ? { forceInput: true } : {}),
        ...(choices && choices.length <= 80 && choices.every(item => typeof item === 'string' && item.length <= 240)
          && options.image_upload !== true ? { choices } : {}),
        ...Object.fromEntries(['min', 'max', 'step'].filter(key => Number.isFinite(options[key])).map(key => [key, options[key]])),
      }
      if (spec[0] === 'COMFY_AUTOGROW_V3' && Array.isArray(options.template?.names)) {
        const child = Object.values(options.template.input?.required || {})[0]
        if (Array.isArray(child) && typeof child[0] === 'string') for (const name of options.template.names.slice(0, 32)) {
          inputs[key + '.' + name] = { type: child[0], optional: true, dynamicGroup: key, dynamicIndex: name }
        }
      }
    }
  }
  return { name: String(info.display_name || info.name || ''), inputs, outputNode: info.output_node === true, outputs: Array.isArray(info.output) ? info.output : [] }
}

/** Enumerate literal fields and typed links for any installed custom node. */
export function comfyWorkflowFields(workflow) {
  const fields = []
  for (const [node, value] of Object.entries(workflow?.prompt || {})) {
    if (!object(value)) continue
    const schema = workflow.nodeSchemas?.[value.class_type]
    for (const [input, current] of Object.entries(value.inputs || {})) {
      const contract = schema?.inputs?.[input]
      const linked = Array.isArray(current) && current.length === 2 && typeof current[1] === 'number'
        && Object.hasOwn(workflow.prompt, String(current[0]))
      const primitive = ['string', 'number', 'boolean'].includes(typeof current)
      if (!primitive && !linked) continue
      const parameter = /^(?:clip_name|ckpt_name|unet_name|vae_name|lora_name|loraName|model_name|filename_prefix|device|type|weight_dtype|dtype|precision|sampler_name|scheduler|mode|upscale_method|aspect_ratio|control_after_generate)$/i.test(input)
      const image = contract?.imageUpload === true || (!contract && typeof current === 'string'
        && (/^(?:LoadImage|LoadImageMask)$/.test(value.class_type) && input === 'image'
          || /(?:load|read|import|input).*image|image.*(?:load|read|import|input)/i.test(value.class_type)
            && /^(?:image|filename|file|path|image_path|file_path)$/i.test(input)))
      fields.push({
        node, input, classType: value.class_type, title: String(value._meta?.title || schema?.name || value.class_type || node),
        type: contract?.type || (linked ? 'LINK' : typeof current === 'string' ? 'STRING?' : typeof current === 'number' ? 'NUMBER' : 'BOOLEAN'),
        linked, editable: primitive && contract?.forceInput !== true, image, imageFolder: contract?.imageFolder || 'input',
        multiline: contract?.multiline === true, verified: Boolean(contract),
        ...(linked ? { source: String(current[0]), output: current[1] } : {}),
        ...(typeof current === 'string' ? { text: !parameter && (!contract || contract.type === 'STRING' && !contract.forceInput) } : {}),
      })
    }
  }
  return fields
}

export function comfyPromptMarkers(prompt) {
  const markers = { positive: [], negative: [] }
  for (const [node, value] of Object.entries(prompt || {})) {
    for (const [input, text] of Object.entries(value.inputs || {})) {
      if (typeof text !== 'string') continue
      const tokens = [...text.matchAll(promptToken)].map(match => match[1])
      if (tokens.includes('prompt')) markers.positive.push({ node, input })
      if (tokens.includes('negative')) markers.negative.push({ node, input })
    }
  }
  return markers
}

/** One replacement pass keeps tokens in the generated text literal. */
export function applyComfyPromptMarkers(prompt, original, positive, negative) {
  for (const [id, node] of Object.entries(original || {})) {
    for (const [input, text] of Object.entries(node.inputs || {})) {
      if (typeof text === 'string' && [...text.matchAll(promptToken)].length) {
        prompt[id].inputs[input] = text.replace(promptToken, (_match, role) => role === 'prompt' ? positive : negative)
      }
    }
  }
}

export function validateComfyTextBindings(workflow, bindings, label) {
  if (!Array.isArray(bindings)) throw new Error(label + '必须是字段数组')
  const seen = new Set()
  return bindings.map(binding => {
    const node = String(binding?.node ?? '')
    const input = String(binding?.input ?? '')
    const key = comfyFieldKey({ node, input })
    if (!Object.hasOwn(workflow?.prompt || {}, node) || !Object.hasOwn(workflow.prompt[node]?.inputs || {}, input)
      || typeof workflow.prompt[node].inputs[input] !== 'string' || seen.has(key)) {
      throw new Error(label + '只能选择不同的文字字段，已连线的输入需要选择上游文字节点')
    }
    seen.add(key)
    return { node, input }
  })
}

export function withComfyPromptMarkers(workflow) {
  const markers = comfyPromptMarkers(workflow.prompt)
  const bindings = { ...workflow.bindings }
  for (const role of ['positive', 'negative']) if (markers[role].length) bindings[role] = markers[role]
  return { ...workflow, bindings }
}
