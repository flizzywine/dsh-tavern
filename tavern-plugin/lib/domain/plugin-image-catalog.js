import { bounded } from './plugin-callback.js'

const MAX_ITEMS = 2000
const text = (value, max = 8000) => typeof value === 'string' ? value.slice(0, max) : ''
const strings = value => Array.isArray(value) ? value.slice(0, 100).map(v => text(v, 256)).filter(Boolean) : []
const fields = (value, keys) => Object.fromEntries(keys.map(key => [key, text(value?.[key])]))
const TRAITS = ['feature', 'face', 'faceBack', 'bodySFW', 'bodySFWBack', 'lowerSFW', 'lowerSFWBack',
  'bodyNSFW', 'bodyNSFWBack', 'lowerNSFW', 'lowerNSFWBack', 'negative', 'fullSFW', 'fullNSFW']
const PARTS = ['upper', 'lower', 'shoes', 'accessory', 'full', 'back']

function rows(value) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new TypeError('图片资源来源必须返回最多 2000 项的数组')
  const ids = new Set()
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 256 || ids.has(item.id)) throw new TypeError('图片资源需要唯一的 id（最多 256 字）')
    ids.add(item.id)
  }
  return value
}

/** Read-only projections. Files, credentials and provider-specific fields never cross this boundary. */
function libraryItem(kind, item) {
  const common = { id: item.id, name: text(item.name, 100), description: text(item.description) }
  if (kind === 'outfits') {
    return { ...common, characterId: text(item.characterId, 256) || null, parts: fields(item.parts, PARTS), negative: text(item.negative), isDefault: item.isDefault === true }
  }
  const traits = fields(item.traits, TRAITS)
  for (const [key, legacy] of [['lowerSFW', 'fullSFW'], ['lowerNSFW', 'fullNSFW']]) {
    traits[key] ||= traits[legacy]
    traits[legacy] ||= traits[key]
  }
  return { ...common, aliases: strings(item.aliases), group: text(item.group, 40), traits, outfitIds: strings(item.outfitIds) }
}

export function createPluginImageCatalog({ imageProviders, available, reportError }) {
  const libraries = new Map()
  const current = (registry, entry) => registry.get(entry.id) === entry
  const visible = async (registry, context) => {
    const entries = [...registry.values()]
    const allowed = await Promise.all(entries.map(entry => available(entry.owner, context)))
    return entries.filter((entry, i) => allowed[i] && current(registry, entry))
  }
  const call = (callback, context, label) => bounded(Promise.resolve().then(() => callback(structuredClone(context))), label, 5000)

  async function models(entry, context) {
    if (!entry.models) {
      const status = await entry.status()
      return [{ providerId: entry.id, providerLabel: entry.label, modelId: '', label: status.model || entry.label, ...status }]
    }
    return rows(await call(entry.models, context, '生图模型 ' + entry.id)).map(item => ({
      providerId: entry.id, providerLabel: entry.label, modelId: item.id,
      label: text(item.label, 100) || text(item.model, 100), model: text(item.model, 100),
      ready: item.ready === true, reason: text(item.reason, 200),
      maxReferences: Number.isSafeInteger(item.maxReferences) && item.maxReferences > 0 ? Math.min(4, item.maxReferences) : 0,
    }))
  }

  return {
    registerLibrary(owner, { id, label, characters, outfits } = {}) {
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new TypeError('图片资源库需要有效的 id')
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 30) throw new TypeError('label 必须是 1–30 字')
      if (typeof characters !== 'function' && typeof outfits !== 'function') throw new TypeError('characters、outfits 至少提供一个函数')
      if (characters !== undefined && typeof characters !== 'function' || outfits !== undefined && typeof outfits !== 'function') throw new TypeError('characters、outfits 必须是函数')
      const key = owner + '/' + id
      if (libraries.has(key)) throw new Error('图片资源库 ' + id + ' 已注册')
      const entry = { id: key, owner, label: label.trim(), characters, outfits }
      libraries.set(key, entry)
      return () => { if (current(libraries, entry)) libraries.delete(key) }
    },

    async listModels(context) {
      const entries = await visible(imageProviders, context)
      const groups = await Promise.all(entries.map(async entry => {
        try {
          const result = await models(entry, context)
          return current(imageProviders, entry) && await available(entry.owner, context) ? result : []
        } catch (error) { reportError(context.gameId, entry.owner, '生图模型列表', error); return [] }
      }))
      return groups.flat().slice(0, MAX_ITEMS)
    },

    async select(context, { providerId, modelId } = {}) {
      if (providerId !== undefined && (typeof providerId !== 'string' || !providerId)) throw Object.assign(new Error('providerId 必须是非空字符串'), { code: 'INVALID_ARGUMENT' })
      if (modelId !== undefined && (typeof modelId !== 'string' || !modelId || !providerId)) throw Object.assign(new Error('指定 modelId 时需要 providerId 和非空的 modelId'), { code: 'INVALID_ARGUMENT' })
      const entries = await visible(imageProviders, context)
      const entry = providerId ? entries.find(item => item.id === providerId) : entries[0]
      if (!entry) throw Object.assign(new Error('生图来源未配置、已卸载或不适用于当前人物卡'), { code: 'NOT_CONFIGURED' })
      if (modelId !== undefined && !(await models(entry, context)).some(item => item.modelId === modelId)) throw Object.assign(new Error('生图模型不存在，请重新读取模型列表'), { code: 'NOT_CONFIGURED' })
      const assertAvailable = async () => {
        const allowed = await available(entry.owner, context)
        if (!allowed || !current(imageProviders, entry)) throw Object.assign(new Error('生图来源已卸载或不可用'), { code: 'NOT_CONFIGURED', requestMayHaveSucceeded: false })
      }
      return {
        async status() { await assertAvailable(); return entry.status(modelId === undefined ? {} : { modelId }) },
        async generate(input) { await assertAvailable(); return entry.generate(modelId === undefined ? input : { ...input, modelId }) },
      }
    },

    async list(kind, context, { providerId, query = '', offset = 0, limit = 50, characterId } = {}) {
      if (typeof query !== 'string' || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError('query 最多 200 字，offset 为非负整数，limit 为 1–200')
      if (providerId !== undefined && (typeof providerId !== 'string' || !providerId)) throw new TypeError('providerId 必须是非空字符串')
      if (characterId !== undefined && (typeof characterId !== 'string' || !characterId || !providerId)) throw new TypeError('筛选 characterId 时需要 providerId')
      const errors = []
      const entries = (await visible(libraries, context)).filter(entry => (!providerId || entry.id === providerId) && entry[kind])
      const groups = await Promise.all(entries.map(async entry => {
        try {
          const result = rows(await call(entry[kind], { ...context, ...(characterId ? { characterId } : {}) }, '图片资源库 ' + entry.id))
          if (!current(libraries, entry) || !await available(entry.owner, context)) return []
          return result.map(item => ({ entry, item }))
        } catch (error) {
          reportError(context.gameId, entry.owner, '图片资源库', error)
          errors.push({ providerId: entry.id, code: 'PROVIDER_FAILED' })
          return []
        }
      }))
      const needle = query.trim().toLowerCase()
      const items = groups.flat().filter(({ item }) => !needle || [text(item.name, 100), text(item.description), ...strings(item.aliases)].join('\n').toLowerCase().includes(needle))
      // Only materialize detailed traits and outfit parts for the requested page.
      const page = items.slice(offset, offset + limit).map(({ entry, item }) => ({ providerId: entry.id, providerLabel: entry.label, ...libraryItem(kind, item) }))
      return { items: page, total: items.length, offset, limit, hasMore: offset + limit < items.length, errors }
    },
  }
}
