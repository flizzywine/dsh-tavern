import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { normalizeCharacterLoras } from './comfy-dynamic.js'
import { normalizeReferenceImage } from './reference-images.js'

/**
 * 人物库 record access for other editors (Tavern's asset library) through tavern.registerImageLibrary.
 * The image plugin stays the only store: callers read a snapshot and write back the subset they edit,
 * guarded by the snapshot they read (compare-and-set). The full schema is in README「共用人物记录」.
 */
export const CHARACTER_LIBRARY_VERSION = 4
const TEXT = ['name', 'match', 'consistencyText', 'imagePrompt']
const OUTFIT_TEXT = ['name', 'upper', 'lower', 'shoes', 'accessory', 'full', 'back', 'negative', 'consistencyText', 'imagePrompt']
const IMAGES = ['referenceImage', 'characterOutfitImage']
const fail = (code, message) => Object.assign(new Error(message), { code })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function only(value, allowed, label) {
  if (!object(value)) throw fail('INVALID_ARGUMENT', label + ' 必须是对象')
  const extra = Object.keys(value).filter(key => !allowed.includes(key))
  if (extra.length) throw fail('INVALID_ARGUMENT', label + ' 不支持字段：' + extra.join('、') + '（可写：' + allowed.join('、') + '）')
}
function texts(value, names, label) {
  for (const name of names) if (Object.hasOwn(value, name) && (typeof value[name] !== 'string' || value[name].length > 8000)) throw fail('INVALID_ARGUMENT', label + '.' + name + ' 必须是不超过 8000 字的文字')
}
function images(value, names, label) {
  for (const name of names) if (Object.hasOwn(value, name) && value[name] !== null && !normalizeReferenceImage(value[name])) throw fail('INVALID_ARGUMENT', label + '.' + name + ' 请使用 putReferenceImage 返回的图片标识，或 null 表示移除')
}

/** The shared subset another editor may write; image-plugin-only fields (cards, inject, formCues…) stay untouched. */
function checkedPatch(patch, traitKeys) {
  only(patch, [...TEXT, 'figureId', 'figurePackId', 'traits', 'referenceImage', 'outfits', 'comfyLoras'], 'patch')
  texts(patch, TEXT, 'patch')
  images(patch, ['referenceImage'], 'patch')
  if (Object.hasOwn(patch, 'comfyLoras') && (!Array.isArray(patch.comfyLoras) || normalizeCharacterLoras(patch.comfyLoras).length !== patch.comfyLoras.length)) throw fail('INVALID_ARGUMENT', 'comfyLoras 需要有效的工作流、文件名和强度')
  if (Object.hasOwn(patch, 'name') && !patch.name.trim()) throw fail('INVALID_ARGUMENT', 'patch.name 不能为空')
  // null for both ends a link; the record stays as an ordinary one.
  if (Object.hasOwn(patch, 'figureId') && patch.figureId !== null && (typeof patch.figureId !== 'string' || !patch.figureId || patch.figureId.length > 64)) throw fail('INVALID_ARGUMENT', 'patch.figureId 必须是素材库人物 ID，或 null 表示断开')
  if (Object.hasOwn(patch, 'figurePackId') && patch.figurePackId !== null && (typeof patch.figurePackId !== 'string' || !patch.figurePackId || patch.figurePackId.length > 128)) throw fail('INVALID_ARGUMENT', 'patch.figurePackId 必须是素材包 ID，或 null 表示断开')
  if (patch.figureId && !patch.figurePackId) throw fail('INVALID_ARGUMENT', '关联人物必须指定素材包 ID')
  if ((patch.figureId === null) !== (patch.figurePackId === null)) throw fail('INVALID_ARGUMENT', '断开关联时 figureId 与 figurePackId 都设为 null')
  if (Object.hasOwn(patch, 'traits')) { only(patch.traits, traitKeys, 'patch.traits'); texts(patch.traits, traitKeys, 'patch.traits') }
  if (Object.hasOwn(patch, 'outfits')) {
    if (!Array.isArray(patch.outfits)) throw fail('INVALID_ARGUMENT', 'patch.outfits 必须是数组（按 id 合并）')
    const ids = new Set()
    for (const [index, outfit] of patch.outfits.entries()) {
      const label = 'patch.outfits[' + index + ']'
      only(outfit, ['id', ...OUTFIT_TEXT, ...IMAGES, 'enabled', 'default'], label)
      texts(outfit, OUTFIT_TEXT, label)
      images(outfit, IMAGES, label)
      if (typeof outfit.id !== 'string' || !outfit.id || outfit.id.length > 64 || ids.has(outfit.id)) throw fail('INVALID_ARGUMENT', label + '.id 必须是唯一的服装 ID')
      ids.add(outfit.id)
      for (const key of ['enabled', 'default']) if (Object.hasOwn(outfit, key) && typeof outfit[key] !== 'boolean') throw fail('INVALID_ARGUMENT', label + '.' + key + ' 必须是布尔值')
    }
  }
  return structuredClone(patch)
}

/** traits merge by key; outfits merge by id (absent outfits are kept, new ids are appended); null removes an image. */
function merged(character, patch) {
  character = structuredClone(character)
  const next = { ...character, ...patch }
  if (patch.traits) next.traits = { ...character.traits, ...patch.traits }
  if (patch.outfits) {
    const byId = new Map(patch.outfits.map(outfit => [outfit.id, outfit]))
    next.outfits = character.outfits.map(outfit => byId.has(outfit.id) ? { ...outfit, ...byId.get(outfit.id) } : outfit)
      .concat(patch.outfits.filter(outfit => !character.outfits.some(item => item.id === outfit.id)))
  }
  for (const item of [next, ...next.outfits]) for (const key of IMAGES) if (item[key] === null) delete item[key]
  for (const key of ['figureId', 'figurePackId']) if (next[key] === null) delete next[key]
  return next
}

export function createCharacterLibrary({ getDefinitions, updateDefinitions, normalizeCharacter, traitKeys, putImage }) {
  const snapshot = character => ({ version: CHARACTER_LIBRARY_VERSION, character: structuredClone(character) })
  function find({ characterId, figureId, figurePackId } = {}, definitions = getDefinitions()) {
    if (Boolean(characterId) === Boolean(figureId) || characterId && typeof characterId !== 'string' || figureId && typeof figureId !== 'string') throw fail('INVALID_ARGUMENT', '请只给 characterId 或 figureId 其中一个')
    if (figureId && !figurePackId) throw fail('INVALID_ARGUMENT', '查询关联人物必须指定素材包 ID')
    const character = definitions.characters.find(item => characterId ? item.id === characterId : item.figureId === figureId && item.figurePackId === figurePackId)
    if (!character) throw fail('NOT_FOUND', characterId ? '人物库里没有这个人物' : '这个素材库人物还没有关联人物库记录')
    return character
  }
  function claimFigure(figureId, figurePackId, self, definitions) {
    if (figureId && definitions.characters.some(item => item !== self && item.figureId === figureId && item.figurePackId === figurePackId)) throw fail('INVALID_ARGUMENT', '这个素材库人物已关联另一条人物库记录')
  }
  return {
    schemaVersion: CHARACTER_LIBRARY_VERSION,
    getCharacter(input) { return snapshot(find(input)) },
    async patchCharacter({ characterId, expected, patch } = {}) {
      const change = checkedPatch(patch, traitKeys), seen = structuredClone(expected)
      let next
      await updateDefinitions(definitions => {
        const current = find({ characterId }, definitions)
        if (!isDeepStrictEqual(current, seen)) throw fail('REVISION_CONFLICT', '人物已在别处修改，请重新读取后再改')
        claimFigure(change.figureId, change.figurePackId, current, definitions)
        next = normalizeCharacter(merged(current, change), 0)
        return { ...definitions, characters: definitions.characters.map(item => item === current ? next : item) }
      })
      return snapshot(next)
    },
    async createCharacter({ character } = {}) {
      const change = checkedPatch(character, traitKeys)
      if (!change.name?.trim()) throw fail('INVALID_ARGUMENT', 'character.name 不能为空')
      let next
      await updateDefinitions(definitions => {
        claimFigure(change.figureId, change.figurePackId, null, definitions)
        next = normalizeCharacter(merged({ id: 'character-' + randomUUID(), traits: {}, outfits: [] }, change), 0)
        return { ...definitions, characters: [...definitions.characters, next] }
      })
      return snapshot(next)
    },
    /** Removes a record, guarded by the snapshot like a patch. */
    async deleteCharacter({ characterId, expected } = {}) {
      const seen = structuredClone(expected)
      await updateDefinitions(definitions => {
        const current = find({ characterId }, definitions)
        if (!isDeepStrictEqual(current, seen)) throw fail('REVISION_CONFLICT', '人物已在别处修改，请重新读取后再改')
        return { ...definitions, characters: definitions.characters.filter(item => item !== current) }
      })
      return { deleted: characterId }
    },
    /** bytes → the descriptor stored in referenceImage / characterOutfitImage (same store as the 人物库 upload). */
    async putReferenceImage({ data, mediaType, name } = {}) {
      if (!(data instanceof Uint8Array)) throw fail('INVALID_ARGUMENT', 'data 必须是图片字节')
      return await putImage({ data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'), mediaType, name })
    },
  }
}
