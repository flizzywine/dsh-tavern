import { assertJson, check, shape, text, integer, bool, oneOf, version, array, unique, extensions, record, relativePath, validateUuid, validateShortId, validateStateId, validateHash } from './common.js'
import { validateSpriteManifest, spriteResourcePaths } from './sprite.js'
import { validateStateImagePools } from './state-image-pools.js'
import imageContract from '../shared/sprite-images.cjs'
import { validateRecall } from './manifest.js'
import {figureNameKey} from './figure-names.js'
import {validateCopiedFrom} from './copied-from.js'
import { validateSpineOutfit } from './spine.js'

// no 优先级 — the lamp mode is the whole figure recall.
export function validateFigureRecall(value, path = '$') {
  shape(value, ['mode'], ['mode'], path)
  oneOf(value.mode, ['constant', 'keyword'], path + '.mode')
  return value
}
import { validateVoiceBinding, voiceReferences } from '../shared/voice-schema.js'
import { validateFigureEmotions, figureSingleImage, validateOutfitEmotions } from './figure-emotions.js'
import { validateIdentitySettei } from './identity-settei.js'
export { validateVoice } from './figure-voice.js'
export { validateFigureEmotions, figureSingleImage, figureEmotionRows, figureOutfitEmotionRows } from './figure-emotions.js'
function avatarCrop(value, path) {
  shape(value, ['x', 'y', 'w', 'h'], ['x', 'y', 'w', 'h'], path)
  for (const key of ['x', 'y', 'w', 'h']) check(Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1, path + '.' + key)
  check(value.w > 0 && value.h > 0 && value.x + value.w <= 1 && value.y + value.h <= 1, path, 'Crop must fit within the sprite')
}
export function validateAnatomy(value, path = '$') {
  const coordinates = ['figureTop', 'headTop', 'chin', 'feet', 'visibleBottom', 'supportX']
  shape(value, [...coordinates, 'cheeks', 'faceRect', 'visibleFraction', 'headsPerBody', 'poseHeightRatio', 'headRatio', 'assetScale', 'posture', 'crop', 'source'], [...coordinates, 'poseHeightRatio', 'headRatio', 'posture', 'crop', 'source'], path)
  for (const key of coordinates) check(Number.isFinite(value[key]), path + '.' + key)
  if (value.cheeks !== undefined) {
    const p = path + '.cheeks', cheeks = value.cheeks
    shape(cheeks, ['left', 'right', 'size'], ['left', 'right', 'size'], p)
    for (const side of ['left', 'right']) {
      array(cheeks[side], p + '.' + side, 2)
      check(cheeks[side].length === 2 && cheeks[side].every(Number.isFinite), p + '.' + side)
    }
    check(Number.isFinite(cheeks.size) && cheeks.size > 0, p + '.size')
  }
  if (value.faceRect !== undefined) { array(value.faceRect, path + '.faceRect', 4); check(value.faceRect.length === 4 && value.faceRect.every(Number.isFinite) && value.faceRect[2] > 0 && value.faceRect[3] > 0, path + '.faceRect') }
  for (const key of ['visibleFraction', 'headsPerBody', 'poseHeightRatio', 'headRatio', 'assetScale']) if (value[key] !== undefined) check(Number.isFinite(value[key]) && value[key] > 0, path + '.' + key)
  oneOf(value.posture, ['standing', 'seated'], path + '.posture')
  check(value.poseHeightRatio >= 0.01 && value.poseHeightRatio <= 4 && value.headRatio <= 4, path, 'Invalid anatomy ratio')
  if (value.assetScale !== undefined) check(value.assetScale >= 0.25 && value.assetScale <= 2, path + '.assetScale')
  oneOf(value.crop, ['full', 'thigh', 'waist', 'chest', 'custom'], path + '.crop')
  oneOf(value.source, ['calibrated', 'measured', 'estimated'], path + '.source')
  check(value.feet >= value.visibleBottom && value.visibleBottom > value.figureTop && value.chin > value.headTop, path, 'Invalid anatomy span')
  const fraction = (value.visibleBottom - value.figureTop) / (value.feet - value.figureTop)
  check(value.crop !== 'full' || Math.abs(fraction - 1) < 1e-6, path + '.crop')
  if (value.visibleFraction !== undefined) check(Math.abs(fraction - value.visibleFraction) < 1e-6, path + '.visibleFraction')
}
export function validateAvatarFaceAnchors(value, path = '$') {
  record(value, path, (rect, p, hash) => {
    validateHash(hash, p)
    array(rect, p, 4)
    check(rect.length === 4 && rect.every(n => Number.isFinite(n) && n >= 0 && n <= 1), p, 'Face anchor must be a normalized rectangle')
    check(rect[2] > 0 && rect[3] > 0 && rect[0] + rect[2] <= 1 && rect[1] + rect[3] <= 1, p, 'Face anchor must fit its exact source media')
  })
}
export function validateFigure(value, path = '$', voiceLibrary) {
  assertJson(value)
  shape(value, ['schemaVersion', 'id', 'name', 'aliases', 'description', 'remark', 'enabled', 'recall', 'appearance', 'identityAppearance', 'identitySettei', 'heightCm', 'heightBasis', 'elevationCm', 'imageColor', 'autoColor', 'emotions', 'voice', 'outfits', 'extensions'], ['schemaVersion', 'id', 'name', 'enabled', 'recall', 'appearance', 'outfits'], path)
  check([1,2].includes(value.schemaVersion), path + '.schemaVersion', 'Unsupported schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION'); validateUuid(value.id, path + '.id'); text(value.name, path + '.name'); bool(value.enabled, path + '.enabled')
  if (value.remark !== undefined) check(typeof value.remark === 'string', path + '.remark')
  if (value.description !== undefined) check(typeof value.description === 'string' && value.description.length <= 1000, path + '.description')
  // Figure names are identity and recall evidence; outfits retain their own trigger words.
  validateFigureRecall(value.recall, path + '.recall')
  oneOf(value.appearance, ['live2d', 'spine', 'sprite', 'avatar'], path + '.appearance')
  if (value.identityAppearance !== undefined) check(typeof value.identityAppearance === 'string' && value.identityAppearance.length <= 4000, path + '.identityAppearance')
  if (value.identitySettei !== undefined) validateIdentitySettei(value.identitySettei, path + '.identitySettei')
  if (value.aliases !== undefined) {
    array(value.aliases, path + '.aliases', 128)
    value.aliases.forEach(v => { text(v, path + '.aliases', 160); check(v === v.trim() && figureNameKey(v).length > 0, path + '.aliases') })
    unique([figureNameKey(value.name), ...value.aliases.map(figureNameKey)], path + '.aliases')
  }
  if (value.heightCm !== undefined) check(Number.isFinite(value.heightCm) && value.heightCm > 0, path + '.heightCm')
  if (value.heightBasis !== undefined) oneOf(value.heightBasis, ['standing', 'seated'], path + '.heightBasis')
  if (value.elevationCm !== undefined) check(Number.isFinite(value.elevationCm) && value.elevationCm >= 0 && value.elevationCm <= 500, path + '.elevationCm')
  // absence means not yet initialized; imports set color only once.
  // manual and derived colours are portable metadata, not media authority.
  for (const field of ['imageColor', 'autoColor']) if (value[field] !== undefined) check(typeof value[field] === 'string' && /^#[0-9a-fA-F]{6}$/.test(value[field]), path + '.' + field)
  if (value.emotions !== undefined) validateFigureEmotions(value.emotions, path + '.emotions')
  if (value.voice !== undefined) validateVoiceBinding(value.voice, voiceLibrary, path + '.voice')
  if(voiceLibrary)for(const row of value.emotions||[])if(row.voiceEmotion!==undefined)check(voiceLibrary.voices[value.voice?.voice]?.emotions?.[row.voiceEmotion],path+'.emotions','Unknown voice emotion','MISSING_DEPENDENCY')
  if (value.extensions !== undefined) extensions(value.extensions, path + '.extensions')
  validateCopiedFrom(value.extensions,'figures',path + '.extensions')
  if (value.extensions?.['dsh.avatar-face-anchors'] !== undefined) {
    const anchors = value.extensions['dsh.avatar-face-anchors'], p = path + '.extensions.dsh.avatar-face-anchors'
    validateAvatarFaceAnchors(anchors, p)
    const sources = new Set(value.outfits.flatMap(o => [...Object.values(o.avatars || {}), ...Object.values(o.sprite?.assets || {})]))
    for (const hash of Object.keys(anchors)) check(sources.has(hash), p + '.' + hash, 'Face anchor must reference this figure media')
  }
  array(value.outfits, path + '.outfits', 128)
  unique(value.outfits.map(outfit => outfit.key), path + '.outfits')
  value.outfits.forEach((outfit, index) => {
    const p = path + '.outfits[' + index + ']'
    validateShortId(outfit.key, p + '.key'); shape(outfit, ['key', 'label', 'enabled', 'defaultEmotion', 'fallbackEmotions', 'fallbackTo', 'genPrompts', 'genRecords', 'recall', 'guidance', 'remark', 'outfitAppearance', 'settei', 'setteiParentVersion', 'live2d', 'spine', 'sprite', 'avatars', 'avatarCrop', 'extensions'], ['key', 'label', 'enabled'], p)
    text(outfit.label, p + '.label'); bool(outfit.enabled, p + '.enabled')
    validateOutfitEmotions(value,outfit,p)
    // optional 使用情景 — when the director should switch to this outfit.
    if (outfit.remark !== undefined) check(typeof outfit.remark === 'string', p + '.remark')
    if (outfit.guidance !== undefined) text(outfit.guidance, p + '.guidance', 80, 0)
    if (outfit.outfitAppearance !== undefined) check(typeof outfit.outfitAppearance === 'string' && outfit.outfitAppearance.length <= 4000, p + '.outfitAppearance')
    if (outfit.settei !== undefined) validateHash(outfit.settei, p + '.settei')
    if (outfit.setteiParentVersion !== undefined) {
      text(outfit.setteiParentVersion, p + '.setteiParentVersion', 160)
      check(Boolean(outfit.settei), p + '.setteiParentVersion', 'Parent version requires an outfit board')
    }
    if (outfit.recall !== undefined) validateRecall(outfit.recall, p + '.recall', 1)
    if (outfit.extensions !== undefined) extensions(outfit.extensions, p + '.extensions')
    if (outfit.avatarCrop !== undefined) avatarCrop(outfit.avatarCrop, p + '.avatarCrop')
    if (outfit.live2d !== undefined) {
      shape(outfit.live2d, ['bundleKey', 'emotionMap', 'anatomy'], ['bundleKey'], p + '.live2d'); validateShortId(outfit.live2d.bundleKey)
      if (outfit.live2d.anatomy !== undefined) validateAnatomy(outfit.live2d.anatomy, p + '.live2d.anatomy')
      if (outfit.live2d.emotionMap !== undefined) record(outfit.live2d.emotionMap, p + '.live2d.emotionMap', (mapping, q, emotion) => {
        validateStateId(emotion, q); shape(mapping, ['expression', 'motion'], [], q); check(Object.keys(mapping).length > 0, q)
        for (const v of Object.values(mapping)) text(v, q, 160)
      })
    }
    // animation names are runtime data, checked when the skeleton loads.
    if (outfit.spine !== undefined) {
      validateSpineOutfit(outfit.spine, p + '.spine')
      if (outfit.spine.anatomy !== undefined) validateAnatomy(outfit.spine.anatomy, p + '.spine.anatomy')
    }
    if (outfit.sprite !== undefined) {
      const imageFields = value.schemaVersion === 2 ? ['imagePools'] : []
      shape(outfit.sprite, ['manifestKey', 'assets', 'avatarCrop', 'avatarCropAuto', 'anatomy', ...imageFields], ['manifestKey', 'assets', ...imageFields], p + '.sprite'); validateShortId(outfit.sprite.manifestKey)
      if (value.schemaVersion === 2) {
        validateStateImagePools(outfit.sprite.imagePools,{states:value.emotions || [],fallbackTo:outfit.fallbackTo},p + '.sprite.imagePools')
        check(imageContract.stateImagePool(outfit,outfit.defaultEmotion),p + '.defaultEmotion','Default must have an image pool','MISSING_DEPENDENCY')
      }
      if (outfit.sprite.anatomy !== undefined) record(outfit.sprite.anatomy, p + '.sprite.anatomy', (v, q, state) => { validateStateId(state, q); validateAnatomy(v, q) })
      record(outfit.sprite.assets, p + '.sprite.assets', (hash, q, resource) => { relativePath(resource, q); validateHash(hash, q) })
      for (const key of ['avatarCrop', 'avatarCropAuto']) if (outfit.sprite[key] !== undefined) record(outfit.sprite[key], p + '.sprite.' + key, (crop, q, state) => { validateStateId(state, q); avatarCrop(crop, q) })
    }
    // calm is the only resting avatar slot; old default rows require explicit migration.
    if (outfit.avatars !== undefined) record(outfit.avatars, p + '.avatars', (hash, q, state) => {
      validateStateId(state, q); validateHash(hash, q)
      if (figureSingleImage(value) && !(value.schemaVersion === 2 && outfit.sprite)) check(state === figureSingleImage(value), q, 'A single image has one avatar', 'MISSING_DEPENDENCY')
    })
  })
  if (!value.outfits.length) check(value.heightCm === undefined, path + '.heightCm', 'Voice-only figure has no height')
  return value
}
// Whole-pack structural closure. P1 additionally verifies actual bytes/decoded sizes/model3 paths.
export function validateFigureClosure(manifest, figures, sprites) {
  record(figures, '$.figures', (figure, p, id) => { validateFigure(figure, p, manifest.voiceLibrary || {voices:{}}); check(figure.schemaVersion === (manifest.schemaVersion ?? 1) && figure.id === id && manifest.figures.includes(id), p) })
  check(Object.keys(figures).length === manifest.figures.length, '$.figures', 'Figure closure mismatch', 'FILE_CLOSURE_MISMATCH')
  record(sprites, '$.sprites', (sprite, p, key) => { check(Object.hasOwn(manifest.sprites, key), p); validateSpriteManifest(sprite, p) })
  check(Object.keys(sprites).length === Object.keys(manifest.sprites).length, '$.sprites', 'Sprite closure mismatch', 'FILE_CLOSURE_MISMATCH')
  const usedBlobs = new Set(), usedSprites = new Set()
  const blob = (hash, type) => { check(manifest.blobs[hash]?.mime.startsWith(type), '$.figures', 'Missing or wrong-kind blob: ' + hash, 'MISSING_DEPENDENCY'); usedBlobs.add(hash) }
  const assetReferences = value => {
    if (typeof value === 'string' && Object.hasOwn(manifest.blobs, value)) usedBlobs.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(assetReferences)
  }
  assetReferences(manifest.assets)
  assetReferences(manifest.tagIcons)
  assetReferences(manifest.backgroundStyle)
  for (const voice of Object.values(manifest.voiceLibrary?.voices || {})) for (const ref of voiceReferences(voice)) {
    blob(ref.media, 'audio/')
    check(['audio/wav','audio/mpeg'].includes(manifest.blobs[ref.media]?.mime), '$.voiceLibrary', 'References require WAV or MP3 media', 'MISSING_DEPENDENCY')
  }
  for (const figure of Object.values(figures)) {
    if (figure.identitySettei) blob(figure.identitySettei.board, 'image/')
    for (const outfit of figure.outfits) {
      if (outfit.live2d) check(manifest.bundles[outfit.live2d.bundleKey]?.kind === 'live2d', '$.outfits.live2d', 'Missing Live2D bundle', 'MISSING_DEPENDENCY')
      if (outfit.spine) check(manifest.bundles[outfit.spine.bundleKey]?.kind === 'spine', '$.outfits.spine', 'Missing Spine bundle', 'MISSING_DEPENDENCY')
      if (outfit.settei) blob(outfit.settei, 'image/')
      for (const hash of Object.values(outfit.avatars || {})) blob(hash, 'image/')
      if (!outfit.sprite) continue
      const sprite = sprites[outfit.sprite.manifestKey]
      usedSprites.add(outfit.sprite.manifestKey)
      check(sprite, '$.outfits.sprite', 'Missing sprite manifest', 'MISSING_DEPENDENCY')
      const paths = spriteResourcePaths(sprite), mappings = outfit.sprite.assets
      check(paths.length === Object.keys(mappings).length && paths.every(path => Object.hasOwn(mappings, path)), '$.outfits.sprite.assets', 'Sprite path closure mismatch', 'FILE_CLOSURE_MISMATCH')
      Object.values(mappings).forEach(hash => blob(hash, 'image/'))
      const images = imageContract.spriteImageTable(sprite)
      check(imageContract.spriteUsesImages(sprite) === (figure.schemaVersion === 2),'$.outfits.sprite','Figure and sprite image schemas must agree')
      if (figure.schemaVersion === 2) {
        for (const pool of Object.values(outfit.sprite.imagePools)) for (const id of pool.imageIds) check(Object.hasOwn(images,id),'$.outfits.sprite.imagePools','Pool member must name an image','MISSING_DEPENDENCY')
        for (const id of Object.keys(outfit.avatars || {})) check(Object.hasOwn(images,id),'$.outfits.avatars.'+id,'Avatar must name an image','MISSING_DEPENDENCY')
      } else {
        const emotionIds = new Set((figure.emotions || []).map(row => row.id))
        for (const emotion of Object.keys(images)) check(emotionIds.has(emotion), '$.outfits.sprite.emotions.' + emotion, 'Sprite emotion is not registered on its figure', 'MISSING_DEPENDENCY')
      }
      for (const key of ['avatarCrop', 'avatarCropAuto', 'anatomy']) for (const image of Object.keys(outfit.sprite[key] || {})) check(Object.hasOwn(images, image), '$.outfits.sprite.' + key, 'Measurements belong to a direct image', 'MISSING_DEPENDENCY')
    }
  }
  for (const key of Object.keys(sprites)) check(usedSprites.has(key), '$.sprites.' + key, 'Unbound sprite cannot be installed')
  for (const [hash, descriptor] of Object.entries(manifest.blobs)) if (descriptor.mime.startsWith('image/')) check(usedBlobs.has(hash), '$.blobs.' + hash, 'Unused image cannot be installed')
  return { manifest, figures, sprites }
}
