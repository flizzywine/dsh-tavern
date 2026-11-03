import cardStageModeProtocol from '../../packages/dsh-presentation-protocol/src/card-stage-mode.cjs'
const {cardStageMode} = cardStageModeProtocol
// Global stage toggles and card-owned visual/module preferences.
import { DIRECTOR_DIMENSIONS, RETIRED_STAGE_SKINS, STAGE_TOGGLES, defaultAssetEngineSettings, validateNarratorSettings } from './asset-engine-settings.js'
import { resolveSwitch } from './mod-system.js'
import { validateAssetRef } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import skinContract from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { shape, bool, check } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

// A stage skin selection: a built-in id or a pack skin ref. A removed built-in id still validates; cardStageSkin draws it
// as an absent skin (the next in the order).
export function validateStageSkinSelection(skin, path) {
  if (typeof skin === 'string') check(Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS,skin) || RETIRED_STAGE_SKINS.includes(skin), path)
  else validateAssetRef(skin,path,'skins')
}

export function validateCardStage(value, path = '$.stage') {
  // enabled is the single card declaration; dialogue/stage remain accepted for old cards.
  const switches = ['enabled', 'widgets', 'dialogue', 'stage']
  shape(value, [...switches, 'switches', 'defaultSkin', 'skinChoice', 'dimensions', 'narrator'], [], path)
  for (const key of switches) if (value[key] !== undefined) bool(value[key], path + '.' + key)
  // 基础设置's card layer (本卡开启 / 本卡关闭) of each four-state switch; a missing key follows the global switch.
  if (value.switches !== undefined) {
    shape(value.switches, CARD_STAGE_SWITCHES, [], path + '.switches')
    for (const [key, choice] of Object.entries(value.switches)) check(choice === 'on' || choice === 'off', path + '.switches.' + key)
  }
  if (value.narrator !== undefined) validateNarratorSettings(value.narrator, path + '.narrator')
  // defaultSkin is the card's one skin value 「使用皮肤」: exported and imported with the card, and written by
  // CONFIG › 画面「本卡皮肤」. Presentation policy, never a recorded director operation. `skinChoice` is the retired
  // per-player choice: old cards keep it as stored and it is still shape-checked, but nothing reads it (CONFIG's next save drops it).
  for (const key of ['defaultSkin', 'skinChoice']) if (value[key] !== undefined) validateStageSkinSelection(value[key], path + '.' + key)
  // `dimensions` is a retired per-card override of the director
  // commands. Old cards keep it as stored (never rewritten) and it is still shape-checked, but nothing reads it
  // (cardEngineSettings) and a patch cannot change it (cardAssetRawOperations).
  if (value.dimensions !== undefined) {
    shape(value.dimensions, DIRECTOR_DIMENSIONS.filter(key => !['music','sfx','soundscape'].includes(key)), [], path + '.dimensions')
    for (const [key, enabled] of Object.entries(value.dimensions)) bool(enabled, path + '.dimensions.' + key)
  }
  return value
}

// The one place the card's skin is decided, when the director is not changing it for a while (a performance skin wins and
// returns here): the card's 「使用皮肤」 (stage.defaultSkin) > the global 默认皮肤 (engine dialogueTheme, 舞台设置 › 舞台模式 › 皮肤; a
// saved custom dialogue theme reads as its built-in theme) > 经典. { skin, fallback }: fallback = global, else classic - what
// the card shows without its own value (CONFIG's ↺ clears the value back to it). `manifests`: the manifests of the packs this
// card may use that the selections name (cardStageSkinPackIds). A pack skin is drawn only while its pack is on for this card
// (bound or globally enabled) and still has it; otherwise the next in the order applies - presentation only, the stored value
// is never rewritten, and it applies again once its skin is back (§17.5).
export function cardStageSkin(extension, engine, manifests = []) {
  const stage = extension?.stage || {}, theme = engine?.dialogueTheme
  const global = theme && typeof theme === 'object' ? theme : Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS, theme ?? '') ? theme
    : engine?.dialogueThemes?.find(item => item.id === theme)?.style.theme
  const usable = skin => typeof skin === 'string' ? Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS, skin)
    : !!skin && manifests.some(manifest => manifest?.id === skin.packId && manifest.assets.some(asset => asset.kind === 'skins' && asset.id === skin.assetId))
  const fallback = usable(global) ? global : 'classic'
  return {skin: usable(stage.defaultSkin) ? stage.defaultSkin : fallback, fallback}
}

// The packs whose manifests cardStageSkin needs: the packs of the card's value and of the global default, each only while it
// is on for this card - bound, or globally enabled (`enabledPackIds`). A pack that is off is not read, so its skin falls back.
export function cardStageSkinPackIds(extension, engine, enabledPackIds = []) {
  const bound = extension?.assetBindings?.boundPackIds || []
  return [...new Set([extension?.stage?.defaultSkin, engine?.dialogueTheme].map(skin => skin?.packId)
    .filter(id => id && (bound.includes(id) || enabledPackIds.includes(id))))]
}

// The card's content packs in binding order (boundPackIds keep it; the dedicated 模组 config pack, modConfigPackId, holds
// settings, not content).
export function cardContentPackIds(extension) {
  return (extension?.assetBindings?.boundPackIds || []).filter(id => id !== extension.modConfigPackId)
}

// The card-declared pair: their card layer is stage.enabled (cardStageChoice), not stage.switches.
const CARD_DECLARED = ['dialogue', 'stage']

// The four-state switches of 基础设置: the engine's stageToggles (global) and 自动生成选项 (global: tavern settings
// candidateAutoGenerate), each with this card's stage.switches key. 旁白配音's card layer is stage.narrator.enabled;
// 对话气泡 / 舞台模式's is stage.enabled.
export const CARD_STAGE_SWITCHES = Object.freeze([...STAGE_TOGGLES.filter(key => !CARD_DECLARED.includes(key)), 'autoChoices'])

// The card layer of 对话气泡 / 舞台模式: the card's declaration as cardStageMode reads it (stage.enabled for both, or an
// older card's dialogue / stage pair; 舞台模式 needs 对话气泡); no declaration = null, follow the global switch.
export function cardStageChoice(stored, key) {
  if (stored?.enabled === undefined && stored?.dialogue === undefined && stored?.stage === undefined) return null
  return cardStageMode(stored)[key] ? 'on' : 'off'
}

// The one place a card's stage switches are decided: each resolves 本卡关闭 > 全局开启 > 本卡开启 > 全局关闭 (resolveSwitch,
// the mods' own rule), then 舞台模式 needs 对话气泡 in effect. The stage's own kinds (BGM … 入场演出) need no gate here: without
// the stage there is no stage snapshot (asset-runtime.js), and the panel greys them by the same effective state.
export function effectiveCardStage(extension, engine) {
  const stored = extension?.stage || {}
  // read as stored: a card's stage is validated once, when it is written or imported, never on read.
  const global = engine?.stageToggles || defaultAssetEngineSettings().stageToggles, card = stored.switches || {}
  const choice = key => CARD_DECLARED.includes(key) ? cardStageChoice(stored, key) : card[key]
  const value = {widgets:false, ...stored, ...Object.fromEntries(STAGE_TOGGLES.map(key => [key, resolveSwitch(global[key], choice(key))]))}
  // an ordinary card (no dsh_tavern extension) never has 对话气泡 or 舞台模式, whatever the global switches say.
  value.dialogue &&= !!extension
  value.stage &&= value.dialogue
  return value
}

// 自动生成选项 for a card: the global candidateAutoGenerate with this card's switch.
export function effectiveAutoChoices(extension, globalOn) {
  return resolveSwitch(globalOn === true, extension?.stage?.switches?.autoChoices)
}

// 旁白配音 in effect for a card: each key of the card layer (stage.narrator) wins over the global one, the tts plugin's
// tts.reading().narrator (`globalNarrator`; absent = off). The voice is {packId, figureId}, {browser} or {serviceId, voice}.
export function effectiveNarrator(extension, globalNarrator) {
  const global = globalNarrator || {enabled:false, voice:null}, card = extension?.stage?.narrator || {}
  // its switch is four-state too: the card layer's enabled (true 本卡开启, false 本卡关闭) with the global one.
  return {enabled:resolveSwitch(global.enabled, card.enabled === undefined ? null : card.enabled ? 'on' : 'off'), voice:card.voice !== undefined ? card.voice : global.voice}
}

export function cardEngineSettings(engine, extension) {
  const stage = effectiveCardStage(extension, engine)
  // The director commands are global only (舞台模式 › 可用演出); a stored stage.dimensions is ignored. The audio kinds and
  // widgets follow the global switches / the card's 模组 gate as before.
  const dimensions = {...engine.dimensions, widgets:stage.widgets === true}
  for (const [toggle, dimension] of [['performance','performance'], ['items','items'], ['music','music'], ['sfx','sfx'], ['ambience','soundscape'], ['widgets','widgets']]) {
    dimensions[dimension] = stage[toggle] === true
  }
  return {...engine, stageToggles:Object.fromEntries(STAGE_TOGGLES.map(key => [key, stage[key]])), dimensions}
}
