import cardStageModeProtocol from '../../packages/dsh-presentation-protocol/src/card-stage-mode.cjs'
const {cardStageMode} = cardStageModeProtocol
// Global stage toggles and card-owned visual/module preferences.
import { DIRECTOR_DIMENSIONS, RETIRED_STAGE_SKINS, defaultAssetEngineSettings, validateNarratorSettings } from './asset-engine-settings.js'
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
  shape(value, [...switches, 'defaultSkin', 'skinChoice', 'dimensions', 'narrator'], [], path)
  for (const key of switches) if (value[key] !== undefined) bool(value[key], path + '.' + key)
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
// returns here): the card's 「使用皮肤」 (stage.defaultSkin) > the global 默认皮肤 (engine dialogueTheme, 舞台设置 › 基础设置; a
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

export function effectiveCardStage(extension, engine) {
  const stored = extension?.stage || {}
  validateCardStage(stored)
  // 对话气泡 and 舞台模式 come from the card alone; the global switches cover the rest (配音, music, sounds, …).
  const { dialogue: _dialogue, stage: _stage, ...global } = engine?.stageToggles || defaultAssetEngineSettings().stageToggles
  const value = {widgets:false, ...stored, ...global}
  Object.assign(value, cardStageMode(stored))
  return value
}

// 旁白配音 in effect for a card: each key of the card layer (stage.narrator) wins over the global one (engine narrator).
export function effectiveNarrator(extension, engine) {
  const global = engine?.narrator || defaultAssetEngineSettings().narrator, card = extension?.stage?.narrator || {}
  return {enabled:(card.enabled ?? global.enabled) === true, voice:card.voice !== undefined ? card.voice : global.voice}
}

export function cardEngineSettings(engine, extension) {
  const stage = effectiveCardStage(extension, engine)
  // The director commands are global only (舞台模式 › 可用演出); a stored stage.dimensions is ignored. The audio kinds and
  // widgets follow the global switches / the card's 模组 gate as before.
  const dimensions = {...engine.dimensions, widgets:stage.widgets === true}
  for (const [toggle, dimension] of [['performance','performance'], ['items','items'], ['music','music'], ['sfx','sfx'], ['ambience','soundscape'], ['widgets','widgets']]) {
    dimensions[dimension] = stage[toggle] === true
  }
  return {...engine, dimensions}
}
