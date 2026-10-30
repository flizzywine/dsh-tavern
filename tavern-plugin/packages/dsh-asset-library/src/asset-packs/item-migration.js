import assetTags from '../shared/asset-tags.cjs'
import audioCategories from '../shared/audio-categories.cjs'

const legacyLabels = {key:'钥匙',document:'文书',medicine:'药品',weapon:'武器',jewel:'饰品',food:'食物',money:'金钱',misc:'杂物'}

export function normalizeEntryTags(entry) {
  if(entry.kind === 'sfx') {
    // The former generic tag writer wrapped stored CatIDs in singleton arrays.
    if(Array.isArray(entry.category)&&entry.category.length===1&&Object.hasOwn(audioCategories,entry.category[0]))return {...entry,category:entry.category[0]}
    return entry
  }
  if(entry.category===undefined || entry.kind === 'ambience' && Object.hasOwn(audioCategories, entry.category))return entry
  const category=assetTags.normalize(entry.category)
  return JSON.stringify(category)===JSON.stringify(entry.category)?entry:{...entry,category}
}
// Called only at import/write boundaries, never while reading a stored pack.
export function normalizePackTags(manifest) {
  let changed = false
  const assets = manifest.assets.map(asset => {
    const next = normalizeEntryTags(asset)
    if (next !== asset) changed = true
    return next
  })
  return normalizeEntryTags(changed ? {...manifest, assets} : manifest)
}

// Pure conversion plan. File sealing and cross-document reference rewrites belong to the caller.
export function convertItemPack(source, {media = value => value, categories = legacyLabels} = {}) {
  const seed = source.format === 'dsh-mod-pack'
  if (seed && source.modId !== 'dsh.items') throw new Error('Expected an items seed pack')
  const manifest = seed ? {
    format:'dsh-asset-pack',schemaVersion:1,id:source.id,name:source.name,
    contentHash:'0'.repeat(64),assets:[],figures:[],sprites:{},bundles:{},blobs:{},files:[],
    ...Object.fromEntries(['description','author','license','credits'].filter(key => source[key] !== undefined).map(key => [key,structuredClone(source[key])]))
  } : structuredClone(source)
  const mappings = [], icons = [...(manifest.tagIcons || [])], assets = []
  for (const original of seed ? source.entries : source.assets) {
    const entry = structuredClone(original)
    if (!['item','items','props','icon'].includes(entry.kind)) { assets.push(entry); continue }
    const metadata = entry.extensions?.['dsh.items'] || entry.fields || {}
    const genre = metadata.genreId
    const tags = assetTags.normalize(entry.category).map(tag => tag === genre ? categories[genre] || genre : tag)
    if (genre && !tags.includes(categories[genre] || genre)) tags.push(categories[genre] || genre)
    const hash = media(entry.media, entry)
    if (entry.kind === 'icon' || entry.categoryDefault) {
      const tag = tags[0] || categories[entry.id] || entry.name
      const existing = icons.find(row => row.tag === tag)
      if (existing && existing.media !== hash) throw new Error('Conflicting tag icon: ' + tag)
      if (!existing) icons.push({tag,media:hash})
      mappings.push({from:{packId:source.id,kind:entry.kind,assetId:entry.id},to:{packId:source.id,tag}})
      continue
    }
    if (entry.kind !== 'props') mappings.push({from:{packId:source.id,kind:entry.kind,assetId:entry.id},to:{packId:source.id,kind:'props',assetId:entry.id}})
    entry.kind = 'props'; entry.category = tags
    if (!entry.variants) { entry.media = hash ?? null; if (entry.media === null) entry.pendingMedia = true }
    entry.directorNote ??= ''; entry.recall ??= {mode:'keyword',keywords:[]}
    if (metadata.inventoryId) entry.inventoryId = metadata.inventoryId
    delete entry.fields; delete entry.categoryDefault
    if (entry.extensions?.['dsh.items']) { delete entry.extensions['dsh.items']; if (!Object.keys(entry.extensions).length) delete entry.extensions }
    assets.push(entry)
  }
  manifest.assets = assets
  if (icons.length) manifest.tagIcons = icons
  const normalized = normalizePackTags(manifest)
  return {manifest:normalized,mappings,changed:JSON.stringify(normalized) !== JSON.stringify(source)}
}

export function rewriteItemRefs(value, mappings) {
  if (Array.isArray(value)) return value.map(item => rewriteItemRefs(item, mappings))
  if (!value || typeof value !== 'object') return value
  const mapping = mappings.find(row => row.from.packId === value.packId && row.from.kind === value.kind && row.from.assetId === value.assetId)
  if (mapping && !mapping.to.kind) throw new Error('A referenced category icon needs an explicit tag-icon migration')
  return Object.fromEntries(Object.entries(mapping ? {...value,...mapping.to} : value).map(([key,item]) => [key,rewriteItemRefs(item,mappings)]))
}
