import { selectPromptMaterials, fillPromptInputs } from './prompt-materials.js'
import { normalizePromptUsage } from './prompt-structure.js'
import { activeChannel } from './image-channels.js'
import { imageReferenceLimit, imageTransparency } from './image-provider-capabilities.js'
import { composePluginImagePrompt, composePluginImagePromptAsync } from './prompt-assembly.js'
import { effectivePromptPreset, promptConfigForTarget, withPromptPreset } from './prompt-presets.js'
export { composePluginImagePrompt, composePluginImagePromptAsync } from './prompt-assembly.js'

/** The same adapter serves Tavern assets and public model discovery. Model IDs are template:<id>, saved channel IDs or comfyui:<workflowId>. */
export function createImageGenerator(getConfig, generate, defaultUsage = 'plugin', library = {}) {
  const current = (modelId, promptPreset) => {
    const config = withPromptPreset(getConfig(), promptPreset)
    // An explicit style preset replaces the default workbench template; named templates still win.
    if (library.generateTemplate && (typeof modelId === 'string' && modelId.startsWith('template:') || modelId === undefined && promptPreset === undefined && config.promptSystem === 'workbench')) {
      const models = library.templates?.() || []
      const template = modelId ? models.find(item => item.id === modelId) : models.find(item => item.templateId === config.activePromptPreset) || models[0]
      if (template) return { config, template }
    }
    const wanted = typeof modelId === 'string' && modelId.startsWith('comfyui:') ? modelId : undefined
    if (wanted || modelId === undefined && config?.imageBackend === 'comfyui') {
      const workflows = library.workflows?.() || []
      const workflow = wanted ? workflows.find(item => item.id === wanted) : workflows.find(item => item.workflowId === config.defaultWorkflow) || workflows[0]
      return workflow && library.generateComfy ? { config, workflow } : { config, reason: '请先导入可用的 ComfyUI 工作流' }
    }
    if (modelId !== undefined) {
      const selected = config.imageChannels?.find(item => item.id === modelId)
      if (!selected) return { config, reason: '生图模型已移除，请重新读取模型列表' }
      return { config, channel: selected }
    }
    const channel = config.imageChannels?.find(item => item.id === config.activeImageChannel && (item.provider === config.imageBackend || config.imageBackend === 'custom' && item.provider === 'atlascloud'))
    if (!channel) return { config, reason: '请先在 配图 设置里添加并选中一个生图渠道' }
    return { config, channel }
  }
  const status = ({ channel, workflow, template, reason }) => {
    if (template) return { ready: template.ready, model: template.model, reason: template.reason, maxReferences: template.maxReferences, ...(template.transparent === undefined ? {} : { transparent: template.transparent }) }
    if (workflow) return { ready: workflow.ready, model: workflow.model, maxReferences: workflow.maxReferences }
    if (!channel) return { ready: false, reason, maxReferences: 0 }
    const transparent = imageTransparency(channel)
    return { ready: true, model: channel.model || '', maxReferences: imageReferenceLimit(channel), ...(transparent === undefined ? {} : { transparent }) }
  }
  return {
    id: 'online', label: '配图',
    models() {
      // One consistent snapshot and one pass; discovery never clones credentials or loads a transport.
      const snapshot = getConfig()
      const templates = library.templates?.() || []
      if (snapshot.promptSystem === 'workbench' && templates.length) return templates.map(({ templateId, ...item }) => item)
      return [...(snapshot.imageChannels || []).map(channel => ({ id: channel.id, label: channel.name || channel.model || channel.id, ...status({ channel }) })),
        ...(library.workflows?.() || []).map(({ workflowId, ...item }) => item)]
    },
    status({ modelId } = {}) { return status(current(modelId)) },
    async generate({ prompt, negative, references = [], width, height, background, quality, signal, modelId, templateId, promptPreset, usage, inputs, subjects, definitions } = {}) {
      const { config, channel: selected, workflow, template: templateModel, reason } = current(templateId ? 'template:' + templateId : modelId, promptPreset)
      if (templateModel) {
        if (!templateModel.ready) throw new Error(templateModel.reason || '模板还没有可用的生图接口')
        signal?.throwIfAborted()
        return library.generateTemplate({ templateId: templateId || (modelId ? templateModel.templateId : undefined), prompt, negative, references, width, height, background, quality, signal, inputs, subjects, definitions, usage: normalizePromptUsage(usage, defaultUsage) })
      }
      if (workflow) {
        if (!workflow.ready) throw new Error(workflow.reason || '工作流图片输入尚未配置')
        signal?.throwIfAborted()
        if (references.length > workflow.maxReferences) throw new Error('这个工作流最多支持 ' + workflow.maxReferences + ' 张输入图片')
        if (workflow.maxReferences && !references.length) throw new Error('这个 ComfyUI 工作流需要输入图片；请添加素材或选择文生图工作流')
        return library.generateComfy({ workflowId: workflow.workflowId, promptPreset, prompt, negative, references, width, height, background, quality, signal, inputs, subjects, definitions,
          usage: normalizePromptUsage(usage, defaultUsage) })
      }
      if (!selected) throw Object.assign(new Error(reason), { requestMayHaveSucceeded: false })
      signal?.throwIfAborted()
      // Clone only at submission, before an asynchronous module load can observe later edits.
      const channel = activeChannel({ ...config, imageBackend: selected.provider, activeImageChannel: selected.id })
      const promptUsage = normalizePromptUsage(usage, defaultUsage)
      const maxImageBytes = config.maxImageBytes
      const records = definitions || library.definitions?.() || {}
      const prepared = await composePluginImagePromptAsync(config, { channel, prompt, negative, usage: promptUsage, inputs, subjects, definitions: records, signal })
      if (prepared.workflowValues?.length) throw new Error('当前模板的节点参数需要 ComfyUI 工作流')
      const template = effectivePromptPreset(promptConfigForTarget(config, null, channel))
      const materials = selectPromptMaterials(fillPromptInputs(template?.structure, inputs).structure, records, { usage: promptUsage, subjects })
      const available = Math.max(0, imageReferenceLimit(channel) - references.length)
      if (library.readReference && available) {
        const bound = materials.selected.flatMap(item => item.references)
        const unique = [...new Map(bound.map(reference => [reference.id, reference])).values()].slice(0, available)
        if (unique.length) {
          const indexById = new Map(unique.map((reference, index) => [reference.id, references.length + index + 1]))
          const usageNotes = materials.selected.flatMap(item => {
            const indexes = item.references.map(reference => indexById.get(reference.id)).filter(Boolean)
            const name = [item.characterName, item.outfitName].filter(Boolean).join(' / ')
            return indexes.length ? ['参考图 ' + indexes.join('、') + ' 对应 ' + name] : []
          })
          const loaded = await Promise.all(unique.map(reference => library.readReference(reference)))
          signal?.throwIfAborted()
          references = [...references, ...loaded]
          prepared.positive = [prepared.positive, ...usageNotes].join('\n\n')
        }
      }
      const draw = generate || (await import('./image-providers.js')).generateImage
      const result = await draw(channel, { ...prepared.parameters, ...prepared, references, width: width ?? prepared.parameters?.width, height: height ?? prepared.parameters?.height, exactSize: true, background, quality },
        { signal, maxImageBytes })
      return { data: result.bytes, mediaType: result.mediaType, ...(result.seed !== undefined ? { seed: result.seed } : {}), ...(result.usage ? { usage: result.usage } : {}) }
    },
  }
}

export function stageImageProvider(getConfig, generate, library) {
  return createImageGenerator(getConfig, generate, 'stage', library)
}

// Settings receive a read-only status. Connection details and credentials stay in the provider.
export function describeImageIntegration(provider, config) {
  if (!provider) return { ready: false, reason: '当前宿主未提供生图接口' }
  const status = provider.status()
  if (!status.ready) return status
  const channel = (config.imageChannels || []).find(item => item.id === config.activeImageChannel)
  return { ...status, channelName: config.imageBackend === 'comfyui' ? 'ComfyUI · ' + status.model : channel?.name || channel?.model || channel?.id || '',
    templateName: effectivePromptPreset(promptConfigForTarget(config, null, channel))?.name || '' }
}
