import { normalizeModuleValues } from './template-modules.js'
const FORMATS = ['auto', 'tags', 'natural', 'mixed', 'structured']
const KINDS = ['section', 'positive', 'negative', 'scene', 'rule', 'style', 'lora', 'entries', 'library', 'output', 'mechanism', 'extension']

export function normalizePromptUsage(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 64) || fallback : fallback
}

export function activePromptBlocks(structure, usage = 'story') {
  return (structure?.blocks || []).filter(block => block.enabled !== false && (!block.usage || block.usage === usage))
}

const isPositive = block => ['positive', 'style'].includes(block.kind) && block.text

export function normalizePromptStructure(value) {
  if (!value || !Array.isArray(value.blocks) || !FORMATS.includes(value.format)) return null
  const sectionNames = new Set()
  const targets = new Map()
  let hasScene = false
  let hasOutput = false
  const blocks = value.blocks.slice(0, 31).flatMap(block => {
    if (!KINDS.includes(block?.kind)) return []
    const title = String(block.title ?? '').replace(/[【】<>\r\n]/g, ' ').trim().slice(0, 60)
    if (!title || (block.kind === 'section' && sectionNames.has(title))) return []
    if (block.kind === 'scene') {
      if (hasScene) return []
      hasScene = true
    }
    if (block.kind === 'output') {
      if (hasOutput) return []
      hasOutput = true
    }
    if (block.kind === 'section') sectionNames.add(title)
    const usage = normalizePromptUsage(block.usage)
    const result = { kind: block.kind, title, text: block.kind === 'scene' ? '' : String(block.text ?? '').trim().slice(0, ['rule', 'library', 'output'].includes(block.kind) ? 4000 : 1000) }
    if (block.kind === 'extension') { result.moduleId = String(block.moduleId || 'core.custom').slice(0, 120); result.values = normalizeModuleValues(block.values) }
    if (block.kind === 'output') result.format = FORMATS.includes(block.format) ? block.format : value.format
    else if (usage) result.usage = usage
    if (block.enabled === false) result.enabled = false
    if (block.kind === 'style' && typeof block.styleId === 'string' && block.styleId.trim()) {
      result.styleId = block.styleId.trim().slice(0, 120)
    }
    if (block.kind === 'library') {
      for (const key of ['characterId', 'outfitId']) if (typeof block[key] === 'string') result[key] = block[key].trim().slice(0, 120)
      if (block.angle === 'back') result.angle = 'back'
      if (typeof block.state === 'string') result.state = block.state.trim().slice(0, 1000)
    }
    if (block.kind === 'library' && ['characters', 'outfits'].includes(block.librarySource)) result.librarySource = block.librarySource
    if (block.kind === 'entries') result.entryGroup = String(block.entryGroup ?? '').trim().slice(0, 60)
    if (block.kind === 'mechanism') {
      result.mechanism = ['lora_sweep', 'seed_series', 'fixed_seed'].includes(block.mechanism) ? block.mechanism : 'fixed_seed'
      result.count = block.count ?? 1
      if (block.seed !== undefined && block.seed !== '') result.seed = Number(block.seed)
      result.weights = String(block.weights ?? '0.4, 0.7, 1').slice(0, 240)
    }
    if (block.kind === 'lora' || block.kind === 'mechanism') {
      result.workflowId = String(block.workflowId ?? '').trim().slice(0, 240)
      result.node = String(block.node ?? '').trim().slice(0, 120)
      if (typeof block.slot === 'string' && block.slot.trim()) result.slot = block.slot.trim().slice(0, 80)
      for (const key of ['strengthModel', 'strengthClip']) {
        const n = block[key] == null || block[key] === '' ? NaN : Number(block[key])
        if (Number.isFinite(n)) result[key] = n
      }
    }
    return [result]
  })
  for (const target of Array.isArray(value.targets) ? value.targets.slice(0, 60) : []) {
    if (!['workflow', 'channel'].includes(target?.kind) || typeof target.id !== 'string' || !target.id || target.id.length > 240) continue
    targets.set(target.kind + ':' + target.id, { kind: target.kind, id: target.id })
  }
  const generationRules = typeof value.generationRules === 'string' ? value.generationRules.trim().slice(0, 4000) : ''
  const output = blocks.find(block => block.kind === 'output')
  const format = output ? output.enabled === false ? 'auto' : output.format : value.format
  const keys = new Set()
  const inputs = (Array.isArray(value.inputs) ? value.inputs : []).slice(0, 12).flatMap(input => {
    const key = typeof input?.key === 'string' ? input.key.trim() : ''
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) || keys.has(key)) return []
    keys.add(key)
    return [{ key, label: String(input.label || key).trim().slice(0, 60), default: String(input.default ?? '').slice(0, 2000), required: input.required === true }]
  })
  return { format, blocks, ...( ['generate', 'edit', 'both'].includes(value.purpose) ? { purpose: value.purpose } : {}), ...(inputs.length ? { inputs } : {}), targets: [...targets.values()], ...(generationRules ? { generationRules } : {}) }
}

export function structureGuidance(structure, format = structure?.format, usage) {
  const blocks = activePromptBlocks(structure, usage)
  const sections = blocks.filter(block => block.kind === 'section')
  const rules = [structure?.generationRules, ...blocks.flatMap(block => {
    if (['rule', 'output'].includes(block.kind) && block.text) return [block.title + '：' + block.text]
    if (block.kind !== 'library') return []
    const instructions = []
    if (block.librarySource !== 'outfits') instructions.push('画面涉及人物库已有角色时，引用对应的角色及可见外貌，不额外添加未出场角色。')
    if (block.librarySource !== 'characters') instructions.push('画面涉及服装库已有套装时，使用库里的原名引用，按正文当前时点选择服装。')
    if (block.text) instructions.push(block.text)
    return [block.title + '：' + instructions.join(' ')]
  })].filter(Boolean)
  if (!sections.length) return rules.join('\n')
  const list = sections.map(block => '【' + block.title + '】' + (block.text ? ' ' + block.text : ''))
  const instruction = format === 'structured'
    ? '按以下顺序用中文自然语言写画面分节，标题独占一行，描述紧跟在下一行。无可见内容的分节省略。'
    : '按以下顺序组织画面描述，省略无内容的部分，只输出对应格式的画面描述，不输出分节标题。'
  return [...rules, '当前生图结构模板决定画面内容的排列顺序。' + instruction, ...list].filter(Boolean).join('\n')
}

export function applyStructurePositive(text, structure, mode, usage) {
  const blocks = activePromptBlocks(structure, usage)
  if (!blocks.some(block => block.kind === 'section' || isPositive(block))) return text
  const hasScene = blocks.some(block => block.kind === 'scene')
  if (mode !== 'structured') {
    if (hasScene) return blocks.flatMap(block => block.kind === 'scene' ? [text]
      : isPositive(block) && !text.includes(block.text) ? [block.text] : []).filter(Boolean).join(mode === 'tags' ? ', ' : '. ')
    const additions = blocks.filter(block => isPositive(block) && !text.includes(block.text))
    return [text, ...additions.map(block => block.text)].filter(Boolean).join(mode === 'tags' ? ', ' : '. ')
  }

  const headings = [...text.matchAll(/^【([^】\r\n]+)】[^\S\r\n]*$/gm)]
  const remaining = headings.map((match, index) => ({
    title: match[1].trim(), text: text.slice(match.index, headings[index + 1]?.index).trim(),
  }))
  const preamble = headings.length ? text.slice(0, headings[0].index).trim() : text
  const ordered = hasScene ? [] : [preamble]
  const named = new Set(blocks.filter(block => block.kind === 'section').map(block => block.title))
  const fixed = new Set(blocks.filter(block => isPositive(block)).map(block => '【' + block.title + '】\n' + block.text))
  const used = new Set()
  for (const block of blocks) {
    if (block.kind === 'scene') {
      ordered.push(preamble)
      for (const section of remaining) {
        if (named.has(section.title) || fixed.has(section.text)) continue
        ordered.push(section.text)
        used.add(section)
      }
    } else if (block.kind === 'section') {
      for (const section of remaining) {
        if (section.title === block.title) {
          ordered.push(section.text)
          used.add(section)
        }
      }
    } else if (isPositive(block)) {
      const addition = '【' + block.title + '】\n' + block.text
      const existing = remaining.find(section => section.text === addition)
      if (!existing || !used.has(existing)) ordered.push(addition)
      if (existing) used.add(existing)
    }
  }
  return [...ordered, ...remaining.filter(section => !used.has(section)).map(section => section.text)].filter(Boolean).join('\n\n')
}

export function structureNegative(structure, usage) {
  return activePromptBlocks(structure, usage).filter(block => block.kind === 'negative' && block.text).map(block => block.text)
}
