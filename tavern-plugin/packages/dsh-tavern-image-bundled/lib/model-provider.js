import { activeChannel } from './image-channels.js'
import { imageReferenceLimit, imageTransparency } from './image-provider-capabilities.js'

/**
 * The same adapter serves Tavern assets and public model discovery. Model IDs are saved channel IDs.
 * comfy (optional, server side) runs the selected ComfyUI workflow: workflow() returns the usable
 * workflow that would run (or nothing) and generate(request) renders it. Without it, ComfyUI is unsupported.
 */
export function createImageGenerator(getConfig, generate, { comfy } = {}) {
  const current = (modelId) => {
    const config = getConfig()
    if (modelId !== undefined) {
      const selected = config.imageChannels?.find(item => item.id === modelId)
      if (!selected) return { config, reason: '生图模型已移除，请重新读取模型列表' }
      return { config, channel: selected }
    }
    if (config?.imageBackend === 'comfyui') {
      if (!comfy) return { config, reason: '素材生图暂不支持 ComfyUI；请在 配图 设置里切到「在线服务」渠道' }
      const workflow = comfy.workflow()
      return workflow ? { config, workflow } : { config, reason: '请先在 配图 设置里导入并启用一个 ComfyUI 工作流' }
    }
    const channel = config.imageChannels?.find(item => item.id === config.activeImageChannel && (item.provider === config.imageBackend || config.imageBackend === 'custom' && item.provider === 'atlascloud'))
    if (!channel) return { config, reason: '请先在 配图 设置里添加并选中一个生图渠道' }
    return { config, channel }
  }
  // 	ransparent is present only when the channel's protocol/model is known to honour (or refuse) it.
  const status = ({ channel, workflow, reason }) => {
    if (workflow) return { ready: true, model: workflow.label || workflow.id || '', maxReferences: workflow.bindings?.referenceImages?.length || 0 }
    if (!channel) return { ready: false, reason, maxReferences: 0 }
    const transparent = imageTransparency(channel)
    return { ready: true, model: channel.model || '', maxReferences: imageReferenceLimit(channel), ...(transparent === undefined ? {} : { transparent }) }
  }
  return {
    id: 'online', label: '配图',
    models() {
      // One consistent snapshot and one pass; discovery never clones credentials or loads a transport.
      return (getConfig().imageChannels || []).map(channel => ({ id: channel.id, label: channel.name || channel.model || channel.id, ...status({ channel }) }))
    },
    status({ modelId } = {}) { return status(current(modelId)) },
    async generate({ prompt, references = [], width, height, background, quality, signal, modelId } = {}) {
      const { config, channel: selected, workflow, reason } = current(modelId)
      if (workflow) {
        signal?.throwIfAborted()
        return comfy.generate({ prompt: String(prompt || ''), references, width, height, signal })
      }
      if (!selected) throw Object.assign(new Error(reason), { requestMayHaveSucceeded: false })
      signal?.throwIfAborted()
      // Clone only at submission, before an asynchronous module load can observe later edits.
      const channel = activeChannel({ ...config, imageBackend: selected.provider, activeImageChannel: selected.id })
      const maxImageBytes = config.maxImageBytes
      const draw = generate || (await import('./image-providers.js')).generateImage
      const result = await draw(channel, { positive: String(prompt || ''), references, width, height, exactSize: true, background, quality },
        { signal, maxImageBytes })
      return { data: result.bytes, mediaType: result.mediaType }
    },
  }
}

export { createImageGenerator as stageImageProvider }
