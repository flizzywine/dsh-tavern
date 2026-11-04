/**
 * 工作流导入与绑定识别。
 *
 * detectWorkflow / normalizeWorkflow 从 dsh-tavern-image 原样复制——那边是 385KB 的单文件入口，
 * 带各类插件副作用，没法跨插件 import。scanWorkflows / readWorkflow / applyWorkflowBindings
 * 是本插件补的薄封装：扫描目录、按文件读、把一次出图的值写进工作流副本。
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

function detectWorkflow(nodes) {
  const bind = { positive: [], negative: [], seed: [], batch: [], size: [], steps: [], cfg: [], model: [], loras: [], sampler: [] }
  const list = Object.entries(nodes ?? {}).map(([id, node]) => ({ id, node }))
  const byType = (t) => list.filter(x => x.node?.class_type === t)

  // 这个节点里「可以写提示词的那个输入」：值必须是字面量字符串（连线的值是数组，别碰）。
  // 各家的文本节点叫法不一样：CLIPTextEncode 的 text、String Literal 的 string、还有
  // Text (Multiline)、PrimitiveNode、CR Text 之类，所以先按常见输入名猜，再退而求其次。
  const textInputsOf = (node) => {
    const inp = node?.inputs ?? {}
    const type = String(node?.class_type ?? '')
    const title = String(node?._meta?.title ?? '')
    // Text composition nodes often contain a literal delimiter alongside links. Never
    // bind the delimiter; follow the second (content) branch to the editable prompt.
    if (/StringConcatenate/i.test(type)) return Object.hasOwn(inp, 'string_b') ? ['string_b'] : []
    // 只有节点类型或标题明确表示文本节点时才认它，避免把模型名、路径、模式等
    // 任意字符串输入误判成可编辑提示词。
    const recognizedType = /(?:text|prompt|primitive|stringliteral|multiline)/i.test(type)
    const recognizedTitle = /(?:text|prompt|提示词|正向|负面|反向)/i.test(title)
    if (!recognizedType && !recognizedTitle) return []
    const preferred = ['text', 'text_g', 'text_l', 'string', 'string_a', 'string_b', 'prompt', 'content', 'value', 'positive', 'negative']
    const found = preferred.filter(key => typeof inp[key] === 'string' || Array.isArray(inp[key]))
    if (found.length) return found
    // 自定义文本节点可能用其他字段名；仅允许文本类节点回退，并排除明显的非文本字段。
    for (const [key, value] of Object.entries(inp)) {
      if (typeof value !== 'string') continue
      if (/name|path|file|url|id|seed|sampler|scheduler|model|ckpt|vae|clip|lora|dtype|device|precision/i.test(key)) continue
      found.push(key)
      break
    }
    return found
  }

  // 顺着连线往回找「真正写字的那一格」。
  // 有些工作流的编码节点本身不写文本，文本来自上游节点，例如：
  //   KSampler → 正向编码（无额外质量词）→ 全局主体提示词（ComfyUI 核心多行文本）
  // 此时可直接写的目标是 Text (Multiline)，而不是中间那个 CLIPTextEncode。
  // 只认字面量字符串，最多回溯 8 跳，带环保护。
  const resolveTextTargets = (startId) => {
    const seen = new Set()
    const queue = [{ id: String(startId ?? ''), hop: 0 }]
    const targets = []
    while (queue.length) {
      const { id, hop } = queue.shift()
      if (!id || !nodes[id] || seen.has(id) || hop > 8) continue
      seen.add(id)
      // A zeroed conditioning node explicitly means no negative prompt text.
      if (/ConditioningZeroOut/i.test(String(nodes[id]?.class_type ?? ''))) continue
      const inp = nodes[id].inputs ?? {}
      const keys = textInputsOf(nodes[id])
      let foundLiteral = false
      for (const key of keys) {
        const value = inp[key]
        if (typeof value === 'string') {
          targets.push({ node: id, input: key })
          foundLiteral = true
        } else if (Array.isArray(value) && value.length >= 2) {
          const target = String(value[0])
          if (nodes[target]) queue.push({ id: target, hop: hop + 1 })
        }
      }
      if (!keys.length && hop < 8) {
        for (const key of ['conditioning', 'positive', 'negative']) {
          const value = inp[key]
          if (Array.isArray(value) && value.length >= 2 && nodes[String(value[0])]) queue.push({ id: String(value[0]), hop: hop + 1 })
        }
      }
    }
    return targets
  }

  // 采样器（各种 KSampler 变体）
  const samplerLinked = { positive: false, negative: false }
  const samplers = list.filter(x => /^KSampler/i.test(String(x.node?.class_type ?? '')))
  for (const { id, node } of samplers) {
    const inp = node.inputs ?? {}
    // 正/负面：采样器的 positive / negative 指到的节点；若那个节点只是中转（它的文本来自
    // 上游的 Text (Multiline) 之类），就继续往回找，写进真正能接受文本的那一格。
    for (const [role, key] of [['positive', 'positive'], ['negative', 'negative']]) {
      const link = inp[key]
      const srcId = Array.isArray(link) ? String(link[0]) : (typeof link === 'string' ? link : '')
      if (srcId && nodes[srcId]) samplerLinked[role] = true
      const targets = srcId && nodes[srcId] ? resolveTextTargets(srcId) : []
      bind[role].push(...targets)
    }
    if (typeof inp.noise_seed === 'number' || 'noise_seed' in inp) bind.seed.push({ node: id, input: 'noise_seed' })
    if (typeof inp.seed === 'number' || 'seed' in inp) bind.seed.push({ node: id, input: 'seed' })
    if ('steps' in inp) bind.steps.push({ node: id, input: 'steps' })
    if ('cfg' in inp) bind.cfg.push({ node: id, input: 'cfg' })
    if ('sampler_name' in inp || 'scheduler' in inp) bind.sampler.push({ node: id })
  }

  // 正/负面兜底：完全没有连线可循时，把整张图里的「文字格」找出来再分角色。
  // 先按节点标题判（"正向/正面/positive" vs "负面/反向/negative"），剩下的按
  // CLIPTextEncode 优先、再按出现顺序取前两个。这样 Text (Multiline)、String Literal
  // 这类非 CLIPTextEncode 的文本节点也能被认出来（见 issue：提示词位置无法选择）。
  if (!bind.positive.length || !bind.negative.length) {
    const taken = new Set([...bind.positive, ...bind.negative].map(x => String(x.node)))
    const slots = []
    for (const { id, node } of list) {
      if (taken.has(String(id))) continue
      const inputs = textInputsOf(node).filter(key => typeof node.inputs?.[key] === 'string')
      if (!inputs.length) continue
      const title = String(node?._meta?.title ?? '')
      const type = String(node?.class_type ?? '')
      for (const input of inputs) slots.push({
        id, input, type, rank: /CLIPTextEncode|TextEncode/i.test(type) ? 0 : 1,
        role: /负面|反向|negative/i.test(title) ? 'negative' : (/正向|正面|positive/i.test(title) ? 'positive' : ''),
      })
    }
    const titledNode = { positive: '', negative: '' }
    const needRole = {
      positive: !bind.positive.length && !samplerLinked.positive,
      negative: !bind.negative.length && !samplerLinked.negative,
    }
    for (const slot of slots) {
      const role = slot.role
      if (!role || !needRole[role]) continue
      if (!titledNode[role]) titledNode[role] = String(slot.id)
      if (titledNode[role] === String(slot.id)) bind[role].push({ node: slot.id, input: slot.input })
    }
    const groups = new Map()
    for (const slot of slots) {
      if (bind.positive.some(b => String(b.node) === String(slot.id)) || bind.negative.some(b => String(b.node) === String(slot.id))) continue
      const key = String(slot.id)
      if (!groups.has(key)) groups.set(key, { id: slot.id, rank: slot.rank, slots: [] })
      groups.get(key).slots.push(slot)
    }
    const rest = [...groups.values()].sort((a, b) => a.rank - b.rank)
    if (needRole.positive && !bind.positive.length && rest.length) bind.positive.push(...rest.shift().slots.map(({ id, input }) => ({ node: id, input })))
    if (needRole.negative && !bind.negative.length && rest.length) bind.negative.push(...rest[0].slots.map(({ id, input }) => ({ node: id, input })))
  }

  // 尺寸：EmptyLatentImage / 任何带 width+height 的节点
  const sizeNode = list.find(x => typeof x.node?.inputs?.width === 'number' && typeof x.node?.inputs?.height === 'number')
  if (sizeNode) bind.size.push({ node: sizeNode.id, input: 'width' })

  // batch
  const batchNode = list.find(x => 'batch_size' in (x.node?.inputs ?? {}))
  if (batchNode) bind.batch.push({ node: batchNode.id, input: 'batch_size' })

  // 底模
  for (const { id, node } of list) {
    const t = String(node?.class_type ?? '')
    const inp = node?.inputs ?? {}
    if (/CheckpointLoaderSimple|CheckpointLoader/i.test(t) && typeof inp.ckpt_name === 'string') bind.model.push({ node: id, input: 'ckpt_name' })
    else if (/UNETLoader/i.test(t) && typeof inp.unet_name === 'string') bind.model.push({ node: id, input: 'unet_name' })
    else if (/AnimaBoosterLoader/i.test(t) && typeof inp.model_name === 'string') bind.model.push({ node: id, input: 'model_name' })
  }

  // LoRA：每一个 LoraLoader 都列出来（用户可以在界面上改权重 / 停用）
  for (const { id, node } of byType('LoraLoader')) {
    const inp = node.inputs ?? {}
    bind.loras.push({
      node: id,
      input: 'lora_name',
      name: String(inp.lora_name ?? ''),
      strengthModel: Number(inp.strength_model ?? 1),
      strengthClip: Number(inp.strength_clip ?? inp.strength_model ?? 1),
      enabled: true,
    })
  }

  // 一张图里常有两个采样器（主采样 + 高清修复二次采样），它们各报一遍正负面，
  // 同一个目标就会被登记两次；去重，免得界面上出现两行一模一样的绑定。
  for (const key of Object.keys(bind)) {
    const seen = new Set()
    bind[key] = bind[key].filter((item) => {
      const sig = String(item?.node ?? '') + '|' + String(item?.input ?? '')
      if (seen.has(sig)) return false
      seen.add(sig)
      return true
    })
  }

  // 输出节点：SaveImage / PreviewImage 优先
  const out = list.find(x => /SaveImage|PreviewImage/i.test(String(x.node?.class_type ?? '')))
  return { bindings: bind, outputNode: out ? out.id : '' }
}

export function normalizeWorkflow(raw, fallbackName) {
  if (!raw || typeof raw !== 'object') return null
  // 已经是插件的格式
  if (raw.bindings && raw.prompt) {
    return {
      format: 'dsh-tavern-image-v1',
      name: String(raw.name ?? fallbackName ?? '导入的工作流'),
      prompt: raw.prompt,
      outputNode: String(raw.outputNode ?? ''),
      bindings: raw.bindings,
      digest: String(raw.digest ?? ''),
    }
  }
  // ComfyUI API JSON：{ "3": {...}, "4": {...} } 或 { prompt: {...} }
  const nodes = raw.prompt && typeof raw.prompt === 'object' ? raw.prompt : (raw.workflow && typeof raw.workflow === 'object' ? raw.workflow : raw)
  const realNodes = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') continue
    if (typeof node.class_type !== 'string') continue
    realNodes[id] = node
  }
  if (!Object.keys(realNodes).length) return null
  const { bindings, outputNode } = detectWorkflow(realNodes)
  return {
    format: 'dsh-tavern-image-v1',
    name: String(raw.name ?? fallbackName ?? '导入的工作流'),
    prompt: realNodes,
    outputNode,
    bindings,
    digest: '',
  }
}

/** 扫工作流目录，只返回摘要（完整 prompt 太大，列表接口不返回）。 */
export async function scanWorkflows(dir) {
  const names = await readdir(dir).catch(() => [])
  const out = []
  for (const name of names.sort()) {
    if (!/\.json$/i.test(name)) continue
    try {
      const raw = JSON.parse(await readFile(path.join(dir, name), 'utf8'))
      const normalized = normalizeWorkflow(raw, name.replace(/\.json$/i, ''))
      if (!normalized) continue
      out.push({
        file: name,
        name: normalized.name,
        nodes: Object.keys(normalized.prompt).length,
        outputNode: normalized.outputNode,
        positive: normalized.bindings.positive.length,
        negative: normalized.bindings.negative.length,
        size: normalized.bindings.size.length,
        model: normalized.bindings.model.map(item => normalized.prompt[item.node]?.inputs?.[item.input] ?? '').filter(Boolean),
        loras: normalized.bindings.loras.map(item => item.name).filter(Boolean),
      })
    } catch { /* 坏文件跳过，扫描不因为一个文件失败 */ }
  }
  return out
}

/** 按文件名读一张工作流的完整内容。 */
export async function readWorkflow(dir, file) {
  const name = path.basename(String(file ?? ''))
  if (!name || !/\.json$/i.test(name)) return null
  const raw = JSON.parse(await readFile(path.join(dir, name), 'utf8'))
  return normalizeWorkflow(raw, name.replace(/\.json$/i, ''))
}

/** 把一次出图的值写进工作流副本，不改原文件。 */
export function applyWorkflowBindings(workflow, values = {}) {
  const prompt = structuredClone(workflow.prompt)
  const set = (bindings, value) => {
    for (const binding of bindings ?? []) {
      const node = prompt[binding.node]
      if (node && binding.input) node.inputs[binding.input] = value
    }
  }
  set(workflow.bindings.positive, String(values.positive ?? ''))
  set(workflow.bindings.negative, String(values.negative ?? ''))
  if (values.width && values.height) {
    for (const binding of workflow.bindings.size ?? []) {
      const node = prompt[binding.node]
      if (!node) continue
      if ('width' in node.inputs) node.inputs.width = Number(values.width)
      if ('height' in node.inputs) node.inputs.height = Number(values.height)
    }
  }
  if (Number.isFinite(Number(values.steps))) set(workflow.bindings.steps, Math.round(Number(values.steps)))
  if (Number.isFinite(Number(values.cfg))) set(workflow.bindings.cfg, Number(values.cfg))
  // seed 可以合法地是 0，而 Number(null) / Number('') 也是 0，
  // 所以先排掉没给值的情况，别把一个空的 seed 当成种子 0 写进工作流。
  if (values.seed !== undefined && values.seed !== null && values.seed !== '') {
    const seed = Number(values.seed)
    if (Number.isFinite(seed) && seed >= 0) set(workflow.bindings.seed, Math.round(seed))
  }
  if (values.sampler) {
    for (const binding of workflow.bindings.sampler ?? []) {
      const node = prompt[binding.node]
      if (node) node.inputs.sampler_name = String(values.sampler)
    }
  }
  return prompt
}
