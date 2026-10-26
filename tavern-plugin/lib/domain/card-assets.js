import * as zlib from 'node:zlib'
import { CAST_EMOTIONS } from './cast-annotation.js'
import { readZipEntries, writeZipEntries } from './zip-entries.js'

// Character material carried by a card file (docs/design/tavern-to-galgame.md): Character Card V3
// `data.assets` in CHARX (`embeded://`), RisuAI PNG chunks (`chara-ext-asset_:N` → `__asset:N`),
// `data:` URIs in JSON, RisuAI's own `extensions.risuai.emotions`, and Tavern's `extensions.dsh_tavern.cast`.

const MAX_ASSETS = 300
const MAX_ASSET_BYTES = 20 * 1024 * 1024

// Names card authors give expressions, mapped to SillyTavern's 28 emotions.
const EMOTION_WORDS = {
  joy: ['happy', 'happiness', 'smile', 'smiling', 'glad', 'cheerful', 'laugh', 'laughing', 'grin', '高兴', '快乐', '微笑', '笑', '喜悦', '愉快', '大笑'],
  sadness: ['sad', 'unhappy', 'cry', 'crying', 'tears', 'depressed', '伤心', '悲伤', '哭', '哭泣', '失落'],
  anger: ['angry', 'mad', 'furious', 'rage', '愤怒', '发怒', '怒'],
  annoyance: ['annoyed', 'irritated', 'pout', '不耐烦'],
  embarrassment: ['embarrassed', 'shy', 'blush', 'blushing', 'flustered', '脸红', '尴尬', '羞涩', '羞'],
  surprise: ['surprised', 'shocked', 'shock', 'astonished', '吃惊', '震惊'],
  fear: ['afraid', 'scared', 'frightened', 'terrified', '恐惧', '惊恐'],
  nervousness: ['nervous', 'anxious', 'worried', '不安', '焦虑'],
  neutral: ['default', 'normal', 'idle', 'calm', 'base', 'main', '默认', '普通', '正常', '无表情', '常态', '立绘'],
  love: ['loving', 'affection', 'affectionate', 'heart', '爱', '喜欢', '心动'],
  disgust: ['disgusted', 'gross', '厌恶', '恶心'],
  confusion: ['confused', 'puzzled', '疑惑', '迷惑'],
  curiosity: ['curious', 'interested'],
  excitement: ['excited', '激动'],
  pride: ['proud', 'smug', '骄傲', '自豪'],
  disappointment: ['disappointed'],
  relief: ['relieved', '松了口气'],
  remorse: ['sorry', 'guilty', 'apologetic', '后悔', '内疚', '愧疚'],
  gratitude: ['grateful', 'thankful', 'thanks', '感谢'],
  caring: ['gentle', 'kind', '温柔'],
  desire: ['lust', 'seductive', '诱惑'],
  amusement: ['amused', 'funny', '好笑'],
  admiration: ['admire', '崇拜'],
  approval: ['agree', '认同'],
  disapproval: ['disapprove', 'frown', '皱眉'],
  optimism: ['hopeful'],
  realization: ['恍然大悟']
}
// name → [slot, rank]: the emotion's own name or label ranks 0, then synonyms in listed order.
const EMOTION_INDEX = new Map()
for (const [slot, label] of Object.entries(CAST_EMOTIONS)) { EMOTION_INDEX.set(slot, [slot, 0]); EMOTION_INDEX.set(label, [slot, 0]) }
for (const [slot, words] of Object.entries(EMOTION_WORDS)) words.forEach((word, index) => { if (!EMOTION_INDEX.has(word)) EMOTION_INDEX.set(word, [slot, index + 1]) })

function emotionEntry(name) {
  const text = String(name || '').trim().toLowerCase()
  if (!text) return null
  const plain = text.replace(/\.[a-z0-9]+$/, '').replace(/[\s_\-.]*\d+$/, '').replace(/[\s_-]+/g, ' ').trim()
  return EMOTION_INDEX.get(plain) || EMOTION_INDEX.get(plain.replace(/ /g, '')) || null
}

/** One of the 28 emotion names for an expression's name, or null. */
export function emotionSlot(name) { return emotionEntry(name)?.[0] || null }

/** How close a name is to its emotion: lower is closer ('sad' beats 'crying' for sadness). */
export function emotionRank(name) { return emotionEntry(name)?.[1] ?? Infinity }

function extOf(value, fallback = 'bin') {
  const ext = String(value || '').trim().toLowerCase().replace(/^\./, '')
  return /^[a-z0-9]{1,10}$/.test(ext) && ext !== 'unknown' ? ext : fallback
}

function pngTextChunks(buffer) {
  const chunks = new Map()
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return chunks
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8)
    const start = offset + 8, end = start + length
    if (end + 4 > buffer.length) break
    if (type === 'tEXt') {
      const separator = buffer.indexOf(0, start)
      if (separator >= start && separator < end) chunks.set(buffer.toString('latin1', start, separator), buffer.toString('latin1', separator + 1, end))
    }
    if (type === 'IEND') break
    offset = end + 4
  }
  return chunks
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0 })
const crc32 = typeof zlib.crc32 === 'function' ? data => zlib.crc32(data) : data => { let value = 0xffffffff; for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0 }

export function isPng(bytes) { return Buffer.isBuffer(bytes) && bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a }

const PNG_TEXT_TYPES = ['tEXt', 'zTXt', 'iTXt']

/** A `tEXt` chunk holding `text` base64-encoded under `keyword`, the way card PNGs store cards. */
export function pngCardTextChunk(keyword, text) {
  const body = Buffer.concat([Buffer.from('tEXt'), Buffer.from(keyword + '\u0000', 'latin1'), Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'latin1')])
  const chunk = Buffer.alloc(body.length + 8)
  chunk.writeUInt32BE(body.length - 4, 0); body.copy(chunk, 4); chunk.writeUInt32BE(crc32(body), body.length + 4)
  return chunk
}

/** The raw text chunks (tEXt/zTXt/iTXt, length and CRC included) of a PNG, in order. */
export function pngRawTextChunks(png) {
  const found = []
  if (!isPng(png)) return found
  let offset = 8
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), end = offset + 12 + length
    if (end > png.length || type === 'IEND') break
    if (PNG_TEXT_TYPES.includes(type)) found.push(png.subarray(offset, end))
    offset = end
  }
  return found
}

/** `png`'s pixels with its own text chunks dropped and `chunks` (raw chunk buffers) put before IEND. */
export function pngWithTextChunks(png, chunks) {
  if (!isPng(png)) throw new Error('卡面不是有效的 PNG')
  const parts = [png.subarray(0, 8)]
  let offset = 8
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), end = offset + 12 + length
    if (end > png.length) throw new Error('卡面 PNG 损坏')
    if (type === 'IEND') return Buffer.concat([...parts, ...chunks, png.subarray(offset, end)])
    if (!PNG_TEXT_TYPES.includes(type)) parts.push(png.subarray(offset, end))
    offset = end
  }
  throw new Error('卡面 PNG 缺少结束块')
}

/** A PNG cover carrying the card as a `ccv3` text chunk, its other text chunks dropped. */
export function pngWithCard(png, cardText) {
  return pngWithTextChunks(png, [pngCardTextChunk('ccv3', cardText)])
}

function decodeCardText(text) {
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object') throw new Error('人物卡数据不是 JSON 对象')
  return value
}

/**
 * The card JSON and a resolver for its asset URIs, from an import payload
 * ({ kind: 'charx' | 'png' | 'text', fileB64?, b64?, text? }).
 */
export function cardAssetSource(payload) {
  const kind = payload && payload.kind
  if (kind === 'charx') {
    const entries = readZipEntries(Buffer.from(String(payload.fileB64 || ''), 'base64'), { label: 'CHARX' })
    const json = entries.get('card.json')
    if (!json) throw new Error('CHARX 里没有 card.json')
    return { card: decodeCardText(json.toString('utf8')), resolve: uri => uri.startsWith('embeded://') ? entries.get(uri.slice('embeded://'.length)) : dataUri(uri), entries }
  }
  if (kind === 'png') {
    const chunks = pngTextChunks(Buffer.from(String(payload.fileB64 || ''), 'base64'))
    const cardText = chunks.get('ccv3') || chunks.get('chara') || payload.b64 || ''
    const card = cardText ? decodeCardText(Buffer.from(cardText, 'base64').toString('utf8')) : null
    return { card, resolve: uri => {
      if (uri.startsWith('__asset:')) { const value = chunks.get('chara-ext-asset_:' + uri.slice(8)) ?? chunks.get('chara-ext-asset_' + uri.slice(8)); return value ? Buffer.from(value, 'base64') : undefined }
      return dataUri(uri)
    } }
  }
  if (kind === 'text') return { card: decodeCardText(String(payload.text || '')), resolve: dataUri }
  return { card: null, resolve: () => undefined }
}

function dataUri(uri) {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(String(uri))
  return match ? Buffer.from(match[1], 'base64') : undefined
}

/**
 * What a card brings along: the main character's expressions, backgrounds, a non-PNG cover,
 * Tavern's own cast entry, and everything else kept as-is so it can be exported again.
 */
export function collectCardAssets(card, resolve) {
  const data = card && typeof card.data === 'object' && card.data ? card.data : card || {}
  const result = { emotions: [], backgrounds: [], cover: null, extras: [], cast: [], skipped: 0 }
  const resolved = new Map()
  const read = uri => {
    if (typeof uri !== 'string') return undefined
    if (resolved.has(uri)) return resolved.get(uri)
    const bytes = resolve(uri)
    if (!bytes?.length || bytes.length > MAX_ASSET_BYTES) return undefined
    if (resolved.size >= MAX_ASSETS) throw new Error('人物卡素材超过 ' + MAX_ASSETS + ' 个，导入已停止，请减少素材后重试')
    const copy = Buffer.from(bytes)
    resolved.set(uri, copy)
    return copy
  }
  for (const asset of Array.isArray(data.assets) ? data.assets : []) {
    if (!asset || typeof asset.uri !== 'string' || asset.uri === 'ccdefault:') continue
    const type = String(asset.type || 'other'), name = String(asset.name || '').slice(0, 100), ext = extOf(asset.ext)
    const bytes = read(asset.uri)
    if (!bytes) { if (!/^https?:/i.test(asset.uri)) result.skipped += 1; continue }
    if (type === 'emotion') result.emotions.push({ name, ext, bytes })
    else if (type === 'background') result.backgrounds.push({ name, ext, bytes })
    else if (type === 'icon' && name === 'main') result.cover = { ext, bytes }
    else result.extras.push({ type, name, ext, bytes })
  }
  // RisuAI writes expressions here when exporting v2 cards.
  const risu = data.extensions && data.extensions.risuai
  for (const entry of Array.isArray(risu && risu.emotions) ? risu.emotions : []) {
    if (!Array.isArray(entry) || result.emotions.some(item => item.name === String(entry[0]))) continue
    const bytes = read(String(entry[1] || ''))
    if (bytes) result.emotions.push({ name: String(entry[0] || '').slice(0, 100), ext: 'png', bytes })
    else result.skipped += 1
  }
  const own = data.extensions && data.extensions.dsh_tavern && data.extensions.dsh_tavern.cast
  for (const character of Array.isArray(own && own.characters) ? own.characters : []) {
    if (!character || typeof character.name !== 'string') continue
    const sprites = {}
    for (const [slot, uri] of Object.entries(character.sprites || {})) {
      const bytes = Object.hasOwn(CAST_EMOTIONS, slot) && read(uri)
      if (bytes) sprites[slot] = bytes
      else result.skipped += 1
    }
    const avatar = character.avatar ? read(character.avatar) : null
    if (character.avatar && !avatar) result.skipped += 1
    // Reference clips ({ audio, text }, cast-presentation.md 22/N): checked once as the card's material is stored (cast-assets.js).
    const voiceReferences = []
    for (const clip of Array.isArray(character.voiceReferences) ? character.voiceReferences : []) {
      const audio = clip && read(clip.audio)
      if (audio) voiceReferences.push({ audio, text: clip.text })
      else result.skipped += 1
    }
    result.cast.push({ name: character.name, aliases: Array.isArray(character.aliases) ? character.aliases.filter(alias => typeof alias === 'string') : [],
      avatar: avatar || null, sprites,
      voices: character.voices && typeof character.voices === 'object' ? Object.fromEntries(Object.entries(character.voices).filter(([, voice]) => typeof voice === 'string')) : {},
      ...(voiceReferences.length ? { voiceReferences } : {}),
      ...(character.voiceSource && typeof character.voiceSource === 'object' ? { voiceSource: character.voiceSource } : {}),
      ...(typeof character.voiceLanguage === 'string' ? { voiceLanguage: character.voiceLanguage } : {}) })
  }
  return result
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'])

/**
 * A CHARX file: the card as Character Card V3 with the card's character material.
 * Standard places for what CCv3 has (cover, the main character's expressions, backgrounds,
 * kept extras); the rest of the cast in `extensions.dsh_tavern.cast`.
 */
export function buildCharx({ document, cover, manifest, characterName, readFile }) {
  const card = structuredClone(document)
  const data = card.data = card.data && typeof card.data === 'object' ? card.data : {}
  card.spec = 'chara_card_v3'
  card.spec_version = '3.0'
  if (!Array.isArray(data.group_only_greetings)) data.group_only_greetings = []
  const files = [], paths = new Map(), used = new Set()
  function place(type, file, name) {
    if (!file) return null
    const key = type + '\u0000' + file
    if (paths.has(key)) return paths.get(key)
    const bytes = readFile(file)
    if (!bytes) return null
    const ext = extOf(file.split('.').pop())
    const kind = IMAGE_EXTENSIONS.has(ext) ? 'image' : /^(mp3|wav|ogg|flac|aac|m4a)$/.test(ext) ? 'audio' : 'other'
    const safeType = String(type).replace(/[^a-z0-9_-]/gi, '_') || 'other'
    let base = String(name || 'asset').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'asset', path = 'assets/' + safeType + '/' + kind + '/' + base + '.' + ext
    for (let index = 1; used.has(path); index++) path = 'assets/' + safeType + '/' + kind + '/' + base + '_' + index + '.' + ext
    used.add(path)
    files.push({ path, content: Buffer.from(bytes) })
    const uri = 'embeded://' + path
    paths.set(key, uri)
    return uri
  }
  const assets = (Array.isArray(data.assets) ? data.assets : []).filter(asset => asset && /^https?:/i.test(String(asset.uri)))
  const characters = manifest.characters || []
  const main = characters.find(item => item.name === characterName || (item.aliases || []).includes(characterName)) || null
  if (cover) {
    used.add('assets/icon/image/main.png')
    files.push({ path: 'assets/icon/image/main.png', content: Buffer.from(cover) })
    assets.push({ type: 'icon', uri: 'embeded://assets/icon/image/main.png', name: 'main', ext: 'png' })
  } else if (main && main.avatar) {
    assets.push({ type: 'icon', uri: place('icon', main.avatar, 'main'), name: 'main', ext: extOf(main.avatar.split('.').pop()) })
  } else assets.push({ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' })
  for (const [slot, file] of Object.entries(main ? main.sprites || {} : {})) {
    const uri = place('emotion', file, slot)
    if (uri) assets.push({ type: 'emotion', uri, name: slot, ext: extOf(file.split('.').pop()) })
  }
  ;(manifest.backgrounds || []).forEach((background, index) => {
    const uri = place('background', background.file, index === 0 ? 'main' : background.name)
    if (uri) assets.push({ type: 'background', uri, name: index === 0 ? 'main' : background.name || 'background_' + index, ext: extOf(background.file.split('.').pop()) })
  })
  for (const extra of manifest.extras || []) {
    const uri = place(extra.type, extra.file, extra.name)
    if (uri) assets.push({ type: extra.type, uri, name: extra.name, ext: extra.ext })
  }
  data.assets = assets
  const cast = characters.map(character => ({
    name: character.name, aliases: character.aliases || [],
    avatar: character.avatar ? place('x_dsh_cast', character.avatar, character.name + '_avatar') : null,
    sprites: Object.fromEntries(Object.entries(character.sprites || {}).map(([slot, file]) => [slot, character === main ? place('emotion', file, slot) : place('x_dsh_cast', file, character.name + '_' + slot)]).filter(([, uri]) => uri)),
    voices: character.voices || {},
    ...(character.voiceReferences?.length ? { voiceReferences: character.voiceReferences
      .map((clip, index) => ({ audio: place('x_dsh_cast', clip.file, character.name + '_voice_' + (index + 1)), text: clip.text })).filter(clip => clip.audio) } : {}),
    ...(character.voiceSource ? { voiceSource: character.voiceSource } : {}),
    ...(character.voiceLanguage ? { voiceLanguage: character.voiceLanguage } : {})
  }))
  data.extensions = { ...(data.extensions && typeof data.extensions === 'object' ? data.extensions : {}) }
  data.extensions.dsh_tavern = { ...(data.extensions.dsh_tavern && typeof data.extensions.dsh_tavern === 'object' ? data.extensions.dsh_tavern : {}) }
  if (cast.length) data.extensions.dsh_tavern.cast = { version: 1, characters: cast }
  else delete data.extensions.dsh_tavern.cast
  if (!Object.keys(data.extensions.dsh_tavern).length) delete data.extensions.dsh_tavern
  if (files.length > MAX_ASSETS) throw new Error('人物卡素材超过 ' + MAX_ASSETS + ' 个，无法生成可完整导入的 CHARX')
  return writeZipEntries([{ path: 'card.json', content: JSON.stringify(card, null, 2) }, ...files], { readable: true, label: 'CHARX' })
}

/**
 * A card read from an archive (CHARX, DSH card, card bundle) as what Tavern stores for a card:
 * a PNG (its PNG cover with the card inside) or, with any other cover, plain JSON; plus its material.
 */
export function cardImportFromCard({ card, resolve, name }) {
  const collected = collectCardAssets(card, resolve)
  const text = JSON.stringify(card)
  const base = String(name || '人物卡').replace(/\.(charx|dshcard|zip)$/i, '') || '人物卡'
  if (collected.cover && isPng(collected.cover.bytes)) {
    const png = pngWithCard(collected.cover.bytes, text)
    return { payload: { kind: 'png', name: base + '.png', b64: Buffer.from(text, 'utf8').toString('base64'), fileB64: png.toString('base64') }, collected: { ...collected, cover: null } }
  }
  return { payload: { kind: 'text', name: base + '.json', text }, collected }
}

/** A card import with the material it carries; a CHARX sent whole is read like an archive. */
export function cardImport(payload) {
  const source = cardAssetSource(payload)
  if (payload?.kind !== 'charx') return { payload, collected: source.card ? collectCardAssets(source.card, source.resolve) : null }
  return cardImportFromCard({ card: source.card, resolve: source.resolve, name: payload.name })
}
