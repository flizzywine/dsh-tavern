import { activeChannel } from './image-channels.js'
import { imageReferenceLimit } from './image-provider-capabilities.js'
import { generateImage } from './image-providers.js'

/** The same adapter serves Tavern assets and public model discovery. Model IDs are saved channel IDs. */
export function stageImageProvider(getConfig, generate = generateImage) {
  const current = (modelId) => {
    const config = getConfig()
    if (modelId !== undefined) {
      const selected = config.imageChannels?.find(item => item.id === modelId)
      if (!selected) return { config, reason: '生图模型已移除，请重新读取模型列表' }
      try { return { config, channel: activeChannel({ ...config, imageBackend: selected.provider, activeImageChannel: selected.id }) } } catch {}
      return { config, reason: '生图渠道配置无效' }
    }
    if (config?.imageBackend === 'comfyui') return { config, reason: '素材生图暂不支持 ComfyUI；请在 配图 设置里切到「在线服务」渠道' }
    let channel = null
    try { channel = activeChannel(config) } catch {}
    if (!channel) return { config, reason: '请先在 配图 设置里添加并选中一个生图渠道' }
    return { config, channel }
  }
  const status = (modelId) => {
    const { channel, reason } = current(modelId)
    if (!channel) return { ready: false, reason, maxReferences: 0 }
    return { ready: true, model: channel.model || '', maxReferences: imageReferenceLimit(channel) }
  }
  return {
    id: 'online', label: '配图',
    models() {
      return (getConfig().imageChannels || []).map(channel => ({ id: channel.id, label: channel.name || channel.model || channel.id, ...status(channel.id) }))
    },
    status({ modelId } = {}) { return status(modelId) },
    async generate({ prompt, references = [], width, height, background, quality, signal, modelId } = {}) {
      const { config, channel, reason } = current(modelId)
      if (!channel) throw Object.assign(new Error(reason), { requestMayHaveSucceeded: false })
      // activeChannel already returns an isolated snapshot; a second deep clone is unnecessary.
      const result = await generate(channel, { positive: String(prompt || ''), references, width, height, exactSize: true, background, quality },
        { signal, maxImageBytes: config.maxImageBytes })
      return { data: result.bytes, mediaType: result.mediaType }
    },
  }
}

const localOutfitId = (characterId, outfitId) => JSON.stringify([characterId, outfitId])
const outfit = (item, characterId = null) => ({
  id: localOutfitId(characterId, item.id), name: item.name, characterId,
  parts: Object.fromEntries(['upper', 'lower', 'shoes', 'accessory', 'full', 'back'].map(key => [key, String(item[key] || '')])),
  negative: item.negative || '', isDefault: item.default === true,
})

/**
 * Read the live in-memory definitions, never the plugin's private JSON from another plugin.
 * `records` (character-library.js) adds the 人物库 record read/write that Tavern's asset library edits through.
 */
export function imageLibraryProvider(getDefinitions, records) {
  const characters = context => (getDefinitions().characters || []).filter(item => item.enabled !== false &&
    (!item.cards?.length || Boolean(context.card && item.cards.includes(context.card))))
  const shared = () => (getDefinitions().outfits || []).filter(item => item.enabled !== false)
  return {
    id: 'definitions', label: '配图人物与服装',
    ...(records ? { schemaVersion: records.schemaVersion, getCharacter: records.getCharacter, patchCharacter: records.patchCharacter,
      createCharacter: records.createCharacter, putReferenceImage: records.putReferenceImage } : {}),
    characters(context = {}) {
      const sharedIds = new Set(shared().map(item => item.id))
      return characters(context).map(item => ({
        id: item.id, name: item.name, aliases: String(item.match || '').split(/[,，\n]/).map(s => s.trim()).filter(Boolean),
        description: item.note || '', group: item.group || '', traits: { ...item.traits },
        outfitIds: (item.outfits || []).filter(o => o.enabled !== false).map(o => localOutfitId(item.id, o.id))
          .concat((item.outfitRefs || []).filter(id => sharedIds.has(id)).map(id => localOutfitId(null, id))),
      }))
    },
    outfits(context = {}) {
      const people = characters(context).filter(item => !context.characterId || item.id === context.characterId)
      const refs = new Set(people.flatMap(item => item.outfitRefs || []))
      return people.flatMap(item => (item.outfits || []).filter(o => o.enabled !== false).map(o => outfit(o, item.id)))
        .concat(shared().filter(item => !context.characterId || refs.has(item.id)).map(item => outfit(item)))
    },
  }
}
