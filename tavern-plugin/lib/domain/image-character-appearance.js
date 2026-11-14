// A figure's 外貌 lives in the 配图 人物库 record (schema 4, per view). Asset generation draws standing, clothed,
// front-facing pictures, so it reads the front SFW views and the outfit's front parts.
import { IMAGE_CHARACTER_TRAITS } from './plugin-image-catalog.js'

// A pack that leaves this library (export, copy) carries each figure's record 外貌 as this figure extension; the host moves
// it back into a record when the pack is written here (appearanceMove), so an installed pack never keeps a second copy.
export const IMAGE_CHARACTER_EXTENSION = 'dsh.image-character'
const OUTFIT_TEXT = ['upper', 'lower', 'shoes', 'accessory', 'full', 'back', 'negative']
const said = value => typeof value === 'string' && value.trim() ? value.trim() : ''

// A 参考图 in the extension: the pack media holding its bytes (the 人物库 and a pack both name a picture by its sha256).
const carriedImage = image => image?.id ? { media: image.id, ...(image.name ? { name: image.name } : {}) } : null

/** The figure extension of a record's 外貌: its non-empty views and outfit texts, and its 参考图 ({media, name}: the pack
 *  carries the picture as media, figure-image-extras.js). null when the record has none of them. */
export function imageCharacterExtension(character) {
  const traits = Object.fromEntries(IMAGE_CHARACTER_TRAITS.filter(key => said(character.traits?.[key])).map(key => [key, said(character.traits[key])]))
  const outfits = (character.outfits || []).map(outfit => ({ id: outfit.id, ...(outfit.name ? { name: outfit.name } : {}),
    ...Object.fromEntries(OUTFIT_TEXT.filter(key => said(outfit[key])).map(key => [key, said(outfit[key])])),
    ...(carriedImage(outfit.characterOutfitImage) ? { characterOutfitImage: carriedImage(outfit.characterOutfitImage) } : {}) }))
    .filter(outfit => outfit.characterOutfitImage || OUTFIT_TEXT.some(key => outfit[key]))
  const reference = carriedImage(character.referenceImage)
  return Object.keys(traits).length || outfits.length || reference
    ? { ...(Object.keys(traits).length ? { traits } : {}), ...(reference ? { referenceImage: reference } : {}), ...(outfits.length ? { outfits } : {}) } : null
}

// An actor key a migration kept among a figure's 触发词 (lowercase slug such as homura_megane): an identity for old
// chats, not a name anybody writes (the figure page hides the same words).
export const internalAliasCode = word => /^[a-z][a-z0-9_]*$/.test(String(word))
const readableLatin = word => /^[a-z][a-z0-9 .'-]*$/i.test(word) && !internalAliasCode(word)

/** The 配图 人物库 aliases of a figure: its 触发词 except actor keys, with the first readable Latin name first, which the
 *  人物库 writes as the person's name in English prompts. One 触发词 list; this is its 生图 view. A word several people
 *  answer to stays (owner 11-12): the 配图 plugin, within the people a card can use, does not resolve a word that names
 *  more than one of them, as the stage does not. */
export function imageAliasesFromFigure(figure) {
  const own = (figure.aliases || []).filter(word => !internalAliasCode(word))
  const latin = own.find(readableLatin)
  return latin ? [latin, ...own.filter(word => word !== latin)] : own
}

/** What a linked record's name and aliases must become (方案甲: the figure is their one home, the record shows them);
 *  null when they already match. */
export function identityPatchFromFigure(character, figure) {
  const match = imageAliasesFromFigure(figure).join(', ')
  const patch = { ...(character.name !== figure.name ? { name: figure.name } : {}), ...(character.match !== match ? { match } : {}) }
  return Object.keys(patch).length ? patch : null
}

const joined = values => values.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean).join('；')

export function appearanceFromImageCharacter(character, outfitKey) {
  const traits = character?.traits || {}, outfit = character?.outfits?.find(item => item.id === outfitKey)
  return {
    identityAppearance: joined([traits.face, traits.bodySFW, traits.lowerSFW]),
    outfitAppearance: outfit ? joined([outfit.upper, outfit.lower, outfit.shoes, outfit.accessory, outfit.full]) : '',
  }
}

/** The first 人物库 record of a figure: its names, its 外貌 text and its outfits' text (identityAppearance → face,
 *  outfitAppearance → upper, as the 人物库 reads its own single-text legacy fields). */
export function imageCharacterFromFigure(figure, packId) {
  return {
    name: figure.name, match: imageAliasesFromFigure(figure).join(', '), figureId: figure.id, ...(packId ? { figurePackId: packId } : {}),
    ...(figure.identityAppearance ? { traits: { face: figure.identityAppearance } } : {}),
    outfits: figure.outfits.map(outfit => ({ id: outfit.key, name: outfit.label, ...(outfit.outfitAppearance ? { upper: outfit.outfitAppearance } : {}) })),
  }
}

/** 方案甲: 外貌 a written pack carries moves into the figure's record — the export extension (another library's record:
 *  imports, copies) and older single texts (identityAppearance → face, outfitAppearance → upper; older packs, dsh-assets
 *  installs). It fills what the record lacks — the record's own text always wins; carried text that differs is listed
 *  under `dropped` — and leaves the pack (`figure`: the patch that clears it). null when the pack carries none.
 *  `references`: the carried 参考图 the record should take ({outfit: outfit id or null for the person, media, name}), in
 *  the slots it has none (`replace`: every slot whose picture differs).
 *  `replace` (an update whose preview chose 「用导入的外貌」): the carried 外貌 becomes the record's — text it lacks is
 *  cleared — instead of filling gaps. */
export function appearanceMove(character, figure, { replace = false } = {}) {
  const carried = figure.extensions?.[IMAGE_CHARACTER_EXTENSION]
  const traits = { ...(said(figure.identityAppearance) ? { face: said(figure.identityAppearance) } : {}), ...carried?.traits }
  const wears = new Map(figure.outfits.filter(outfit => said(outfit.outfitAppearance)).map(outfit => [outfit.key, { upper: said(outfit.outfitAppearance) }]))
  for (const { id, name: _, characterOutfitImage: __, ...text } of carried?.outfits || []) wears.set(id, { ...wears.get(id), ...text })
  if (!carried && !Object.keys(traits).length && !wears.size) return null
  const dropped = [], fill = {}, outfits = [], references = []
  const place = (outfit, image, own) => { if (image && (replace ? own?.id !== image.media : !own)) references.push({ outfit, media: image.media, ...(image.name ? { name: image.name } : {}) }) }
  place(null, carried?.referenceImage, character.referenceImage)
  for (const row of carried?.outfits || []) place(row.id, row.characterOutfitImage, character.outfits.find(item => item.id === row.id)?.characterOutfitImage)
  if (replace) {
    for (const key of IMAGE_CHARACTER_TRAITS) if (said(character.traits?.[key]) !== said(traits[key])) fill[key] = said(traits[key])
    for (const id of new Set([...character.outfits.map(item => item.id), ...wears.keys()])) {
      const own = character.outfits.find(item => item.id === id), text = wears.get(id) || {}
      const label = figure.outfits.find(outfit => outfit.key === id)?.label || carried?.outfits?.find(outfit => outfit.id === id)?.name
      const set = Object.fromEntries(OUTFIT_TEXT.filter(key => said(own?.[key]) !== said(text[key])).map(key => [key, said(text[key])]))
      if (Object.keys(set).length) outfits.push({ id, ...(own || !label ? {} : { name: label }), ...set })
    }
  } else for (const [key, text] of Object.entries(traits)) {
    const own = said(character.traits?.[key])
    if (!own) fill[key] = text
    else if (own !== text) dropped.push({ field: key, text })
  }
  if (!replace) for (const [id, text] of wears) {
    const own = character.outfits.find(item => item.id === id), add = {}
    for (const [key, value] of Object.entries(text)) {
      if (!said(own?.[key])) add[key] = value
      else if (said(own[key]) !== value) dropped.push({ field: key, outfit: id, text: value })
    }
    const label = figure.outfits.find(outfit => outfit.key === id)?.label || carried?.outfits?.find(outfit => outfit.id === id)?.name
    if (Object.keys(add).length) outfits.push({ id, ...(own || !label ? {} : { name: label }), ...add })
  }
  const record = { ...(Object.keys(fill).length ? { traits: fill } : {}), ...(outfits.length ? { outfits } : {}) }
  const { [IMAGE_CHARACTER_EXTENSION]: _, ...extensions } = figure.extensions || {}
  return { record: Object.keys(record).length ? record : null, dropped, references,
    figure: { identityAppearance: null, outfits: figure.outfits.map(({ outfitAppearance, ...outfit }) => outfit),
      ...(carried ? { extensions: Object.keys(extensions).length ? extensions : null } : {}) } }
}

/** Linking an existing record fills only what it lacks; the record's own text always wins. */
export function linkPatchFromFigure(character, figure, packId) {
  const seed = imageCharacterFromFigure(figure, packId)
  const outfits = seed.outfits.filter(outfit => !character.outfits.some(item => item.id === outfit.id))
  return { figureId: figure.id, figurePackId: packId,
    ...(seed.traits && !character.traits?.face?.trim() ? { traits: seed.traits } : {}),
    ...(outfits.length ? { outfits } : {}) }
}

/** 设定图→参考图: the one way a pack picture becomes a 人物库 参考图 (the 人物 page's button and the follow). The 配图 plugin stores it
 * (`putReferenceImage`); the caller patches it onto the record or outfit. */
/** The 参考图 name a pack picture gets in the 人物库 (`suffix` names its kind: 设定图, or a sprite fallback's). */
export const packReferenceName = (figure, outfit, suffix = ' 设定图') => figure.name + (outfit ? '／' + outfit.label : '') + suffix

/** The record patch that makes a 参考图 the person's (no outfit) or one outfit's; a new outfit takes the outfit's label. */
export function referencePatch(character, outfit, referenceImage) {
  return !outfit ? { referenceImage } : { outfits: [{ id: outfit.key, characterOutfitImage: referenceImage,
    ...((character.outfits || []).some(item => item.id === outfit.key) ? {} : { name: outfit.label }) }] }
}

export async function putPackReference(api, library, { providerId, packId, revision, hash, name }) {
  const { bytes, descriptor } = await library.readMedia({ packId, expectedRevision: revision, hash })
  return (await api.imageCharacters('putReferenceImage', { providerId, data: new Uint8Array(bytes), mediaType: descriptor.mime, name })).referenceImage
}

/** A figure UUID can appear in copied packs. Look up the pair, across explicit writable sources. */
export async function findFigureImageCharacter(api, { packId, figureId }) {
  const libraries = await api.imageCharacterLibraries()
  if (!libraries.length) return { status: 'unavailable' }
  const reads = await Promise.all(libraries.map(async ({ providerId }) => {
    try { return await api.imageCharacters('getCharacter', { providerId, figureId, figurePackId: packId }) }
    catch (error) { if (error.code === 'NOT_FOUND') return null; throw error }
  }))
  const linked = reads.filter(Boolean)
  if (linked.length > 1) throw Object.assign(new Error('这个人物关联了多个人物库记录，请先在配图人物库中检查关联'), { code: 'INVALID_ARGUMENT' })
  // deletes: the library can delete a record (deleteCharacter), so removing the figure may take its 外貌 along
  return linked.length ? { ...linked[0], status: 'linked', deletes: libraries.find(item => item.providerId === linked[0].providerId)?.deletes === true } : { status: 'unlinked', libraries }
}
