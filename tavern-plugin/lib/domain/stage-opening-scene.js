import {figureCatalogue, resolution} from './figure-catalogue.js'
import {listEffectiveAssets} from './effective-assets.js'
import {triggerEvidence, normalizeCatalogueText} from './asset-pack-lexical.js'
// zero-token opening scenes for greeting turns (「开场画面」). Greetings are not AI replies: the director never runs for them. Their scene is the card's
// configured opening (per greeting) or a theme-gradient fallback, and it seeds the first directed turn.
import { assetRefKey } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import { reduceAssetPackScene } from '../../packages/dsh-presentation-protocol/src/asset-pack-stage.js'
import {selectAssetVariant} from '../../packages/dsh-presentation-protocol/src/asset-variants.js'
import { rawData } from './card-preparation.js'
import { readCardAssetExtension } from './card-asset-bindings.js'
import { cardOpeningChoices } from './card-openings.js'
import { greetingKey } from './card-opening-scenes.js'
import { assetPackDimensions, initialAssetPackStage, validateAssetPackStage } from './stage-asset-pack-tools.js'
import { frozenActors } from './stage-asset-pack-director.js'

const clone = value => structuredClone(value)

export function cardGreetings(raw) {
  return cardOpeningChoices(rawData(raw)).map(choice => ({id:choice.id, text:choice.text, key:greetingKey(choice.text)}))
}
// The greeting a greeting message shows: its exact source text, else its swipe slot or recorded id.
export function messageOpeningId(message, greetings) {
  const swipes = Array.isArray(message.swipes) ? message.swipes : null
  const text = swipes ? swipes[message.swipeId || 0] : message.sourceText ?? message.text
  return greetings.find(greeting => greeting.text === text)?.id
    || (swipes ? greetings[message.swipeId || 0]?.id : greetings.find(greeting => greeting.id === message.openingId)?.id)
    || greetings[0]?.id || 'primary'
}
// A stored scene follows its greeting text; the slot id is used only when that text no longer exists.
function storedScene(openings, greetings, id) {
  const scenes = openings?.scenes || {}, greeting = greetings.find(item => item.id === id)
  if (!greeting) return null
  if (scenes[id]?.greeting === greeting.key) return scenes[id]
  const moved = Object.values(scenes).find(scene => scene.greeting === greeting.key)
  if (moved) return moved
  return scenes[id] && !greetings.some(item => item.key === scenes[id].greeting) ? scenes[id] : null
}
export function resolveOpeningScene(assets, openingId) {
  const extension = readCardAssetExtension(assets.raw), dims = assetPackDimensions(assets.engine.dimensions)
  const actors = dims.actors ? frozenActors(extension, assets.snapshots, undefined, assets.globalEnabledPackIds) : {}
  const rows = listEffectiveAssets({snapshots:assets.snapshots,boundPackIds:extension.assetBindings.boundPackIds,globalEnabledPackIds:assets.globalEnabledPackIds})
    .filter(row => !row.ref.figureId && row.asset.enabled && assets.assetStatus[assetRefKey(row.ref)]?.available)
  const of = kind => rows.filter(row => row.ref.kind === kind)
  const first = (kind, test) => of(kind).find(test)?.ref || null
  const bound = row => extension.assetBindings.boundPackIds.includes(row.ref.packId)
  const figureRows = figureCatalogue({snapshots:assets.snapshots,bindings:extension.assetBindings,globalEnabledPackIds:assets.globalEnabledPackIds})
  const greetingText = normalizeCatalogueText(cardGreetings(assets.raw).find(row => row.id === openingId)?.text || '')
  const eligible = figureRows.filter(row => Object.hasOwn(actors,row.actorKey))
  const leadRow = (extension.openings?.lead && resolution.resolveFigureName(eligible,extension.openings.lead).row)
    || eligible.find(row => triggerEvidence({name:row.name,keywords:row.aliases},[greetingText],{excludeTimeWords:false}).matched)
    || eligible.find(row => row.recall.mode === 'constant')
  const lead = leadRow?.ref || null
  const stored = storedScene(extension.openings, cardGreetings(assets.raw), openingId)
  // a greeting without its own scene opens on the empty theme gradient with nobody on
  // stage — never the 主角 or another greeting's cast/background/outfits; the director stages the first reply.
  const scene = stored ? (({greeting, ...value}) => clone(value))(stored) : {
    background:null, timeOfDay:null, music:first('music', bound), cast:[]}
  const has = (ref, kind) => !!ref && of(kind).some(row => assetRefKey(row.ref) === assetRefKey(ref))
  let state = initialAssetPackStage({})
  if (dims.scene && has(scene.background, 'backgrounds')) {
    state = reduceAssetPackScene(state, {background:scene.background, timeOfDay:scene.timeOfDay}, []).state
  }
  if (dims.music && has(scene.music, 'music')) state.music = clone(scene.music)
  const emotions = {}
  for (const entry of scene.cast) {
    const alias = resolution.resolveFigureName(eligible,entry.figure).actorKey
    const actor = actors[alias]
    if (!actor?.figure || state.cast.length >= 3 || state.cast.includes(alias)) continue
    state.actors[alias] = initialAssetPackStage({[alias]:actor}).actors[alias]
    const outfit = actor.outfits.find(item => item.key === entry.outfitKey && item.enabled)
    if (outfit) Object.assign(state.actors[alias], {outfitKey:outfit.key, ruler:clone(outfit.ruler)})
    state.cast.push(alias)
    emotions[alias] = entry.emotion
  }
  if (dims.cg && has(scene.cg?.ref, 'cg')) {
    const asset = of('cg').find(row => assetRefKey(row.ref) === assetRefKey(scene.cg.ref)).asset
    const selected=asset.variants?.entries.some(row=>row.id===scene.cg.variant)?scene.cg.variant:undefined
    state.cg = {ref:clone(scene.cg.ref),variant:selectAssetVariant(asset,selected)?.id ?? null,focus:'full',resumeCast:[...state.cast]}
  }
  return {id:openingId, configured:!!stored, lead, scene, state:validateAssetPackStage(state), emotions}
}

// 舞台设置 data: every greeting with its effective (configured or fallback) scene.
export function describeOpeningScenes(raw, assets) {
  const greetings = cardGreetings(raw), resolved = assets ? greetings.map(({id}) => resolveOpeningScene(assets, id)) : []
  return {lead:resolved[0]?.lead ?? null,
    greetings:greetings.map(({id, key, text}) => ({id, key, preview:text.trim().split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 80) || ''})),
    scenes:Object.fromEntries(resolved.map(({id, configured, scene}) => [id, {configured, ...scene}]))}
}
