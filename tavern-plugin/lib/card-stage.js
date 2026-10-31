import {directionStyles} from './domain/direction-styles.js'
import {figureCatalogue} from './domain/figure-catalogue.js'
import skinContract from '../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { effectiveCardStage, cardStageSkin, effectiveNarrator } from './domain/card-stage-settings.js'
import { selectStageEntrance } from './domain/stage-entrance.js'
import { rawData } from './domain/card-preparation.js'
import { readCardAssetExtension } from './domain/card-asset-bindings.js'
import { hasCardAssetBindings } from './card-asset-bindings.js'
import { normalizeBubbleConfig, effectiveBubbleMoods, syncDialogueBubbleWorldbook } from './domain/dialogue-bubbles.js'
import { selectPackFigure } from './domain/asset-pack-presentation.js'
import { effectiveVoiceLanguage } from '../src/client/bubble-line.cjs'
import { assetPackDigest } from './domain/stage-asset-pack-catalogue.js'
import { collectSpriteDialogue } from './domain/layered-sprite-dialogue.js'
import { inspectWorldBookDocument, updateWorldBookDocument } from './domain/worldbook-resource.js'
// a character's one colour is its figure's 形象色 (the user's
// imageColor, else the autoColor sampled from its image); no palette, no collision avoidance, every consumer reads it.
// Readability is resolved on screen against the actual background (client figure-color-contrast.js), not here.

// the mini-preview palette of one skin option, read from the skin's own tokens (its
// default level's look, the panel `ui` over the textbox paint) - inert colours only, computed with the options list.
export function stageSkinPreview(document) {
  let look = document
  try { look = skinContract.stageSkinAppearance(document) || document } catch { look = document }
  const paint = {...look?.textbox?.paint, ...look?.ui}
  if (!paint.bg) return undefined
  const fg = paint.fg || paint.bg
  return {bg:paint.bg, fg, accent:paint.accent || look.textStyle?.emphasis || fg, border:paint.border || paint.fgMuted || fg}
}

// A figure's 配音语言 (bubble-line.cjs: its own choice, else its voice's language, else 中文) → its primary language,
// the only part the dialogue rules compare.
const figureVoiceLanguage = (figure, pack) => effectiveVoiceLanguage(figure?.voice?.language, pack?.manifest.voiceLibrary?.voices[figure?.voice?.voice]?.language).split('-')[0].toLowerCase()
// Dialogue text is projected from Card Preparation; no card-local media catalogue.
export function cardBubbleConfig(raw, engine, packSnapshots = [], globalEnabledPackIds = [], voiceServices = []) {
  const extension = raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null
  const stage = effectiveCardStage(extension, engine), chosen = cardStageSkin(extension, engine, packSnapshots.map(pack => pack.manifest))
  const dialogue = engine.dialogue, models = []
  const rows = figureCatalogue({snapshots:packSnapshots,bindings:extension?.assetBindings,globalEnabledPackIds}).filter(row => row.enabled)
  const characters = rows.map(row => {
    const {actorKey:alias,figure,ref} = row
    const value = {name:figure.name,description:figure.description,appearance:figure.appearance,aliases:figure.aliases || [],ref,recall:figure.recall}
    const pack = packSnapshots.find(pack => pack.manifest.id === ref.packId)
    const voice = pack?.manifest.voiceLibrary?.voices[figure.voice?.voice]
    const source = voice && figure.voice?.source !== null ? voice.sources[figure.voice.source ?? voice.defaultSource] : null
    const voiceDirection = false
    const outfits = figure?.enabled ? figure.outfits.filter(outfit => outfit.enabled && outfit.sprite && pack.sprites?.[outfit.sprite.manifestKey]) : []
    // Read-only catalogue keys, not legacy portrait-library bindings or asset aliases.
    const sprites = outfits.map(outfit => {
      const model = 'sprite_' + models.length
      models.push({id:model, spritePack:pack.sprites[outfit.sprite.manifestKey]})
      return {model, label:outfit.label || outfit.key}
    })
    // the cast only binds a figure; its voice data comes from that pack. the
    // figure's voice language is always projected (no 双语配音 switch); unknown means 中文.
    return {alias, ...value, voiceDirection, emotions:figure?.enabled ? figure.emotions : undefined,
      voice:stage.voice && figure?.enabled ? figure.voice?.source !== null ? figure.voice?.voice || '' : '' : '', voiceLang:figureVoiceLanguage(figure, pack),
      ...(sprites.length ? {portrait:sprites[0].model, outfitLabel:sprites[0].label, outfits:sprites.slice(1)} : {})}
  })
  // the one place bubbles are decided — the card's own switch; a card without stage
  // settings has no figures to show and writes plain text (no dialogue-format injection) until 「开启对话气泡」.
  const config = normalizeBubbleConfig({...dialogue, enabled:!!extension && stage.dialogue, characters,
    stage:{theme:typeof chosen.skin === 'string' ? chosen.skin : 'classic',enabled:!!extension && stage.stage,director:!!extension && stage.stage,music:stage.music,widgets:stage.widgets}})
  config.characters = config.characters.map(({avatar, moods, full, ...character}) => {
    const row = rows.find(row => row.actorKey === character.alias), {ref,figure} = row
    const pack = packSnapshots.find(pack => pack.manifest.id === ref.packId)
    character.color = (figure.imageColor ?? figure.autoColor ?? '').toLowerCase()
    // Transcript portraits use the bound figure's default outfit, not stage directions.
    const media = emotion => {
      const selected = selectPackFigure(figure, pack?.sprites || {}, {emotion}), hash = selected.avatar
      return hash ? {resource:true, kind:'media', ref:{...ref}, alias:character.alias, revision:pack.revision,
        hash, outfitKey:selected.avatarOutfitKey, stateId:selected.avatarStateId, crop:selected.avatarCrop, identity:`${ref.packId}:figures:${ref.figureId}:${hash}`} : null
    }
    const promptEmotionIds = (figure.emotions || []).map(row=>row.id)
    return {...character, promptEmotionIds, defaultEmotion:figure.outfits.find(outfit=>outfit.enabled)?.defaultEmotion || figure.emotions?.[0]?.id || null, ref, aliases:figure.aliases || [], recall:figure.recall, voiceKey:figure?.voice ? assetPackDigest({ref,voice:figure.voice,voiceSpec:pack?.manifest.voiceLibrary?.voices[figure.voice.voice],readings:extension?.readings || null}) : null, avatarMedia:{default:media(figure.outfits.find(o=>o.enabled)?.defaultEmotion || figure.emotions?.[0]?.id), moods:Object.fromEntries(effectiveBubbleMoods(config, character.alias).map(mood => [mood.id, media(mood.id)]))},
      voiceLanguage:figureVoiceLanguage(figure, pack)}
  })
  config.stage.styles = directionStyles(packSnapshots, extension?.assetBindings.boundPackIds, globalEnabledPackIds)
  // defaultSkin = the card's skin now (cardStageSkin); skinChoice = the player's own choice for this
  // card (CONFIG 本卡皮肤, null = none) and skinFallback what its ↺ returns to.
  config.stage.defaultSkin = structuredClone(chosen.skin); config.stage.skinChoice = structuredClone(extension?.stage?.skinChoice ?? null); config.stage.skinFallback = structuredClone(chosen.fallback);
  // the 音效 / 环境音 switches are part of the session settings like BGM, so switching
  // one in 舞台设置 changes the settings key and the open stage re-projects its audio at once (not on the next turn).
  config.stage.sfx = stage.sfx; config.stage.ambience = stage.ambience;
  // every option carries a small palette for the CONFIG skin select's mini preview, and a pack
  // skin its bundle descriptor, so the select warms the bundle while the player points at it (「切换皮肤需要一段时间」).
  const skinResource = (pack, asset, ref) => {
    const hash = pack.manifest.bundles?.[asset.bundleKey]?.contentHash
    return hash ? {resource:{resource:true,kind:'bundle',ref:{...ref},revision:pack.revision,hash,bundleKey:asset.bundleKey,identity:`${ref.packId}:skins:${ref.assetId}:${hash}`}} : {}
  }
  config.stage.skinChoices = Object.values(skinContract.BUILTIN_STAGE_SKINS).map(document=>({value:document.id,label:document.label,preview:stageSkinPreview(document)}));
  // 本卡皮肤 offers the skins of the packs this card may use: bound (本卡开启) or globally enabled (a skin pack
  // such as 通用皮肤 is switched on globally with its lamp). A switched-off pack's skins are not offered.
  const skinPackIds = extension ? [...extension.assetBindings.boundPackIds, ...globalEnabledPackIds] : []
  for(const pack of packSnapshots) if(skinPackIds.includes(pack.manifest.id))
    for(const asset of pack.manifest.assets.filter(a=>a.kind==='skins')) {
      const document=pack.skins?.[asset.id], value={packId:pack.manifest.id,kind:'skins',assetId:asset.id}
      if(document)config.stage.skinChoices.push({value,label:document.label,preview:stageSkinPreview(document),...skinResource(pack,asset,value)});
    }
  // Initial open needs a skin before any director record or media projection exists.
  const selection=typeof chosen.skin==='object' ? chosen.skin : null;
  const ref=selection ? {packId:selection.packId,kind:'skins',assetId:selection.assetId} : null, pack=ref && packSnapshots.find(p=>p.manifest.id===ref.packId);
  const asset=pack?.manifest.assets.find(a=>a.kind==='skins' && a.id===ref.assetId);
  const document=typeof chosen.skin==='string' ? skinContract.BUILTIN_STAGE_SKINS[chosen.skin] : asset && pack.skins?.[ref.assetId];
  // bundleKey/entry let the entry veil lease the skin's loader art alone, before the scene's skin bundle (gal-entry.js).
  // resource: the bundle's descriptor, the same one the scene projection carries (asset-pack-presentation.js), so the stage
  // draws a newly chosen skin's art at once from the resource owner, not after the next projection (useStageConfigSkin).
  config.stage.skin = document ? {document:structuredClone(document),...(ref?{ref,bundleKey:asset.bundleKey,entry:asset.entry,
    ...skinResource(pack,asset,ref)}:{builtin:true})} : {builtin:true,document:structuredClone(skinContract.BUILTIN_STAGE_SKINS.classic)};
  config.stage.enabled = !!extension && stage.stage
  // the 入场演出 this card's stage opens with (stage-entrance.js), or null.
  config.stage.entrance = extension ? selectStageEntrance(extension, packSnapshots, engine) : null
  config.voice = {enabled:stage.voice && config.characters.some(character => character.voice)}
  // 旁白配音: present only while it speaks on this card (on, 配音 on, its voice usable here). It never changes config.voice,
  // so the dialogue-format prompt is the same with it on or off.
  const narrator = extension && stage.voice ? cardNarrator(effectiveNarrator(extension, engine), packSnapshots, extension) : null
  if (narrator) config.narrator = narrator
  config.spriteDialogue = collectSpriteDialogue(config, models)
  return config
}

// The narrator's voice identity (client cache key): a browser system voice, or the figure's voice as cardBubbleConfig keys a
// character's. A figure in a pack this card cannot use, or without a voice, leaves the narration silent.
function cardNarrator(narrator, packSnapshots, extension) {
  const voice = narrator.enabled ? narrator.voice : null
  if (!voice) return null
  if (voice.browser) return {voiceKey:'browser:' + voice.browser}
  const pack = packSnapshots.find(pack => pack.manifest.id === voice.packId), figure = pack?.figures?.[voice.figureId]
  const spec = figure?.voice && figure.voice.source !== null ? pack.manifest.voiceLibrary?.voices[figure.voice.voice] : null
  return spec ? {voiceKey:assetPackDigest({narrator:true, ref:voice, voice:figure.voice, voiceSpec:spec, readings:extension.readings || null})} : null
}

// ZIP imports prepare the embedded book in memory before computing the commit proof.
// Reuse the existing ownership/placement rules; never acquire the pack or card gate here.
export async function syncPreparedCardBubbles(workspace, cardPath, engine, packSnapshots = [], globalEnabledPackIds = []) {
  if (!hasCardAssetBindings(workspace.raw)) return
  const source = {kind:'card', cardPath}
  const worldBooks = {
    binding:async () => ({source}),
    get:async () => {
      const document = structuredClone(workspace.raw)
      rawData(document).character_book ||= {name:'', entries:[]}
      return {source, view:inspectWorldBookDocument(document)}
    },
    update:async (_source, request) => {
      const document = structuredClone(workspace.raw)
      rawData(document).character_book ||= {name:'', entries:[]}
      workspace.raw = updateWorldBookDocument(document, request).document
    }
  }
  return syncDialogueBubbleWorldbook(worldBooks, cardPath, cardBubbleConfig(workspace.raw, engine, packSnapshots, globalEnabledPackIds))
}

// committed figure edits refresh every dependent card's managed writer entry.
// Serialize notifications (not pack writes); each task reads the latest figure and card data.
export function watchFigureBubbleBooks({service, listCards, readWorkspace, sync, onError, packSettings}) {
  let active = true, pending = Promise.resolve()
  const globals = () => packSettings?.read().values.globalEnabledPackIds || []
  function enqueue(packId) {
    pending = pending.then(async () => {
      for (const path of await listCards()) {
        if (!active) return
        try {
          const raw = (await readWorkspace(path))?.raw
          if (!active) return
          if (!raw || !hasCardAssetBindings(raw)) continue
          const bindings = readCardAssetExtension(raw).assetBindings
          if (!packId || bindings.boundPackIds.includes(packId) || globals().includes(packId)) await sync(path)
        } catch (error) { onError(error, path) }
      }
    }).catch(error => onError(error))
  }
  const stop = service.subscribe(event => {if (event.figures?.length) enqueue(event.packId)})
  // global pack changes affect all opted-in cards, not just explicit bindings.
  const stopSettings = packSettings?.subscribe(() => enqueue())
  return {drain:() => pending, dispose() {active = false; stop(); stopSettings?.()}}
}

export function createCardStage({cardStorage, getEngine, getAssetLibrary = () => null, getGlobalEnabledPackIds = () => [], getTts = () => null, measure = (_name,run) => run()}) {
  const workspace = cardStorage.readWorkspace
  const bubbles = {
    async read(cardPath, options) { return (await bubbles.snapshot(cardPath, options)).config },
    async snapshot(cardPath, {requireAvailable = false} = {}) {
      const raw = cardPath ? (await measure('bubbles.workspace', () => workspace(cardPath)))?.raw : null
      const extension = raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null
      const service = getAssetLibrary(), packs = []
      const packIds = [...new Set([...(extension?.assetBindings.boundPackIds || []),...getGlobalEnabledPackIds()])]
      // Queue the scope together: serial awaits rejoin the busy publication gate once per pack.
      const reads = await measure('bubbles.packs', () => Promise.allSettled(packIds.map(packId => service?.getPackSnapshot({packId}))))
      function assertAvailable() {
        // Missing packs project away; actual read failures must still prevent freezing a broken read.
        for (const result of reads) {
          if (result.status === 'rejected') throw result.reason
        }
      }
      if (requireAvailable) assertAvailable()
      for (const result of reads) if (result.status === 'fulfilled' && result.value) packs.push(result.value)
      const services = await measure('bubbles.voiceServices', () => getTts()?.listServices()) || []
      const config = await measure('bubbles.project', () => cardBubbleConfig(raw, getEngine(), packs, getGlobalEnabledPackIds(), services))
      // One request may also preview a prompt. Reuse its catalogue, but retain strict admission failures.
      return {config, requireAvailable() { assertAvailable(); return config }}
    },
    async sync(worldBooks, cardPath) {
      return syncDialogueBubbleWorldbook(worldBooks, cardPath, await bubbles.read(cardPath))
    }
  }
  return {bubbles}
}
