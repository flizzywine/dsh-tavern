import { createHash } from 'node:crypto'
import { CAST_EMOTIONS } from './cast-annotation.js'
import { readZipEntries } from './zip-entries.js'
import { emotionRank, emotionSlot as emotionSlotOf } from './card-assets.js'

// Per-card character material (Wiki「设计：cast-presentation」): avatar and expression sprites
// per character, laid out like a SillyTavern sprite pack so such packs import as they are.
const hash = value => createHash('sha256').update(value).digest('hex')
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_EXTRA_BYTES = 20 * 1024 * 1024
const MAX_CHARACTERS = 64
const MAX_NAME = 24
const IMAGE_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })

function invalid(message) { return Object.assign(new Error(message), { code: 'TAVERN_CAST_INVALID' }) }

export function castName(value) {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!name || [...name].length > MAX_NAME || /[\\/]/.test(name)) throw invalid('人物名需要 1–' + MAX_NAME + ' 个字，不能含斜杠')
  return name
}

function slotOf(value) {
  if (value === 'avatar' || Object.hasOwn(CAST_EMOTIONS, value)) return value
  throw invalid('图片位置只能是头像或 ST 的 28 个情绪名之一')
}

/** The image type from its bytes, never from a name the user chose. */
export function imageExtension(bytes) {
  const head = Buffer.from(bytes.subarray(0, 12))
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  if (head.subarray(0, 3).toString('latin1') === 'GIF') return 'gif'
  return null
}

export function createCastAssets({ store }) {
  const dirOf = cardPath => 'cast-assets/' + hash(String(cardPath))
  const empty = () => ({ version: 1, characters: [] })
  const valid = value => value && value.version === 1 && Array.isArray(value.characters)

  async function read(cardPath) {
    const value = cardPath ? await store.readJson(dirOf(cardPath) + '/cast.json') : null
    return valid(value) ? value : empty()
  }

  // Publish the manifest only after all images exist. Keeping the source until
  // then makes a failed copy safe to retry through Resource Graph recovery.
  async function movePath(from, to) {
    if (!from || !to || from === to) return
    const source = dirOf(from), target = dirOf(to)
    const manifest = await store.readJson(source + '/cast.json')
    if (!valid(manifest)) return
    const files = new Set([...manifest.characters.flatMap(character => [character.avatar, ...Object.values(character.sprites || {})]),
      ...(manifest.backgrounds || []).map(item => item.file), ...(manifest.extras || []).map(item => item.file)].filter(Boolean))
    for (const file of files) {
      const bytes = await store.readBytes(source + '/files/' + file)
      if (!bytes) throw new Error('人物素材文件不存在: ' + file)
      await store.writeBytes(target + '/files/' + file, bytes)
    }
    await store.writeJson(target + '/cast.json', manifest)
    await store.remove(source + '/cast.json')
  }

  async function update(cardPath, change) {
    if (!cardPath) throw invalid('这一局没有绑定人物卡')
    let result
    await store.updateJson(dirOf(cardPath) + '/cast.json', current => {
      const value = valid(current) ? current : empty()
      result = change(value)
      return value
    })
    return result
  }

  function characterIn(manifest, name, create) {
    let character = manifest.characters.find(item => item.name === name || (item.aliases || []).includes(name))
    if (!character && create) {
      if (manifest.characters.length >= MAX_CHARACTERS) throw invalid('一张卡最多 ' + MAX_CHARACTERS + ' 个人物')
      character = { name, aliases: [], avatar: null, sprites: {} }
      manifest.characters.push(character)
    }
    return character || null
  }

  /** Store one image, content-addressed, so a browser may cache its URL forever. */
  async function writeImage(cardPath, bytes) {
    if (!bytes?.length) throw invalid('图片为空')
    if (bytes.length > MAX_IMAGE_BYTES) throw invalid('单张图片不能超过 8 MB')
    const extension = imageExtension(bytes)
    if (!extension) throw invalid('只支持 PNG、JPEG、WebP、GIF 图片')
    const file = hash(bytes).slice(0, 32) + '.' + extension
    await store.writeBytes(dirOf(cardPath) + '/files/' + file, bytes)
    return file
  }

  async function setImage({ cardPath, name, slot, bytes }) {
    const character = castName(name), at = slotOf(slot)
    const file = await writeImage(cardPath, bytes)
    await update(cardPath, manifest => {
      const target = characterIn(manifest, character, true)
      if (at === 'avatar') target.avatar = file
      else target.sprites[at] = file
    })
    return read(cardPath)
  }

  async function removeImage({ cardPath, name, slot }) {
    const character = castName(name), at = slotOf(slot)
    await update(cardPath, manifest => {
      const target = characterIn(manifest, character, false)
      if (!target) return
      if (at === 'avatar') target.avatar = null
      else delete target.sprites[at]
    })
    return read(cardPath)
  }

  async function setCharacter({ cardPath, name, rename, aliases }) {
    const character = castName(name)
    const next = rename === undefined ? character : castName(rename)
    const list = Array.isArray(aliases) ? [...new Set(aliases.map(castName))].filter(alias => alias !== next).slice(0, 8) : undefined
    await update(cardPath, manifest => {
      const target = characterIn(manifest, character, true)
      if (next !== character && manifest.characters.some(item => item !== target && (item.name === next || (item.aliases || []).includes(next)))) throw invalid('已有人物叫「' + next + '」')
      target.name = next
      if (list) target.aliases = list
    })
    return read(cardPath)
  }

  /** A character's voice for one speech provider (Wiki「设计：cast-presentation」); '' clears it. */
  async function setVoice({ cardPath, name, provider, voice }) {
    const character = castName(name)
    if (typeof provider !== 'string' || !/^[a-z0-9][a-z0-9._/-]{0,96}$/.test(provider)) throw invalid('配音渠道无效')
    const value = typeof voice === 'string' ? voice.trim() : ''
    if ([...value].length > 300) throw invalid('声音设置最多 300 字')
    await update(cardPath, manifest => {
      const target = characterIn(manifest, character, Boolean(value))
      if (!target) return
      const voices = { ...(target.voices || {}) }
      if (value) voices[provider] = value
      else delete voices[provider]
      target.voices = voices
    })
    return read(cardPath)
  }

  async function removeCharacter({ cardPath, name }) {
    const character = castName(name)
    await update(cardPath, manifest => { manifest.characters = manifest.characters.filter(item => item.name !== character) })
    return read(cardPath)
  }

  /**
   * Import a SillyTavern sprite pack: `joy.png`… for one character (named by `name`),
   * or `角色名/joy.png`… for several. Files whose name is not an emotion are skipped.
   */
  async function importSpritePack({ cardPath, name, bytes }) {
    const entries = readZipEntries(bytes, { label: '立绘包' })
    const fallback = name === undefined ? null : castName(name)
    const images = []
    let skipped = 0
    for (const [path, data] of entries) {
      const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
      if (!parts.length || parts.some(part => part.startsWith('.') || part === '__MACOSX')) continue
      const base = parts.at(-1).replace(/\.[^.]+$/, '').toLowerCase()
      const owner = parts.length >= 2 ? parts.at(-2) : fallback
      if (!Object.hasOwn(CAST_EMOTIONS, base) || !owner || !imageExtension(data)) { skipped += 1; continue }
      images.push({ owner: castName(owner), slot: base, data })
    }
    if (!images.length) throw invalid('压缩包里没有按情绪命名的图片（例如 joy.png、sadness.png）')
    const written = []
    for (const image of images) written.push({ ...image, file: await writeImage(cardPath, image.data) })
    await update(cardPath, manifest => {
      for (const image of written) characterIn(manifest, image.owner, true).sprites[image.slot] = image.file
    })
    return { cast: await read(cardPath), imported: written.length, skipped, characters: [...new Set(written.map(image => image.owner))] }
  }

  /** A file kept only to be exported again (audio, models, unrecognized expressions). */
  async function writeExtra(cardPath, bytes, ext) {
    if (!bytes?.length) throw invalid('文件为空')
    if (bytes.length > MAX_EXTRA_BYTES) throw invalid('单个素材不能超过 20 MB')
    const file = hash(bytes).slice(0, 32) + '.' + (/^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin')
    await store.writeBytes(dirOf(cardPath) + '/files/' + file, bytes)
    return file
  }

  /**
   * Material a card file carried (see card-assets.js collectCardAssets): the main character's
   * expressions and avatar, backgrounds, Tavern's own cast entry; anything not usable is kept.
   */
  async function importCardAssets({ cardPath, name, collected }) {
    const owner = castName(name)
    const image = async (bytes) => imageExtension(bytes) && bytes.length <= MAX_IMAGE_BYTES ? writeImage(cardPath, bytes) : null
    const summary = { sprites: 0, backgrounds: 0, avatars: 0, kept: 0, unmatched: [] }
    const sprites = [], backgrounds = [], extras = [], cast = []
    let avatar = null
    const taken = new Set()
    // The closest name gets each emotion: 'sad' rather than 'crying' for sadness.
    const ordered = collected.emotions.map((emotion, index) => ({ emotion, index })).sort((left, right) => emotionRank(left.emotion.name) - emotionRank(right.emotion.name) || left.index - right.index).map(item => item.emotion)
    for (const emotion of ordered) {
      const slot = emotionSlotOf(emotion.name)
      const file = slot && !taken.has(slot) ? await image(emotion.bytes) : null
      if (file) { taken.add(slot); sprites.push({ slot, file }); continue }
      extras.push({ type: 'emotion', name: emotion.name, ext: emotion.ext, file: await writeExtra(cardPath, emotion.bytes, emotion.ext) })
      if (!slot) summary.unmatched.push(emotion.name)
    }
    for (const background of collected.backgrounds) {
      const file = await image(background.bytes)
      if (file) backgrounds.push({ name: background.name, file })
      else extras.push({ type: 'background', name: background.name, ext: background.ext, file: await writeExtra(cardPath, background.bytes, background.ext) })
    }
    if (collected.cover) {
      avatar = await image(collected.cover.bytes)
      if (!avatar) extras.push({ type: 'icon', name: 'main', ext: collected.cover.ext, file: await writeExtra(cardPath, collected.cover.bytes, collected.cover.ext) })
    }
    for (const extra of collected.extras) extras.push({ type: extra.type.slice(0, 40), name: extra.name, ext: extra.ext, file: await writeExtra(cardPath, extra.bytes, extra.ext) })
    for (const character of collected.cast) {
      let person
      try { person = castName(character.name) } catch { continue }
      const entry = { name: person, aliases: character.aliases.map(alias => { try { return castName(alias) } catch { return null } }).filter(Boolean).slice(0, 8), avatar: character.avatar ? await image(character.avatar) : null, sprites: {}, voices: character.voices }
      for (const [slot, bytes] of Object.entries(character.sprites)) { const file = await image(bytes); if (file) entry.sprites[slot] = file }
      cast.push(entry)
    }
    await update(cardPath, manifest => {
      const main = characterIn(manifest, owner, sprites.length > 0 || Boolean(avatar))
      if (main) {
        for (const sprite of sprites) main.sprites[sprite.slot] = sprite.file
        if (avatar && !main.avatar) main.avatar = avatar
      }
      for (const entry of cast) {
        if (manifest.characters.length >= MAX_CHARACTERS && !characterIn(manifest, entry.name, false)) continue
        const target = characterIn(manifest, entry.name, true)
        target.aliases = [...new Set([...(target.aliases || []), ...entry.aliases])].filter(alias => alias !== target.name).slice(0, 8)
        if (entry.avatar) target.avatar = entry.avatar
        Object.assign(target.sprites, entry.sprites)
        if (Object.keys(entry.voices).length) target.voices = { ...(target.voices || {}), ...entry.voices }
      }
      manifest.backgrounds = [...(manifest.backgrounds || []), ...backgrounds.filter(item => !(manifest.backgrounds || []).some(existing => existing.file === item.file))]
      manifest.extras = [...(manifest.extras || []), ...extras.filter(item => !(manifest.extras || []).some(existing => existing.file === item.file && existing.type === item.type))]
    })
    summary.sprites = sprites.length + cast.reduce((total, entry) => total + Object.keys(entry.sprites).length, 0)
    summary.backgrounds = backgrounds.length
    summary.avatars = (avatar ? 1 : 0) + cast.filter(entry => entry.avatar).length
    summary.kept = extras.length
    return summary
  }

  /** The asset packs a card carries (asset-packs.js), by id and content hash; replaces the list. */
  async function bindPacks(cardPath, packs) {
    await update(cardPath, manifest => {
      manifest.packs = packs.map(pack => ({ id: pack.id, contentHash: pack.contentHash, format: pack.format || '', title: pack.title || '', name: pack.name || '' }))
    })
    return read(cardPath)
  }

  /** The plugins a card carries (card-plugins.js) and whether the player turned them on. */
  async function setPlugins(cardPath, plugins) {
    await update(cardPath, manifest => {
      manifest.plugins = plugins.map(plugin => ({ folder: plugin.folder, name: plugin.name, sha256: plugin.sha256, purpose: plugin.purpose || '', files: plugin.files || 0, bytes: plugin.bytes || 0, enabled: plugin.enabled === true }))
    })
    return read(cardPath)
  }

  /** Whether this card's games show the stage (off unless the player or the card turns it on). */
  async function setStage(cardPath, on) {
    await update(cardPath, manifest => { if (on) manifest.stage = true; else delete manifest.stage })
    return read(cardPath)
  }

  /** The file the card was imported from (card-import-identity.js): { archiveSha256, cardSha256 }. */
  async function setSource(cardPath, source) {
    await update(cardPath, manifest => { if (source) manifest.source = source; else delete manifest.source })
    return read(cardPath)
  }

  /** What a new game of this card starts with (card-archive.js startDefaults): { presetPath?, settings? }. */
  async function setStartDefaults(cardPath, defaults) {
    await update(cardPath, manifest => { if (defaults) manifest.startDefaults = defaults; else delete manifest.startDefaults })
    return read(cardPath)
  }

  /** Bytes of one of the card's material files, for export. */
  async function readFile(cardPath, file) {
    if (!/^[0-9a-f]{32}\.[a-z0-9]{1,10}$/.test(String(file))) return undefined
    return await store.readBytes(dirOf(cardPath) + '/files/' + file) || undefined
  }

  /** One stored image by the card's key (see keyOf), as the asset route serves it. */
  async function readImage(key, file) {
    if (!/^[0-9a-f]{64}$/.test(String(key)) || !/^[0-9a-f]{32}\.(png|jpg|webp|gif)$/.test(String(file))) return undefined
    const bytes = await store.readBytes('cast-assets/' + key + '/files/' + file)
    return bytes ? { bytes, mediaType: IMAGE_TYPES[file.split('.').pop()] } : undefined
  }

  return Object.freeze({ read, movePath, setImage, removeImage, setCharacter, setVoice, removeCharacter, importSpritePack, importCardAssets, bindPacks, setPlugins, setStage, setStartDefaults, setSource, readFile, readImage, keyOf: cardPath => hash(String(cardPath)) })
}
