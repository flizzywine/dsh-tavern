import path from 'node:path'
import { validPackId } from './asset-packs.js'

// Card archives read from disk (zip-file.js): a DSH card (.dshcard, docs/design/dsh-card-format.md),
// the Galgame fork's card bundle (dsh-tavern-card-bundle.json), or a plain CHARX.

const RESERVED = new Set(['icon', 'emotion', 'background', 'user_icon', 'other'])
const MAX_REFERENCED_BYTES = 20 * 1024 * 1024
const MAX_REFERENCED = 300
export const DSH_CARD_FORMAT_VERSION = 1

function invalid(message) { return Object.assign(new Error(message), { code: 'TAVERN_CARD_ARCHIVE_INVALID' }) }

async function readJson(zip, entryPath, label) {
  const entry = zip.entries.get(entryPath)
  if (!entry) throw invalid(label + '缺少 ' + entryPath)
  try { return JSON.parse((await zip.readBuffer(entry, 8 * 1024 * 1024)).toString('utf8')) }
  catch (error) { throw error?.code === 'TAVERN_ZIP_INVALID' ? error : invalid(entryPath + ' 不是有效的 JSON') }
}

function packPrefix(value, label) {
  const prefix = String(value || '').replace(/\/*$/, '/')
  const normalized = path.posix.normalize(prefix)
  if (!normalized.startsWith('assets/') || normalized.split('/').length !== 3 || normalized !== prefix) throw invalid(label + '的素材包路径应为 assets/<包名>/：' + value)
  const name = normalized.split('/')[1]
  if (RESERVED.has(name) || name.startsWith('x_')) throw invalid('素材包不能叫 ' + name + '（这是 CCv3 素材类型的保留名）')
  return normalized
}

/** Every embeded:// path a card's own asset lists point at. */
function referencedPaths(card) {
  const data = card && typeof card.data === 'object' && card.data ? card.data : card || {}
  const uris = []
  for (const asset of Array.isArray(data.assets) ? data.assets : []) uris.push(asset && asset.uri)
  for (const entry of Array.isArray(data.extensions?.risuai?.emotions) ? data.extensions.risuai.emotions : []) uris.push(Array.isArray(entry) ? entry[1] : null)
  for (const character of Array.isArray(data.extensions?.dsh_tavern?.cast?.characters) ? data.extensions.dsh_tavern.cast.characters : []) {
    uris.push(character && character.avatar, ...Object.values(character && character.sprites || {}))
  }
  return [...new Set(uris.filter(uri => typeof uri === 'string' && uri.startsWith('embeded://')).map(uri => uri.slice('embeded://'.length)))].slice(0, MAX_REFERENCED)
}

/**
 * What an archive holds: { kind, card, packs: [{ prefix, id, contentHash, format, title, credits }],
 * plugins, info, resolve(uri) }. Pack files are not read here; only the card's own asset files are.
 */
export async function readCardArchive(zip) {
  let kind, card, packs = [], plugins = [], info = null, defaults = null
  if (zip.entries.has('dsh.json')) {
    kind = 'dshcard'
    const manifest = await readJson(zip, 'dsh.json', 'DSH 人物卡')
    if (manifest.format !== 'dshcard') throw invalid('dsh.json 的 format 不是 dshcard')
    if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > DSH_CARD_FORMAT_VERSION) throw invalid('这张 DSH 人物卡的格式版本较新（' + manifest.formatVersion + '），请先更新 Tavern')
    card = await readJson(zip, 'card.json', 'DSH 人物卡')
    info = { version: String(manifest.card?.version || '').slice(0, 40), title: String(manifest.card?.title || '').slice(0, 120), author: String(manifest.card?.author || '').slice(0, 120),
      tavernApi: Number(manifest.requires?.tavernApi) || null }
    for (const pack of Array.isArray(manifest.packs) ? manifest.packs : []) {
      const prefix = packPrefix(pack.path, '素材包 ' + (pack.title || pack.id))
      if (!validPackId(pack.id)) throw invalid('素材包 id 无效：' + pack.id)
      packs.push({ prefix, id: pack.id, contentHash: pack.contentHash || undefined, format: pack.format || '', title: pack.title || '',
        credits: (Array.isArray(pack.credits) ? pack.credits : []).filter(file => typeof file === 'string' && file.startsWith(prefix)).map(file => file.slice(prefix.length)) })
    }
    plugins = (Array.isArray(manifest.plugins) ? manifest.plugins : []).map(plugin => ({ name: String(plugin?.name || ''), path: String(plugin?.path || ''), purpose: String(plugin?.purpose || '') }))
    defaults = await startDefaults(zip, manifest.defaults)
  } else if (zip.entries.has('dsh-tavern-card-bundle.json')) {
    // The Galgame fork's bundle: card/card.json, packs/<id>/, a cover beside the card.
    kind = 'bundle'
    const bundle = await readJson(zip, 'dsh-tavern-card-bundle.json', '卡包')
    if (bundle.format !== 'dsh-tavern-card-bundle') throw invalid('不认识的卡包格式：' + bundle.format)
    card = await readJson(zip, 'card/card.json', '卡包')
    for (const dependency of Array.isArray(bundle.dependencies) ? bundle.dependencies : []) {
      if (!validPackId(dependency.packId)) throw invalid('素材包 id 无效：' + dependency.packId)
      const prefix = 'packs/' + dependency.packId + '/'
      const manifest = zip.entries.has(prefix + 'manifest.json') ? await readJson(zip, prefix + 'manifest.json', '素材包') : {}
      if (dependency.embedded === false && !zip.entries.has(prefix + 'manifest.json')) continue
      packs.push({ prefix, id: dependency.packId, contentHash: dependency.contentHash || undefined, format: manifest.format || '', title: manifest.name || '',
        credits: Array.isArray(manifest.credits) ? manifest.credits.filter(file => typeof file === 'string') : [] })
    }
    const cover = bundle.cover && typeof bundle.cover.path === 'string' ? bundle.cover.path : ''
    const data = card.data && typeof card.data === 'object' ? card.data : card
    if (cover && zip.entries.has(cover) && !(Array.isArray(data.assets) && data.assets.some(asset => asset && asset.type === 'icon' && asset.name === 'main'))) {
      data.assets = [{ type: 'icon', uri: 'embeded://' + cover, name: 'main', ext: path.posix.extname(cover).slice(1) || 'png' }, ...(Array.isArray(data.assets) ? data.assets : [])]
    }
  } else {
    kind = 'charx'
    card = await readJson(zip, 'card.json', 'CHARX')
  }
  if (!card || typeof card !== 'object') throw invalid('人物卡数据不是 JSON 对象')
  const files = new Map()
  for (const file of referencedPaths(card)) {
    const entry = zip.entries.get(file)
    if (entry && entry.size <= MAX_REFERENCED_BYTES) files.set(file, await zip.readBuffer(entry, MAX_REFERENCED_BYTES))
  }
  const resolve = uri => {
    if (typeof uri !== 'string') return undefined
    if (uri.startsWith('embeded://')) return files.get(uri.slice('embeded://'.length))
    const match = /^data:[^,]*;base64,(.*)$/s.exec(uri)
    return match ? Buffer.from(match[1], 'base64') : undefined
  }
  return { kind, card, packs, plugins, info, defaults, resolve }
}

/**
 * What a new game of this card starts with (dsh.json `defaults`): a preset carried in the card
 * and a few game settings the author knows best. The player's own choices (model, name) never come from a card.
 */
async function startDefaults(zip, value) {
  if (!value || typeof value !== 'object') return null
  const result = {}
  // "presets/x.json", or { path, title } to give the preset a readable name in the library.
  const preset = typeof value.preset === 'string' ? { path: value.preset } : value.preset && typeof value.preset === 'object' ? value.preset : null
  if (preset && typeof preset.path === 'string' && preset.path) {
    const file = path.posix.normalize(preset.path)
    if (!/^presets\/[^/]+\.json$/i.test(file) || !zip.entries.has(file)) throw invalid('dsh.json 的 defaults.preset 应指向包内 presets/ 下的 JSON 预设：' + preset.path)
    const title = typeof preset.title === 'string' ? preset.title.replace(/[\\/:*?"<>|\r\n]/g, ' ').trim().slice(0, 80) : ''
    result.preset = { name: (title || file.slice('presets/'.length).replace(/\.json$/i, '')) + '.json', text: (await zip.readBuffer(zip.entries.get(file), 4 * 1024 * 1024)).toString('utf8') }
  }
  const settings = startSettings(value.settings)
  if (settings) result.settings = settings
  return Object.keys(result).length ? result : null
}

/** The game settings a card may suggest; anything else is ignored. */
export function startSettings(value) {
  if (!value || typeof value !== 'object') return null
  const result = {}
  if (value.statusBarPlacement === 'sidebar' || value.statusBarPlacement === 'body') result.statusBarPlacement = value.statusBarPlacement
  const tasks = value.backgroundTasks && typeof value.backgroundTasks === 'object' ? value.backgroundTasks : null
  if (tasks) {
    const picked = {}
    for (const key of ['posture', 'variables']) if (typeof tasks[key] === 'boolean') picked[key] = tasks[key]
    if (Object.keys(picked).length) result.backgroundTasks = picked
  }
  if (typeof value.webSearch === 'boolean') result.webSearchEnabled = value.webSearch
  return Object.keys(result).length ? result : null
}
