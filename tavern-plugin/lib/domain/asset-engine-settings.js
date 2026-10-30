import {defaultJudgeConfig,validateJudgeConfig} from './engine-judge.js'
import directorCommands from '../../packages/dsh-presentation-protocol/src/director-commands.cjs'
import skinContract from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { validateAssetRef } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import { normalizeBubbleEmotions } from './dialogue-bubbles.js'
import { normalizeBubbleInjection } from './dialogue-bubble-presets.js'
import { createHash } from 'node:crypto'
import { assertJson, check, shape, text, bool, array, unique, cloneJson, canonicalJson, parseJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

export const STAGE_TOGGLES = Object.freeze(['dialogue','voice','stage','music','sfx','ambience','items','performance','entrance'])
export const ENGINE_SECTION = 'tavern-asset-engine'
// camera.close is the sole close-up dimension.
export const DIRECTOR_DIMENSIONS = Object.freeze(Object.keys(directorCommands.dimensions))
// widgets are a card preference; the director dimension is derived, never an engine setting.
const ENGINE_DIMENSIONS = DIRECTOR_DIMENSIONS.filter(key => !['widgets','music','sfx','soundscape','items'].includes(key))
export const ACTION_CAPS = Object.freeze({ beat:6, act:4 })
// built-in theme ids come from the one registry (classic, gothic, magical, crt 显像管, aero 千禧晴空).
const builtinThemes = Object.keys(skinContract.BUILTIN_STAGE_SKINS)
export const DIALOGUE_COLOR_TOKENS = Object.freeze(['--gal-ui-ink', '--gal-ui-ink-2', '--gal-ui-muted', '--gal-ui-accent', '--gal-ui-accent-ink', '--gal-ui-line', '--gal-ui-surface', '--gal-ui-surface-2', '--gal-ui-veil', '--gal-ui-hover'])
const id = (value, path) => check(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), path)
const integer = (value, min, max, path) => check(Number.isSafeInteger(value) && value >= min && value <= max, path)
export function defaultAssetEngineSettings() {
  return { schemaVersion:1, stageToggles:Object.fromEntries(STAGE_TOGGLES.map(key => [key,!['dialogue','stage'].includes(key)])), dialogue:{emotions:[],injection:normalizeBubbleInjection(null)}, dialogueTheme:'classic', dialogueThemes:[], directorModel:null,
    dimensions:Object.fromEntries(ENGINE_DIMENSIONS.map(key => [key, true])), actionCaps:{...ACTION_CAPS},
    voiceServices:{}, judge:defaultJudgeConfig(), narrator:{enabled:false, voice:null} }
}
// 旁白配音: the global layer is complete, a card layer (stage.narrator) sets only what it overrides.
// voice = a figure whose voice speaks the narration ({packId, figureId}) or a browser system voice ({browser}); null = none.
export function validateNarratorSettings(value, path, complete = false) {
  shape(value, ['enabled', 'voice'], complete ? ['enabled', 'voice'] : [], path)
  if (value.enabled !== undefined) bool(value.enabled, path + '.enabled')
  const voice = value.voice
  if (voice === undefined || voice === null) return value
  if (Object.hasOwn(voice, 'browser')) { shape(voice, ['browser'], ['browser'], path + '.voice'); text(voice.browser, path + '.voice.browser', 256) }
  else { shape(voice, ['packId', 'figureId'], ['packId', 'figureId'], path + '.voice'); text(voice.packId, path + '.voice.packId', 160); text(voice.figureId, path + '.voice.figureId', 160) }
  return value
}
export function validateEnginePreset(value) {
  assertJson(value)
  check(value?.format === 'dsh-dialogue-theme', '$.format', 'Only dialogue theme presets are supported', 'UNKNOWN_FIELD')
  shape(value, ['format', 'schemaVersion', 'id', 'name', 'style'], ['format', 'schemaVersion', 'id', 'name', 'style'], '$')
  check(value.schemaVersion === 1, '$.schemaVersion'); id(value.id, '$.id'); text(value.name, '$.name', 160)
  check(!builtinThemes.includes(value.id), '$.id', 'Built-in themes cannot be replaced')
  // Existing skin/tokens only, not arbitrary CSS, URLs, fonts or executable themes.
  shape(value.style, ['theme', 'tokens'], ['theme'], '$.style')
  check(builtinThemes.includes(value.style.theme), '$.style.theme')
  if (value.style.tokens !== undefined) {
    shape(value.style.tokens, [...DIALOGUE_COLOR_TOKENS, '--gal-ui-radius'], [], '$.style.tokens')
    for (const [key, token] of Object.entries(value.style.tokens)) {
      check(typeof token === 'string' && (key === '--gal-ui-radius' ? /^(?:[0-9]|[1-3][0-9]|40)px$/.test(token) : /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(token)), '$.style.tokens.' + key)
    }
  }
  return cloneJson(value)
}
export function validateAssetEngineSettings(value) {
  assertJson(value)
  // appearance is a cast choice; retired settings require offline migration.
  check(!Object.hasOwn(value, 'defaultStageForm'), '$.defaultStageForm', 'Use cast appearance', 'UNKNOWN_FIELD')
  for (const key of ['directionStyle', 'directionStyles']) check(!Object.hasOwn(value, key), '$.' + key, 'Use directions assets', 'UNKNOWN_FIELD')
  // removed vector settings must be migrated before entry validation.
  check(!Object.hasOwn(value, 'semanticRecall'), '$.semanticRecall', 'Unknown field', 'UNKNOWN_FIELD')
  value = cloneJson(value)
  value.stageToggles ??= defaultAssetEngineSettings().stageToggles
  value.stageToggles.items ??= true
  value.stageToggles.performance ??= true
  // 入场演出 - the stage opens with the card's entrance asset (stage-entrance.js); default on.
  value.stageToggles.entrance ??= true
  shape(value.stageToggles, STAGE_TOGGLES, STAGE_TOGGLES, '$.stageToggles')
  for (const key of STAGE_TOGGLES) bool(value.stageToggles[key], '$.stageToggles.' + key)
  value.judge = validateJudgeConfig(value.judge ?? defaultJudgeConfig())
  value.narrator ??= defaultAssetEngineSettings().narrator
  validateNarratorSettings(value.narrator, '$.narrator', true)
  // Retired dimensions have no current command or UI; leave their persisted source untouched.
  if (value.dimensions && typeof value.dimensions === 'object' && !Array.isArray(value.dimensions)) value.dimensions = Object.fromEntries(Object.entries(value.dimensions).filter(([key]) => ENGINE_DIMENSIONS.includes(key)))
  const keys = Object.keys(defaultAssetEngineSettings())
  value = Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key)))
  shape(value, keys, keys, '$'); check(value.schemaVersion === 1, '$.schemaVersion')
  for (const [key, format] of [['dialogueThemes', 'dsh-dialogue-theme']]) {
    array(value[key], '$.' + key, 128); unique(value[key].map(item => item.id), '$.' + key)
    for (const item of value[key]) { check(item.format === format, '$.' + key); validateEnginePreset(item) }
  }
  // The sole dialogue switch is stageToggles.dialogue, not the retired dialogue.enabled.
  if (value.dialogue && typeof value.dialogue === 'object' && !Array.isArray(value.dialogue)) delete value.dialogue.enabled
  // Retired dialogue.textLanguage is migrated offline, never read.
  shape(value.dialogue, ['emotions','injection'], ['emotions','injection'], '$.dialogue')
  normalizeBubbleEmotions(value.dialogue.emotions); normalizeBubbleInjection(value.dialogue.injection)
  // the global default skin (舞台设置 › 基础设置「默认皮肤」) may also be a pack skin.
  if (value.dialogueTheme && typeof value.dialogueTheme === 'object') validateAssetRef(value.dialogueTheme, '$.dialogueTheme', 'skins')
  else check(builtinThemes.includes(value.dialogueTheme) || value.dialogueThemes.some(item => item.id === value.dialogueTheme), '$.dialogueTheme')
  // directorModel is null (跟随前台, the default; a stored 'foreground' reads
  // the same) or {provider, model}; stage-director.js resolves it.
  if (value.directorModel !== null && value.directorModel !== 'foreground') {
    shape(value.directorModel, ['provider', 'model'], ['provider', 'model'], '$.directorModel')
    text(value.directorModel.provider, '$.directorModel.provider', 160); text(value.directorModel.model, '$.directorModel.model', 256)
  }
  shape(value.dimensions, ENGINE_DIMENSIONS, ENGINE_DIMENSIONS, '$.dimensions')
  for (const key of ENGINE_DIMENSIONS) bool(value.dimensions[key], '$.dimensions.' + key)
  // discard retired quotas in the settings projection, never in saved operations.
  for (const key of ['emote','cam','sfx','title','skin']) delete value.actionCaps[key]
  shape(value.actionCaps, Object.keys(ACTION_CAPS), Object.keys(ACTION_CAPS), '$.actionCaps')
  for (const key of Object.keys(ACTION_CAPS)) integer(value.actionCaps[key], 1, 256, '$.actionCaps.' + key)
  check(value.voiceServices && typeof value.voiceServices === 'object' && !Array.isArray(value.voiceServices), '$.voiceServices')
  for (const [kind, serviceId] of Object.entries(value.voiceServices)) {
    id(kind, '$.voiceServices.kind'); id(serviceId, '$.voiceServices.' + kind)
  }
  return cloneJson(value)
}
export function patchAssetEngineSettings(current, patch) {
  assertJson(patch); shape(patch, Object.keys(defaultAssetEngineSettings()).filter(key => key !== 'schemaVersion'), [], '$.patch')
  const next = {...current, ...cloneJson(patch)}
  for (const key of ['dimensions', 'actionCaps', 'stageToggles', 'narrator']) if (Object.hasOwn(patch, key)) {
    shape(patch[key], Object.keys(current[key]), [], '$.patch.' + key)
    next[key] = {...current[key], ...patch[key]}
  }
  return validateAssetEngineSettings(next)
}
export const engineSettingsRevision = value => createHash('sha256').update(canonicalJson(validateAssetEngineSettings(value))).digest('hex')
export const parseEnginePreset = text => validateEnginePreset(parseJson(text))
