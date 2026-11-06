import { assertJson, check, fail, integer, object, oneOf, text } from './json.js'
import { figureCharacter } from './figure-scale.cjs'
// stage.theme is one of the built-in skin registry's ids.
import skinContract from './stage-skin.cjs'
export { normalizeStageBudget } from './config-budget.js'

const characterDialogue = ['alias', 'name', 'note', 'color', 'voice', 'voiceLang', 'avatar', 'moods', 'full']
const characterGal = ['offstage', 'portrait', 'outfitLabel', 'outfits', 'heightCm', 'heightBasis', 'heightNote', 'placement.elevationCm']
const kinds = ['backgrounds', 'music', 'sfx', 'ambience', 'looks', 'widgets']
export const CONFIG_OWNER_PATHS = Object.freeze(Object.fromEntries(Object.entries({
  dialogue: ['enabled', 'emotions', 'injection', 'voice.enabled', ...characterDialogue.map(key => `characters[].${key}`)],
  gal: ['stage.theme', 'stage.face', 'stage.background', 'stage.music', ...characterGal.map(key => `characters[].${key}`)],
  director: ['stage.director', 'stage.directorModel', 'stage.directorBudget', 'stage.directorPrompt', 'stage.catalogue'],
  widgets: ['stage.widgets', 'stage.widgetTuning'],
  assets: kinds.flatMap(kind => [`stage.sources.${kind}.card`, `stage.sources.${kind}.libraries`])
}).map(([owner, paths]) => [owner, Object.freeze(paths)])))
export function configFieldOwner(path) {
  return Object.keys(CONFIG_OWNER_PATHS).find(owner => CONFIG_OWNER_PATHS[owner].includes(path)) || null
}
const bool = (value, path) => check(typeof value === 'boolean', path)
const id = (value, path, empty = false) => check(typeof value === 'string' && (empty && value === '' || /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)), path)
const record = (value, path) => check(object(value), path)
const image = (value, path, empty = false) => check(typeof value === 'string' && (empty && value === '' || /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) || /^(?:avatars\/[A-Za-z0-9_@.-]+\.(?:webp|png|jpeg)|\/api\/dsh-tavern\/card-assets\/[a-z0-9][a-z0-9_-]{0,63}\/avatars\/[A-Za-z0-9_@.%~-]+\.(?:webp|png|jpeg)\?v=[A-Za-z0-9-]+)$/.test(value)), path)

// Current documents only: no defaulting, trimming, alias inference or migration.
// Unknown inert fields survive; ownership never grants them to a patch caller.
export function validateCurrentStageConfig(value) {
  assertJson(value, { maxBytes: 12 * 1024 * 1024 })
  if (value?.version !== 1) fail('version', 'Current stage config required', 'MIGRATION_REQUIRED')
  record(value, '$'); bool(value.enabled, 'enabled')
  check(Array.isArray(value.characters) && value.characters.length <= 60, 'characters')
  const aliases = new Set()
  for (const [index, character] of value.characters.entries()) {
    const p = `characters[${index}]`; record(character, p)
    check(typeof character.alias === 'string' && /^[a-z0-9_]{1,32}$/.test(character.alias) && !aliases.has(character.alias), `${p}.alias`)
    aliases.add(character.alias)
    for (const [key, max] of [['name', 40], ['note', 1000], ['outfitLabel', 12], ['avatar', 409600]]) text(character[key], `${p}.${key}`, max, true)
    check(typeof character.color === 'string' && (character.color === '' || /^#[0-9a-f]{6}$/i.test(character.color)), `${p}.color`)
    id(character.voice, `${p}.voice`, true); id(character.portrait, `${p}.portrait`, true)
    oneOf(character.voiceLang, ['ja', 'zh', 'en'], `${p}.voiceLang`); bool(character.offstage, `${p}.offstage`)
    image(character.avatar, `${p}.avatar`, true)
    for (const key of ['moods', 'full']) { record(character[key], `${p}.${key}`); for (const ref of Object.values(character[key])) { text(ref, `${p}.${key}`, 409600); image(ref, `${p}.${key}`) } }
    check(Array.isArray(character.outfits) && character.outfits.length <= 12, `${p}.outfits`)
    const labels = new Set()
    for (const outfit of character.outfits) {
      record(outfit, `${p}.outfits`); text(outfit.label, `${p}.outfits.label`, 12); id(outfit.model, `${p}.outfits.model`)
      check(!labels.has(outfit.label), `${p}.outfits.label`); labels.add(outfit.label)
    }
    const physical = figureCharacter(character)
    for (const key of ['heightCm', 'heightBasis', 'heightNote', 'placement']) if (Object.hasOwn(character, key)) {
      check(JSON.stringify(character[key]) === JSON.stringify(physical[key]), `${p}.${key}`)
    }
  }
  check(Array.isArray(value.emotions) && value.emotions.length <= 8, 'emotions')
  const emotions = new Set()
  for (const emotion of value.emotions) {
    record(emotion, 'emotions'); check(/^[a-z][a-z0-9_-]{0,23}$/.test(emotion.id) && !emotions.has(emotion.id), 'emotions.id')
    emotions.add(emotion.id); text(emotion.label, 'emotions.label', 12)
    check([...emotion.label].length <= 6 && !/[|\[\]\r\n]/.test(emotion.label), 'emotions.label')
    if (emotion.note !== undefined) { text(emotion.note, 'emotions.note', 120, true); check([...emotion.note].length <= 60, 'emotions.note') }
  }
  check(Array.isArray(value.moods), 'moods')
  record(value.injection, 'injection'); text(value.injection.template, 'injection.template', 12000, true); text(value.injection.extra, 'injection.extra', 2000, true)
  if (value.injection.template) for (const token of ['bubble_format', 'bubble_emotions', 'bubble_characters']) check(value.injection.template.includes('{{' + token + '}}'), 'injection.template')
  if (value.injection.placement !== undefined) {
    const placement = value.injection.placement; record(placement, 'injection.placement')
    if (placement.book !== undefined) text(placement.book, 'injection.placement.book', 1000)
    for (const [key, min, max] of [['position', 0, 1], ['depth', 0, 1000], ['role', 0, 2], ['order', -1000000, 1000000]]) if (placement[key] !== undefined) integer(placement[key], `injection.placement.${key}`, min, max)
  }
  if (value.voice !== null) { record(value.voice, 'voice'); bool(value.voice.enabled, 'voice.enabled') }
  const stage = value.stage; record(stage, 'stage')
  for (const field of ['protagonist', 'worldview']) if (Object.hasOwn(stage, field)) fail(`stage.${field}`, 'Offline conversion required', 'MIGRATION_REQUIRED')
  oneOf(stage.theme, Object.keys(skinContract.BUILTIN_STAGE_SKINS), 'stage.theme'); oneOf(stage.face, ['always', 'offstage', 'off'], 'stage.face')
  id(stage.background, 'stage.background', true)
  for (const field of ['music', 'director', 'widgets']) bool(stage[field], `stage.${field}`)
  text(stage.directorPrompt, 'stage.directorPrompt', 4000, true)
  if (stage.directorModel !== null) { record(stage.directorModel, 'stage.directorModel'); text(stage.directorModel.provider, 'stage.directorModel.provider', 200); text(stage.directorModel.model, 'stage.directorModel.model', 200) }
  record(stage.directorBudget, 'stage.directorBudget')
  for (const [field, max] of [['maxToolCalls', 64], ['maxBeatsPerCall', 64], ['maxOpsPerCall', 256]]) integer(stage.directorBudget[field], `stage.directorBudget.${field}`, 1, max)
  record(stage.widgetTuning, 'stage.widgetTuning')
  check(Object.keys(stage.widgetTuning).length <= 64, 'stage.widgetTuning')
  for (const [key, tuning] of Object.entries(stage.widgetTuning)) {
    check(/^[a-z][a-z0-9-]{0,31}$/.test(key), 'stage.widgetTuning'); record(tuning, 'stage.widgetTuning')
    text(tuning.note, 'stage.widgetTuning.note', 1200, true); check([...tuning.note].length <= 600, 'stage.widgetTuning.note')
    if (tuning.options !== undefined) { record(tuning.options, 'stage.widgetTuning.options'); assertJson(tuning.options, { maxBytes: 4096 }) }
    if (tuning.slot !== undefined) oneOf(tuning.slot, ['top-center', 'corner-left', 'corner-right', 'center-card'], 'stage.widgetTuning.slot')
    if (tuning.scale !== undefined) check(Number.isFinite(tuning.scale) && tuning.scale >= .75 && tuning.scale <= 1.5, 'stage.widgetTuning.scale')
    if (tuning.frame !== undefined) bool(tuning.frame, 'stage.widgetTuning.frame')
    if (tuning.tone !== undefined) oneOf(tuning.tone, ['theme', 'pink', 'info', 'warning'], 'stage.widgetTuning.tone')
  }
  record(stage.catalogue, 'stage.catalogue'); record(stage.catalogue.caps, 'stage.catalogue.caps')
  for (const [field, min, max] of [['backgrounds', 8, 64], ['sfx', 8, 48], ['ambience', 4, 24]]) integer(stage.catalogue.caps[field], `stage.catalogue.caps.${field}`, min, max)
  integer(stage.catalogue.musicLibraryThreshold, 'stage.catalogue.musicLibraryThreshold')
  record(stage.sources, 'stage.sources')
  for (const kind of kinds) {
    const source = stage.sources[kind]; record(source, `stage.sources.${kind}`)
    for (const field of ['mode', 'library', 'libraryId']) if (Object.hasOwn(source, field)) fail(`stage.sources.${kind}.${field}`, 'Offline conversion required', 'MIGRATION_REQUIRED')
    bool(source.card, `stage.sources.${kind}.card`)
    check(Array.isArray(source.libraries) && source.libraries.every(item => typeof item === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(item)) && new Set(source.libraries).size === source.libraries.length, `stage.sources.${kind}.libraries`)
  }
  return structuredClone(value)
}
