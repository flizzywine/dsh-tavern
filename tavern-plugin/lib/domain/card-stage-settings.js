import cardStageModeProtocol from '../../packages/dsh-presentation-protocol/src/card-stage-mode.cjs'
const {cardStageMode} = cardStageModeProtocol
// Global stage toggles and card-owned visual/module preferences.
import { DIRECTOR_DIMENSIONS, defaultAssetEngineSettings, validateNarratorSettings } from './asset-engine-settings.js'
import { validateAssetRef } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import skinContract from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { shape, bool, check } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

// A stage skin selection: a built-in id or a pack skin ref.
export function validateStageSkinSelection(skin, path) {
  if (typeof skin === 'string') check(Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS,skin), path)
  else validateAssetRef(skin,path,'skins')
}

export function validateCardStage(value, path = '$.stage') {
  // enabled is the single card declaration; dialogue/stage remain accepted for old cards.
  const switches = ['enabled', 'widgets', 'dialogue', 'stage']
  shape(value, [...switches, 'defaultSkin', 'skinChoice', 'dimensions', 'narrator'], [], path)
  for (const key of switches) if (value[key] !== undefined) bool(value[key], path + '.' + key)
  if (value.narrator !== undefined) validateNarratorSettings(value.narrator, path + '.narrator')
  // a default is presentation policy, never a recorded director operation. defaultSkin is the card's own
  // (authored, exported with it); skinChoice the player's choice for this card (CONFIG › 画面「本卡皮肤」, never exported).
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

// the one place the card's skin is decided, when the
// director is not changing it for a while (a performance skin wins and returns here). The player's choice
// for this card > the card's own default > its bound packs' default (cardPackStageSkin) > the global default (engine
// dialogueTheme, 舞台设置 › 基础设置; a saved custom dialogue theme reads as its built-in theme) > classic. { skin, fallback }:
// fallback = the same without the player's choice (CONFIG's ↺ goes back to it). `manifests`: the installed manifests the caller
// read (the card's content packs, and any other pack a selection names). A pack skin is drawn only while its pack still has it;
// an absent one (pack deleted, unbound or the skin removed) is passed over for the next in the order - presentation only, the
// stored selection is never rewritten, and it applies again once its skin is back (§17.5).
export function cardStageSkin(extension, engine, manifests = []) {
  const stage = extension?.stage || {}, theme = engine?.dialogueTheme
  const global = theme && typeof theme === 'object' ? theme : Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS, theme ?? '') ? theme
    : engine?.dialogueThemes?.find(item => item.id === theme)?.style.theme || 'classic'
  const present = skin => typeof skin === 'string' ? Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS, skin)
    : !!skin && manifests.some(manifest => manifest?.id === skin.packId && manifest.assets.some(asset => asset.kind === 'skins' && asset.id === skin.assetId))
  const fallback = [stage.defaultSkin, cardPackStageSkin(extension, manifests), global].find(present) ?? 'classic'
  return {skin: present(stage.skinChoice) ? stage.skinChoice : fallback, fallback}
}

// The packs whose manifests cardStageSkin needs: the card's content packs, the pack of a global default pack skin and, while
// it is globally enabled (`enabledPackIds`), the pack of the player's choice (本卡皮肤 offers globally enabled packs' skins).
export function cardStageSkinPackIds(extension, engine, enabledPackIds = []) {
  const theme = engine?.dialogueTheme, choice = extension?.stage?.skinChoice
  return [...new Set([...cardContentPackIds(extension), ...(theme && typeof theme === 'object' ? [theme.packId] : []),
    ...(choice?.packId && enabledPackIds.includes(choice.packId) ? [choice.packId] : [])])]
}

// The card's content packs in binding order (boundPackIds keep it; the dedicated 模组 config pack, modConfigPackId, holds
// settings, not content).
export function cardContentPackIds(extension) {
  return (extension?.assetBindings?.boundPackIds || []).filter(id => id !== extension.modConfigPackId)
}

// The pack default a card without its own skin takes: the first of its content packs, in binding order, that declares one
// (a figures- or music-only pack bound before it declares none and so does not hide it).
export function cardPackStageSkin(extension, manifests) {
  for (const id of cardContentPackIds(extension)) { const skin = packStageSkin(manifests.find(manifest => manifest?.id === id)); if (skin) return skin }
  return null
}

// A pack's declared default stage skin (manifest.stageSkin) as a skin ref, while that skin is still in the pack.
export function packStageSkin(manifest) {
  const id = manifest?.stageSkin
  return id && manifest.assets.some(asset => asset.kind === 'skins' && asset.id === id) ? {packId: manifest.id, kind: 'skins', assetId: id} : null
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
