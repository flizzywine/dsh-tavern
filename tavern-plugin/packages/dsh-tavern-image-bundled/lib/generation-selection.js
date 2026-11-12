import { effectivePromptPreset } from './prompt-presets.js'

/** Template selection and routing are shared by story, card, stage and image editing. */
export const usesWorldbook = config => config?.promptSystem === 'worldbook'
const eligibleFor = (template, purpose) => template?.enabled !== false && template?.structure?.blocks?.length
  && (!template.structure.purpose || template.structure.purpose === 'both' || template.structure.purpose === purpose)

export function generationTemplates(config, purpose = 'generate') {
  const fallback = config.promptDefault?.structure ? [{ ...config.promptDefault, id: '__default__' }] : []
  return [...fallback, ...(config.promptPresets || [])].filter(item => eligibleFor(item, purpose))
}

export function selectGenerationConfig(config, workflows = [], { templateId, purpose = 'generate', random, randomValue = Math.random } = {}) {
  if (usesWorldbook(config)) return { config, template: null, workflow: null }
  if (config.promptSelectionResolved && !templateId && !random) return { config, template: config.promptSelectionTemplate || null, workflow: null }
  // A selected plugin style is a complete selection; don't silently replace it with the modular default.
  if (!templateId && !(random ?? config.randomPromptTemplates) && effectivePromptPreset(config)?.registered) {
    return { config: { ...config, promptSelectionResolved: true, promptSelectionTemplate: null }, template: null, workflow: null }
  }
  const available = generationTemplates(config, purpose)
  let selected
  if (templateId) {
    selected = available.find(item => item.id === templateId)
    if (!selected) throw new Error('这个模板不存在、已停用或不适用于本次生图')
  } else if (random ?? config.randomPromptTemplates) {
    const pool = available.filter(item => !config.randomTemplateIds?.length || config.randomTemplateIds.includes(item.id))
    if (!pool.length) throw new Error('没有适用于本次生图的随机模板，请调整随机范围')
    selected = pool[Math.min(pool.length - 1, Math.floor(randomValue() * pool.length))]
  } else selected = available.find(item => item.id === config.activePromptPreset) || available[0]
  if (!selected) return { config, template: null, workflow: null }
  const next = { ...config, promptSelectionResolved: true, promptSelectionTemplate: { id: selected.id, name: selected.name },
    activePromptPreset: selected.id === '__default__' ? '' : selected.id }
  const targets = selected.structure.targets || []
  const target = targets.find(item => item.kind === (config.imageBackend === 'comfyui' ? 'workflow' : 'channel')
    && item.id === (config.imageBackend === 'comfyui' ? config.defaultWorkflow : config.activeImageChannel)) || targets[0]
  let workflow = null
  if (target?.kind === 'workflow') {
    workflow = workflows.find(item => item.id === target.id && !item.error && item.enabled !== false)
    if (!workflow) throw new Error('模板「' + selected.name + '」绑定的工作流不可用')
    Object.assign(next, { imageBackend: 'comfyui', comfyMode: 'workflow', defaultWorkflow: workflow.id })
  } else if (target?.kind === 'channel') {
    const channel = config.imageChannels?.find(item => item.id === target.id)
    if (!channel) throw new Error('模板「' + selected.name + '」绑定的渠道已移除')
    Object.assign(next, { imageBackend: channel.provider, activeImageChannel: channel.id })
  }
  return { config: next, template: { id: selected.id, name: selected.name }, workflow, target }
}
