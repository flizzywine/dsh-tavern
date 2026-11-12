import {directionStyles} from '../../../lib/domain/direction-styles.js'
import {figureCatalogue} from '../../../lib/domain/figure-catalogue.js'
import skinContract from '../../dsh-presentation-protocol/src/stage-skin.cjs'
import { effectiveCardStage, cardStageSkin, effectiveNarrator } from '../../../lib/domain/card-stage-settings.js'
import { selectStageEntrance } from './domain/stage-entrance.js'
import { rawData } from '../../../lib/domain/card-preparation.js'
import { readCardAssetExtension } from '../../../lib/domain/card-asset-bindings.js'
import { hasCardAssetBindings } from '../../../lib/card-asset-bindings.js'
import { normalizeBubbleConfig, syncDialogueBubbleWorldbook } from '../../../lib/domain/dialogue-bubbles.js'
import { selectPackFigure } from './domain/asset-pack-presentation.js'
import { effectiveVoiceLanguage, figureBubbleMoods, voiceTranslates } from '../../../src/client/bubble-line.cjs'
import { assetPackDigest } from './domain/stage-asset-pack-catalogue.js'
import { collectSpriteDialogue } from '../../../lib/domain/layered-sprite-dialogue.js'
import { inspectWorldBookDocument, updateWorldBookDocument } from '../../../lib/domain/worldbook-resource.js'
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
// Every figure a card can resolve, enabled or not: the automatic figure writer checks speakers against these rows.
export const cardFigureRows = ({raw, snapshots, globalEnabledPackIds}) => figureCatalogue({snapshots, bindings:readCardAssetExtension(raw)?.assetBindings, globalEnabledPackIds})
// 自动选角's 选角助理 searches the card's text as pieces: its own fields, each world book entry, and the game's 人物档案.
export function cardLorePieces(raw, chat) {
  const data = rawData(raw) || {}, pieces = []
  for (const [key, label] of [['description', '卡描述'], ['personality', '性格'], ['scenario', '场景'], ['first_mes', '开场白'], ['mes_example', '对话示例']])
    for (const text of String(data[key] || '').split(/\n\s*\n/)) if (text.trim()) pieces.push({source:label, text:text.trim()})
  for (const entry of data.character_book?.entries || []) if (String(entry.content || '').trim())
    pieces.push({source:'世界书：' + (entry.comment || [].concat(entry.keys || []).join('、') || '条目'), text:String(entry.content).trim(), keys:[].concat(entry.keys || [])})
  for (const character of chat?.characterDesignDocument?.characters || [])
    pieces.push({source:'人物档案：' + character.name, text:JSON.stringify(character)})
  return pieces
}
// Dialogue text is projected from Card Preparation; no card-local media catalogue.
// services: getTts().listServices(); chooseService: the tts service's sync choice among them (getTts().chooseService) —
// the source's own serviceId, else the sole service of its provider; none = no voice-direction flag.
// globalNarrator: 旁白配音's global layer, getTts().reading().narrator; none = off. pointed: the figures 通用声音 and 旁白 point
// at ({general, narrator}, each {ref, pack, figure} read from tts.reading(), or null = the browser's default voice).
export function cardBubbleConfig(raw, engine, packSnapshots = [], globalEnabledPackIds = [], services = [], chooseService = () => undefined, globalNarrator = null, pointed = {}) {
  const extension = raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null
  const stage = effectiveCardStage(extension, engine), chosen = cardStageSkin(extension, engine, packSnapshots.map(pack => pack.manifest))
  const dialogue = engine.dialogue, models = []
  const rows = figureCatalogue({snapshots:packSnapshots,bindings:extension?.assetBindings,globalEnabledPackIds}).filter(row => row.enabled)
  const figuresByAlias = new Map(rows.map(row => [row.actorKey, row]))
  const packsById = new Map(packSnapshots.map(pack => [pack.manifest.id, pack]))
  const characters = rows.map(row => {
    const {actorKey:alias,figure,ref} = row
    const value = {name:figure.name,guidance:figure.guidance,appearance:figure.appearance,aliases:figure.aliases || [],ref,recall:figure.recall}
    const pack = packsById.get(ref.packId)
    const voice = pack?.manifest.voiceLibrary?.voices[figure.voice?.voice]
    const source = voice && figure.voice?.source !== null ? voice.sources[figure.voice.source ?? voice.defaultSource] : null
    const voiceDirection = source?.provider === 'fish-audio' && chooseService(source, services)?.capabilities?.voiceDirections === true
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
  // These are resolved catalogue rows. Their normalized emotions need no speaker lookup.
  config.characters = config.characters.map(({avatar, moods, full, ...character}) => {
    const row = figuresByAlias.get(character.alias), {ref,figure} = row
    const pack = packsById.get(ref.packId)
    character.color = (figure.imageColor ?? figure.autoColor ?? '').toLowerCase()
    // Transcript portraits: the opening (first enabled) outfit at the top level; every other enabled outfit under
    // `outfits`, which a bubble wears when the round's stage state dresses the figure in it (getTranscriptOutfits).
    const media = (emotion, outfitKey) => {
      const selected = selectPackFigure(figure, pack?.sprites || {}, {emotion, outfitKey}), hash = selected.avatar
      return hash ? {resource:true, kind:'media', ref:{...ref}, alias:character.alias, revision:pack.revision,
        hash, outfitKey:selected.avatarOutfitKey, stateId:selected.avatarStateId, crop:selected.avatarCrop, identity:`${ref.packId}:figures:${ref.figureId}:${hash}`} : null
    }
    const opening = figure.outfits.find(outfit => outfit.enabled), bubbleMoods = figureBubbleMoods([], character.emotions)
    const outfitMedia = outfit => ({default:media(outfit?.defaultEmotion || figure.emotions?.[0]?.id, outfit?.key), moods:Object.fromEntries(bubbleMoods.map(mood => [mood.id, media(mood.id, outfit?.key)]))})
    const promptEmotionIds = (figure.emotions || []).map(row=>row.id)
    // 通用声音 speaks an enabled figure that has no voice binding (one set to 「不配音」, source null, stays silent).
    const general = stage.voice && figure.enabled && !figure.voice
    return {...character, ...(general ? {general:true} : {}), promptEmotionIds, defaultEmotion:figure.outfits.find(outfit=>outfit.enabled)?.defaultEmotion || figure.emotions?.[0]?.id || null, ref, aliases:figure.aliases || [], recall:figure.recall, voiceKey:figure?.voice ? figureVoiceKey(ref, figure, pack, extension) : null, avatarMedia:{...outfitMedia(opening), outfits:Object.fromEntries(figure.outfits.filter(outfit => outfit.enabled && outfit !== opening).map(outfit => [outfit.key, outfitMedia(outfit)]))},
      voiceLanguage:figureVoiceLanguage(figure, pack)}
  })
  config.stage.styles = directionStyles(packSnapshots, extension?.assetBindings.boundPackIds, globalEnabledPackIds)
  // defaultSkin = the card's skin now (cardStageSkin); cardSkin = the card's stored 「使用皮肤」 (CONFIG 本卡皮肤, null = none)
  // and skinFallback what the card shows without it (global default, else classic; its ↺ returns there).
  config.stage.defaultSkin = structuredClone(chosen.skin); config.stage.cardSkin = structuredClone(extension?.stage?.defaultSkin ?? null); config.stage.skinFallback = structuredClone(chosen.fallback);
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
  // enabled = this card's 角色配音 switch. Whether a line has a voice is each figure's own state: a card whose figures are all
  // unbound still speaks them with 通用声音, so the switch must not depend on any figure having a voice of its own.
  config.voice = {enabled:stage.voice}
  // Neither reaches the dialogue-format prompt (normalizeBubbleConfig keeps only voice.enabled).
  // 通用声音 / 旁白 speak as the figure they point at: its voice key (the cast's, so the clips are shared) and its 配音语言,
  // which decides 配音补译; neither reaches the prompt. 「不配音」 is silent; a figure gone has no key (silent, a 配音页 problem).
  const general = pointedVoice(pointed.general, extension)
  if (stage.voice && general) Object.assign(config.voice, {general:general.voiceKey, generalLanguage:general.language})
  // 旁白配音: present only while it speaks on this card (on, 配音 on, its voice not 不配音). It never changes config.voice,
  // so the dialogue-format prompt is the same with it on or off.
  const narrator = pointedVoice(pointed.narrator, extension)
  // wholeParagraph: 旁白 reads in another language, so each narration paragraph is translated whole (配音补译) and read from
  // its first page (bubble-line.cjs narrationVoiceKey); in 中文 it reads page by page.
  if (extension && stage.voice && effectiveNarrator(extension, globalNarrator).enabled && narrator) config.narrator = {...narrator, ...(voiceTranslates(narrator.language) ? {wholeParagraph:true} : {})}
  config.spriteDialogue = collectSpriteDialogue(config, models)
  return config
}

// A figure's voice identity (the client's clip cache key): one formula for the cast and the figures 通用声音 / 旁白 point at.
const figureVoiceKey = (ref, figure, pack, extension) => assetPackDigest({ref,voice:figure.voice,voiceSpec:pack?.manifest.voiceLibrary?.voices[figure.voice.voice],readings:extension?.readings || null})
// null = silent (「不配音」, or the figure is gone); none chosen = the browser's default voice in 中文.
function pointedVoice(row, extension) {
  if (!row) return {voiceKey:'browser:', language:'zh'}
  if (!row.figure?.voice || row.figure.voice.source === null || !row.pack?.manifest.voiceLibrary?.voices[row.figure.voice.voice]) return null
  return {voiceKey:figureVoiceKey(row.ref, row.figure, row.pack, extension), language:figureVoiceLanguage(row.figure, row.pack)}
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
      const opened = cardPath ? await measure('bubbles.workspace', () => workspace(cardPath)) : null, raw = opened?.raw || null
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
      // 通用声音 / 旁白: the figures tts.reading() points at, from any installed pack (already read when the card uses it).
      const reading = getTts()?.reading(), pointAt = async ref => {
        if (!ref) return null
        const pack = packs.find(row => row.manifest.id === ref.packId) || await service?.getPackSnapshot({packId:ref.packId})
        return {ref, pack, figure:pack?.figures[ref.figureId]}
      }
      const pointed = {general:await pointAt(reading?.general.figure), narrator:await pointAt(reading?.narrator.figure)}
      const config = await measure('bubbles.project', () => cardBubbleConfig(raw, getEngine(), packs, getGlobalEnabledPackIds(), services, (source, list) => getTts()?.chooseService(source, list), reading?.narrator, pointed))
      // One request may also preview a prompt. Reuse its catalogue, but retain strict admission failures.
      return {config, requireAvailable() { assertAvailable(); return config }}
    },
    async sync(worldBooks, cardPath) {
      return syncDialogueBubbleWorldbook(worldBooks, cardPath, await bubbles.read(cardPath))
    }
  }
  return {bubbles}
}
