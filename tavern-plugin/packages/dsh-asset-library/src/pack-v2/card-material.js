// A card's loose material (CCv3 expressions and backgrounds, extensions.dsh_tavern.cast) as one library pack named after
// the card, and the figures of a card's packs back as cast material for a CHARX export. The card side names the emotions
// (the host's card vocabulary); this side only places images, avatars and voices.
import { createHash } from 'node:crypto'
import imageContract from '../shared/sprite-images.cjs'
import { castVoice, castVoiceFields } from '../shared/cast-voice.js'
import { BLOB_MIME_TYPES } from '../asset-packs/manifest.js'
import { canonicalJson } from '../asset-packs/common.js'
import { assetContent } from '../shared/asset-variant-content.js'
import { jsonBytes, sealPack } from './validation.js'
import { audioKind, imageKind } from './media.js'

// The name-based UUID namespace of card material packs: the same material always names the same pack.
const CARD_MATERIAL_NAMESPACE = Buffer.from('85cbd1d7e4494ec7ae994deaf3b18c2c', 'hex')
function uuidV5(name, namespace = CARD_MATERIAL_NAMESPACE) {
  const bytes = createHash('sha1').update(namespace).update(name).digest().subarray(0, 16)
  bytes[6] = bytes[6] & 0x0f | 0x50; bytes[8] = bytes[8] & 0x3f | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

/**
 * The pack of a card's material: { name, characters:[{ name, aliases, avatar, sprites:[{emotion, label, bytes}] (resting
 * first; the label is the card's own name for the expression), voiceReferences:[{audio, text}], voiceSource, voiceLanguage,
 * voices }], backgrounds:[{ name, bytes }] }. `channels`: the voice service kinds configured here (cast-voice.js).
 * The pack id is a v5 UUID of the pack's content (figures, media by hash, voices as mapped here), not of its name, so one
 * id always means one content. Without a usable figure or background there is no manifest, only the notices.
 */
export async function cardMaterialPack({name, characters = [], backgrounds = []}, channels) {
  const blobs = {}, files = new Map(), hashed = new Map(), notices = []
  let skipped = 0
  const media = (bytes, kind) => {
    const ext = kind === 'audio' ? audioKind(bytes) : imageKind(bytes)
    if (!ext) { skipped += 1; return null }
    const hash = createHash('sha256').update(bytes).digest('hex'), file = `media/${hash}.${ext}`
    if (!blobs[hash]) { blobs[hash] = {ext, mime:BLOB_MIME_TYPES[ext], size:bytes.length}; files.set(file, bytes); hashed.set(file, hash) }
    return hash
  }
  const cast = []
  for (const character of characters) {
    const avatar = character.avatar ? media(character.avatar, 'image') : null
    const sprites = (character.sprites || []).map(sprite => ({emotion:sprite.emotion, label:sprite.label, media:media(sprite.bytes, 'image')})).filter(sprite => sprite.media)
    const references = (character.voiceReferences || []).map(clip => ({media:media(clip.audio, 'audio'), text:typeof clip.text === 'string' ? clip.text : ''})).filter(clip => clip.media)
    const key = 'cast-' + (cast.length + 1)
    const {voice, binding, dropped} = castVoice({name:character.name, references, voiceSource:character.voiceSource, voiceLanguage:character.voiceLanguage, voices:character.voices}, channels, key)
    if (dropped) notices.push(character.name + '的声音来源 ' + dropped + ' 没有对应渠道，已忽略')
    if (sprites.length || avatar || voice) cast.push({name:character.name, aliases:character.aliases || [], avatar, sprites, key, voice, binding})
  }
  const scenes = backgrounds.map(background => ({name:background.name, media:media(background.bytes, 'image')})).filter(background => background.media)
  if (skipped) notices.push('「' + name + '」有 ' + skipped + ' 个素材格式不支持，没有放进素材包')
  if (!cast.length && !scenes.length) return {notices}
  const packId = uuidV5(canonicalJson({characters:cast, backgrounds:scenes}))
  const manifest = {format:'dsh-asset-pack', schemaVersion:1, id:packId, name, contentHash:'0'.repeat(64), assets:[], figures:[], sprites:{}, bundles:{}, blobs, files:[]}
  const voices = {}
  cast.forEach((character, index) => {
    const id = uuidV5(String(index), Buffer.from(packId.replaceAll('-', ''), 'hex')), {key, voice, binding} = character
    const figure = {schemaVersion:1, id, name:character.name, ...(character.aliases?.length ? {aliases:character.aliases} : {}), enabled:true, recall:{mode:'constant'},
      appearance:character.sprites.length ? 'sprite' : 'avatar', outfits:[]}
    if (character.sprites.length) {
      const rest = character.sprites[0].emotion, assets = {}, emotions = {}
      for (const sprite of character.sprites) { const src = 'assets/' + sprite.emotion + '.' + blobs[sprite.media].ext; assets[src] = sprite.media; emotions[sprite.emotion] = {src} }
      manifest.sprites[key] = 'sprites/' + key + '/manifest.json'
      files.set(manifest.sprites[key], jsonBytes({version:1, kind:'static-sprites', emotions}))
      figure.emotions = character.sprites.map(sprite => ({id:sprite.emotion, label:sprite.label}))
      figure.outfits.push({key:'default', label:'默认', enabled:true, defaultEmotion:rest, sprite:{manifestKey:key, assets}, ...(character.avatar ? {avatars:{[rest]:character.avatar}} : {})})
    } else if (character.avatar) {
      figure.emotions = [{id:'calm'}]
      figure.outfits.push({key:'default', label:'默认', enabled:true, avatars:{calm:character.avatar}})
    }
    if (voice) { voices[key] = voice; figure.voice = binding }
    manifest.figures.push(id)
    files.set('figures/' + id + '.json', jsonBytes(figure))
  })
  scenes.forEach((background, index) => manifest.assets.push({kind:'backgrounds', id:'bg-' + (index + 1), name:background.name || '背景 ' + (index + 1), enabled:true,
    recall:{mode:'constant', keywords:[]}, directorNote:'', media:background.media}))
  if (Object.keys(voices).length) manifest.voiceLibrary = {version:1, voices}
  await sealPack(manifest, files, undefined, hashed)
  return {manifest, files, notices}
}

// The image an outfit shows for one emotion: its own picture only, never a stand-in.
function outfitImage(outfit, sprite, emotion) {
  const table = imageContract.spriteImageTable(sprite)
  const entry = imageContract.spriteUsesImages(sprite) ? table?.[outfit.sprite.imagePools?.[emotion]?.defaultImageId] : table?.[emotion]
  const src = entry?.src || entry?.stage?.src
  return src ? outfit.sprite.assets[src] || null : null
}

/**
 * A pack's figures as cast material: each enabled figure's first enabled outfit (its emotion pictures, their labels and the
 * resting avatar) and its voice fields, media by hash. Backgrounds as {name, media}.
 */
export function cardMaterialProjection({manifest, figures, sprites}) {
  const characters = []
  for (const id of manifest.figures) {
    const figure = figures[id]
    if (!figure.enabled) continue
    const outfit = figure.outfits.find(item => item.enabled), images = {}, labels = {}
    if (outfit?.sprite) for (const row of figure.emotions || []) {
      const hash = outfitImage(outfit, sprites[outfit.sprite.manifestKey], row.id)
      if (hash) { images[row.id] = hash; if (row.label) labels[row.id] = row.label }
    }
    const avatars = outfit?.avatars || {}
    const avatar = avatars[outfit?.defaultEmotion ?? figure.emotions?.[0]?.id] || Object.values(avatars)[0] || null
    const voice = figure.voice && manifest.voiceLibrary?.voices[figure.voice.voice]
    characters.push({name:figure.name, aliases:figure.aliases || [], avatar, sprites:images, labels, ...(voice ? castVoiceFields(voice, figure.voice) : {})})
  }
  const backgrounds = manifest.assets.filter(asset => asset.kind === 'backgrounds' && asset.enabled).map(asset => ({name:asset.name, media:assetContent(asset).media})).filter(row => row.media)
  return {characters, backgrounds}
}
