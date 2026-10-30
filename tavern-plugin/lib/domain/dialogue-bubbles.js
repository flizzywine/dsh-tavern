import { promptSection } from './prompt-section.js'
import { prompt } from '../prompt-catalog.js'
import figureResolution from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'
const { figureSpeakerHandle } = figureResolution
// optional height fields never infer a height for legacy characters.
import { figureCharacter } from './figure-scale.js'
import { matchBubbleMood, figureBubbleMoods, bubbleCharacter, effectiveVoiceLanguage, voiceTranslates } from '../../src/client/bubble-line.cjs'
import { validateFigureEmotions } from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import { normalizeStageWidgetTuning } from '../../src/client/widget-contracts.cjs'
import { updateWorldBookDocument } from './worldbook-resource.js'
import { normalizeSpriteDialogue } from './layered-sprite-dialogue.js'
import { normalizeStageBudget } from './stage-incremental.js'
import { estimateDirectorTokens } from './stage-director-tokens.js'
// stage.theme accepts exactly the built-in skin registry's ids.
import skinContract from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
// per-card dialogue bubbles.
// The model writes each bubble as one marked line; the field forms live in PROMPT_PROSE;
// the client renders them as avatar bubbles. This module owns the per-card
// configuration (aliases, names, colors, avatars incl. mood variants), stored in
// profile data keyed by card path, and keeps the format rules as one ordinary
// constant entry in the card's bound world book, where the user can see and edit it.
import { createHash } from 'node:crypto'

const moods = [] // no implicit variant vocabulary
import { normalizeBubbleInjection } from './dialogue-bubble-presets.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  // roster lines begin with `handle|name`, the same fields in the same order as a marked line. One speaker per
  // line under its group's options: Opus 5.5 left the variant empty for speakers five or more names before a shared list.
  p001: "Each `Variants:` line gives the options for the speakers listed under it. Parentheses after a variant give guidance, not part of its value.\n",
  get p002() { return prompt('bubble-format') },
  p003: "- Words a person speaks or writes, in any medium, are spoken lines under that person's handle; narrate the surrounding actions. This includes a short reply, a remote or overheard speaker, a message or note being read, and words recalled from earlier. Give each quoted sentence its own marked line with the original speaker, so the name stays visible during a recap. An unnamed speaker takes a short description as name; bare quotes show no speaker.",
  p004: "- Inner thought: `@bubble:handle|name|variant|[*text*]`, e.g. `@bubble:ellie_hart|Ellie Hart|紧张|[*终于赶上了。*]`.",
  p005: "- Copy `handle|name` from the speaker roster as written, and choose one variant from that speaker's own `Variants:` line; leave it empty only when the line says none. For an unlisted speaker, use their name and an empty variant; make a handle from a lowercase name or romanization with underscores for spaces, reuse it, and add _2, _3 for collisions.",
  p006: "- Line rules: one sentence per marked line; no `|`, `[` or `]` within each bracketed text field, and no backticks around the line.",
  p007: "- Without variant options, leave variant empty: `@bubble:handle|name||[text]`.",
  p008: "- Narration and actions: plain prose, unmarked.",
  p009: "- Keep each character's voice: self-reference, sentence endings, verbal tics, tone and forms of address. For characters from existing works, follow how they speak in the original.",
  get p011() { return prompt('bubble-voice-format') },
  p021: "Speakers whose roster entry carries a voice language tag are voiced. Every bubble for one of these speakers, inner thoughts included, has two text fields: display text, then voice text in that speaker's voice language. Speakers without the tag keep the one-field forms above. The roster's current voice tags alone set the format; earlier one-field lines for a speaker in the story do not change it, so once a speaker is tagged, write both fields from now on.",
  p012: "- Inner thought with voice text: `@bubble:handle|name|variant|[*display text*]|[*voice text*]`, e.g. `@bubble:sora|高野空|喜悦|[*终于赶上了。*]|[*やっとまにあった。*]`. Asterisks wrap both fields.",
  p020: "- Voice direction (optional, voice text only): on key or emotionally complex lines, add short English cues in `{}` as a voice director would — tone, intent, pace, or sounds like {sighs} {small laugh} {shaky breath} {pause}. Place a cue before the words it shapes, and another where the emotion turns. Most lines need none. e.g. `…|[我没事。真的……]|[{forcing calm}大丈夫。{voice starting to shake}本当に……]`",
  p013: "- Voice text says what the display text says, as natural speech in the voice language.",
  p014: "- Keep the character's way of speaking in both fields: self-reference, sentence endings, verbal tics, tone and forms of address. For a character from an existing work, match how that character speaks in the original's voice-language version.",
  p015: "- Voice text feeds speech synthesis, so write it with no reading ambiguity. For Japanese, write personal names, place names and proper nouns in hiragana or katakana (ゆうき、さくら、しぶや、ポチ); rewrite kanji words with several or rare readings in kana (今日→きょう, 一日→ついたち/いちにち, 何→なに/なん, 上手→じょうず); spell numbers as read (三人→さんにん); use no romaji, bracketed readings or emoji. Common kanji with a single reading may stay.",
  p017: "Mark speech and inner thoughts as below; each marked line is shown as a speech bubble under its speaker's name. Use the marked form even when the opening or card examples use bare quotes, keeping their narrative person and voice inside it.\n",
  p018: " [Voice language: ",
  p019: "A `[Voice language: ...]` tag after the name gives the translation language.\n",
  // fixed examples (a mascot, a recap after narration, an unnamed overheard speaker) so speakers vary; bytes never
  // vary per turn. Only speakers without options leave the variant empty.
  p022: "@bubble:niangao|年糕||[喵～]\nYou reread Hinata's message.\n@bubble:hinata|桐谷ひなた|微笑|[明天见。]\nA voice whispers from the dark alley.\n@bubble:hooded_girl|兜帽少女||[别出声。]",
  p024: "Variants: ",
  p025: "none",
  p026: "These speakers joined after the speaker roster above was written; treat them as roster entries.\n",
  p023: "- Fields: handle identifies the speaker; name is their displayed name; variant selects the expression, mood or pose shown on stage; text is their words.",
})

export const BUBBLE_MOOD_GROUPS = moods
const MOOD_IDS = new Set(BUBBLE_MOOD_GROUPS.map(group => group.id))
export const CUSTOM_EMOTION_ID = /^[a-z][a-z0-9_-]{0,23}$/

export function normalizeBubbleEmotions(value) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('差分须为列表')
  const ids = new Set(MOOD_IDS)
  const labels = new Set(BUBBLE_MOOD_GROUPS.flatMap(group => [group.label, ...group.words.split(/\s+/)]))
  const foldedLabels = new Set([...labels].map(label => label.toLowerCase()))
  const emotions = value.map(raw => {
    const id = typeof raw?.id === 'string' ? raw.id : ''
    const label = typeof raw?.label === 'string' ? raw.label.trim() : ''
    const note = typeof raw?.note === 'string' ? raw.note.trim() : ''
    const foldedLabel = label.toLowerCase()
    if (!CUSTOM_EMOTION_ID.test(id) || ids.has(id) || foldedLabels.has(id)) throw new Error('差分 ID 无效、重复或与名称冲突')
    if (!label || [...label].length > 6 || /[|｜\[\]\r\n]/.test(label) || labels.has(label) || ids.has(foldedLabel)) throw new Error('差分名称须为 1–6 字，且不能与已有名称或 ID 重复')
    if ((raw.note != null && typeof raw.note !== 'string') || [...note].length > 60) throw new Error('差分提示最多 60 字')
    ids.add(id); labels.add(label); foldedLabels.add(foldedLabel)
    if (raw.words != null && typeof raw.words !== 'string') throw new Error('Emotion words must be a string')
    const words = (raw.words || '').trim().split(/\s+/).filter(Boolean)
    if (words.length > 16 || words.some(word => [...word].length > 24 || /[|｜\[\]]/.test(word))) throw new Error('Invalid emotion words')
    return { id, label, ...(words.length ? {words:[...new Set(words)].join(' ')} : {}), ...(note ? { note } : {}) }
  })
  // every label, ID and synonym has exactly one owner.
  const owners = new Map()
  for (const emotion of [...BUBBLE_MOOD_GROUPS, ...emotions]) {
    for (const word of [emotion.id, emotion.label, ...(emotion.words || '').split(/\s+/).filter(Boolean)]) {
      const key = word.toLowerCase()
      if (owners.has(key) && owners.get(key) !== emotion.id) throw new Error('Conflicting emotion word: ' + word)
      owners.set(key, emotion.id)
    }
  }
  return emotions
}

export function effectiveBubbleMoods(config, alias) {
  const base = [...BUBBLE_MOOD_GROUPS.map(({note, ...group}) => ({ ...group })),
    ...normalizeBubbleEmotions(config?.emotions).map(emotion => ({ ...emotion, color: '#888888' }))]
  // natural speaker aliases and ref keys share the browser identity resolver.
  return figureBubbleMoods(base, bubbleCharacter(config, alias)?.emotions)
}

// Historical detailed words remain aliases, even though new instructions use only labels.
export function resolveBubbleMood(value, config, alias) {
  return matchBubbleMood(value, effectiveBubbleMoods(config, alias))
}
const ALIAS = /^[a-z0-9_]{1,32}$/
const VOICE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const BACKEND_VOICE_ID = /^[a-z0-9][a-z0-9_-]{0,39}(?:\/[a-z0-9][a-z0-9_-]{0,39})?$/
const IMAGE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/
const MAX_IMAGE_CHARS = 400 * 1024

// Full-size portraits live as files beside the settings and are served by URL.
const FULL_URL = /^\/api\/dsh-tavern\/bubble-image\?card=[A-Za-z0-9_-]{24}&key=[a-z0-9_]{1,32}(@[a-z][a-z0-9_-]{0,23})?&v=\d{1,16}$/

function str(value, max = 200) { return (typeof value === 'string' ? value : '').trim().slice(0, max) }
const ASSET_IMAGE = /^(?:avatars\/[A-Za-z0-9_@.-]+\.(?:webp|png|jpeg)|\/api\/dsh-tavern\/card-assets\/[a-z0-9][a-z0-9_-]{0,63}\/avatars\/[A-Za-z0-9_@.%~-]+\.(?:webp|png|jpeg)\?v=[A-Za-z0-9-]+)$/
function image(value) { return typeof value === 'string' && ((value.length <= MAX_IMAGE_CHARS && IMAGE.test(value)) || ASSET_IMAGE.test(value)) ? value : '' }
function fullUrl(value) { return typeof value === 'string' && (FULL_URL.test(value) || ASSET_IMAGE.test(value)) ? value : '' }
function cardKey(cardPath) { return createHash('sha256').update(String(cardPath || '')).digest('hex').slice(0, 24) }

export function normalizeBubbleConfig(value) {
  const input = value && typeof value === 'object' ? value : {}
  const emotions = normalizeBubbleEmotions(input.emotions)
  const effectiveMoods = effectiveBubbleMoods({ emotions })
  const seen = new Set()
  const characters = []
  // Pack catalogues can exceed the retired card-local editor's 60-character limit.
  for (const raw of Array.isArray(input.characters) ? input.characters : []) {
    const alias = str(raw && raw.alias, 32).toLowerCase()
    if (!ALIAS.test(alias) || seen.has(alias)) continue
    seen.add(alias)
    // sparse figure rows survive normalization, including an empty guidance field.
    const figureEmotions = structuredClone(validateFigureEmotions(raw.emotions || []))
    const moodIds = new Set(figureBubbleMoods(effectiveMoods, figureEmotions).map(group => group.id))
    const moods = {}
    for (const [key, data] of Object.entries(raw.moods && typeof raw.moods === 'object' ? raw.moods : {})) {
      if (moodIds.has(key) && image(data)) moods[key] = image(data)
    }
    const full = {}
    for (const [key, url] of Object.entries(raw.full && typeof raw.full === 'object' ? raw.full : {})) {
      if ((key === 'default' || moodIds.has(key)) && fullUrl(url)) full[key] = url
    }
    characters.push({
      alias,
      ...(raw.ref ? {ref:structuredClone(raw.ref),aliases:structuredClone(raw.aliases || []),recall:structuredClone(raw.recall)} : {}),
      ...figureCharacter(raw),
      appearance: ['live2d', 'sprite', 'avatar'].includes(raw.appearance) ? raw.appearance : 'live2d',
      emotions: figureEmotions,
      ...(Array.isArray(raw.promptEmotionIds) ? {promptEmotionIds:[...raw.promptEmotionIds]} : {}),
      name: str(raw.name, 40),
      ...(raw.ref && raw.description ? {description:str(raw.description, 1000)} : {}),
      // Any well-formed voice-library ID is kept, even if that voice is offline or retired:
      // the binding must survive until the user changes it.
      voice: BACKEND_VOICE_ID.test(str(raw.voice, 82)) ? str(raw.voice, 82) : '',
      // the figure's voice language (binding.language || voice.language) as its primary tag; any language a
      // voice can speak (ko / yue / de …) survives, so injection and TTS read the same value; unset is 中文 (bubble-line.cjs).
      voiceLang: voicePrimaryLanguage(effectiveVoiceLanguage(raw.voiceLang)) || 'zh',
      ...(raw.voiceDirection ? {voiceDirection:true} : {}),
      // Portrait-library (Live2D) model bound for the galgame stage; kept even if the model is missing.
      portrait: VOICE_ID.test(str(raw.portrait, 40)) ? str(raw.portrait, 40) : '',
      outfitLabel: str(raw.outfitLabel, 12),
      // Extra outfits (label → portrait model); the stage director picks one per scene, portrait is the default.
      outfits: (Array.isArray(raw.outfits) ? raw.outfits : []).map(item => ({ label: str(item && item.label, 12), model: str(item && item.model, 40) }))
        .filter((item, index, list) => item.label && VOICE_ID.test(item.model) && list.findIndex(other => other.label === item.label) === index).slice(0, 12),
      color: /^#[0-9a-f]{6}$/i.test(str(raw.color, 7)) ? str(raw.color, 7).toLowerCase() : '',
      avatar: image(raw.avatar),
      moods,
      full
    })
  }
  // Galgame stage: which background tag groups this card uses and its default background.
  const stage = input.stage && typeof input.stage === 'object' ? input.stage : {}
  const directorModel = stage.directorModel && typeof stage.directorModel === 'object' && str(stage.directorModel.provider, 200) && str(stage.directorModel.model, 200)
    ? { provider: str(stage.directorModel.provider, 200), model: str(stage.directorModel.model, 200) } : null
  return { version: 1, ...(typeof input.pack?.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.pack.id) ? { pack: { id: input.pack.id } } : {}), enabled: input.enabled === true, characters, emotions, moods: effectiveMoods, injection: normalizeBubbleInjection(input.injection), voice: input.voice == null ? null : { enabled: input.voice.enabled === true },
    stage: { director: stage.director === true, directorModel, directorBudget: normalizeStageBudget(stage.directorBudget), music: stage.music === true, widgets: stage.widgets === true, widgetTuning: normalizeStageWidgetTuning(stage.widgetTuning), theme: Object.hasOwn(skinContract.BUILTIN_STAGE_SKINS, stage.theme) ? stage.theme : 'classic', directorPrompt: str(stage.directorPrompt, 4000).trim(),
      face: ['always', 'offstage', 'off'].includes(stage.face) ? stage.face : 'always', background: /^[a-z0-9][a-z0-9_-]{0,39}$/.test(str(stage.background, 40)) ? str(stage.background, 40) : '' } }
}

const LANGUAGE_NAMES = new Proxy(Object.freeze({ zh: '中文', ja: '日语', en: '英语', ko: '韩语', yue: '粤语' }), {
  get: (names, tag) => typeof tag !== 'string' ? undefined : names[tag] || languageDisplayName(tag)
})
function voicePrimaryLanguage(tag) {
  const primary = typeof tag === 'string' ? tag.split('-')[0].toLowerCase() : ''
  return /^[a-z]{2,3}$/.test(primary) ? primary : ''
}
function languageDisplayName(tag, locale = 'zh-CN') {
  try { return new Intl.DisplayNames([locale], {type:'language'}).of(tag) || tag } catch { return tag }
}

// The character owns the language. Capabilities only validate it or supply a legacy default.
export function resolveBubbleVoiceConfig(config, voices = []) {
  const current = normalizeBubbleConfig(config)
  const voiceWarnings = []
  for (const character of current.characters) {
    if (!character.voice) continue
    const voice = voices.find(item => item.id === character.voice)
    const languages = voice?.languages?.length ? voice.languages : ['ja', 'zh', 'en']
    const requested = config?.characters?.find(item => item.alias === character.alias)?.voiceLang
    if (requested && !languages.includes(requested)) voiceWarnings.push('角色 ' + character.alias + ' 的配音语言不受该声音支持，已回退为' + LANGUAGE_NAMES[languages[0]])
    character.voiceLang = languages.includes(requested) ? requested : languages[0]
  }
  const spriteDialogue = normalizeSpriteDialogue(current, config?.spriteDialogue)
  return { ...current, ...(spriteDialogue.length ? { spriteDialogue } : {}), ...(voiceWarnings.length ? { voiceWarnings } : {}) }
}

export const BUBBLE_WORLDBOOK_COMMENT = '格式要求（由「对话气泡」设置维护）'
// Earlier entry names; an unmarked entry with one of them is still ours, and sync renames it.
export const LEGACY_BUBBLE_WORLDBOOK_COMMENTS = Object.freeze(['对白格式（由「对话气泡」设置维护）', '对话气泡格式（由「对话气泡」设置维护）', '说话人名单'])

export function bubbleInstruction(config, options = {}) {
  return bubbleInstructionPreview(config, options).instruction
}

// one constant roster groups identical variant sets; only prompt identities use short handles.
// The worldbook sync and prompt view consume the same rendering.
export function bubbleFigureEntries(config, options = {}) {
  const current = options.voices ? resolveBubbleVoiceConfig(config, options.voices) : normalizeBubbleConfig(config)
  return figureEmotionEntries(current, options.speakerRows)
}
function figureEmotionEntries(current, speakerRows = current.characters, characters = current.characters) {
  if (!current.enabled) return []
  const roster = rosterGroups(current, speakerRows, characters)
  if (!roster.lines.length) return []
  return [{figure:'common-roster', packIds:roster.packIds, name:'说话人名单', comment:'说话人名单',
    content:promptSection('speaker_roster', PROMPT_PROSE.p001 + (roster.hasTranslation ? PROMPT_PROSE.p019 : '') + roster.lines.join('\n')), constant:true, primaryKeys:[]}]
}
// a figure recalled after the roster froze reaches the per-turn tail in the
// roster's own line format; voice rules come along only when the frozen prefix carries none.
export function bubbleRosterAddendum(config, {speakerRows, aliases, frozenAliases}) {
  const current = normalizeBubbleConfig(config)
  const characters = current.characters.filter(row => aliases.has(row.alias))
  const frozenCharacters = current.characters.filter(row => frozenAliases.has(row.alias))
  const roster = rosterGroups(current, speakerRows, characters)
  if (!current.enabled || !roster.lines.length) return ''
  // Explanations the frozen roster already carries are not repeated.
  const frozen = rosterGroups(current, speakerRows, frozenCharacters)
  const voiced = frozenCharacters.some(character => Object.values(bubbleVoiceSwitches(current, character)).some(Boolean))
  return promptSection('speaker_roster_addendum', [
    PROMPT_PROSE.p026 + (frozen.lines.length ? '' : PROMPT_PROSE.p001) + (roster.hasTranslation && !frozen.hasTranslation ? PROMPT_PROSE.p019 : '') + roster.lines.join('\n'),
    voiced ? '' : voicedBubblesSection(current, characters)
  ].filter(Boolean).join('\n'))
}
function voicedBubblesSection(current, characters) {
  const translated = characters.some(character => bubbleVoiceSwitches(current, character).voiceTranslates)
  const voiceDirection = characters.some(character => bubbleVoiceSwitches(current, character).voiceDirection)
  return promptSection('voiced_bubbles', (translated ? [
      PROMPT_PROSE.p021,
      PROMPT_PROSE.p011,
      PROMPT_PROSE.p012,
      ...(voiceDirection ? [PROMPT_PROSE.p020] : []),
      PROMPT_PROSE.p013,
      PROMPT_PROSE.p014,
      PROMPT_PROSE.p015
    ] : voiceDirection ? [PROMPT_PROSE.p020] : []).join('\n'))
}
function rosterGroups(current, speakerRows, characters) {
  const groups = new Map(), packIds = []
  let hasTranslation = false
  for (const character of characters) {
    const translated = bubbleVoiceSwitches(current, character).voiceTranslates
    if (translated) hasTranslation = true
    const name = figureSpeakerHandle(speakerRows, character) + '|' + (character.name || character.alias)
      + (translated ? PROMPT_PROSE.p018 + languageDisplayName(character.voiceLang, 'en') + ']' : '')
    const rows = effectiveBubbleMoods(current, character.alias)
      .filter(row => !character.promptEmotionIds || character.promptEmotionIds.includes(row.id))

    // the migration's exact stock sentence is not authored guidance.
    const variants = rows.map(row => {
      const note = row.guidance?.trim() || row.note?.trim() || ''
      return {label:row.label, note:['用于' + row.label + '的表情或动作。', '用于' + row.label + '的动作。'].includes(note) ? '' : note}
    })
    const key = JSON.stringify(variants.map(row => row.label))
    if (!groups.has(key)) groups.set(key, {names:[], lines:[], variants, guidance:new Map()})
    const group = groups.get(key)
    group.names.push(name)
    group.lines.push('- ' + name + (character.description ? ' — ' + character.description : ''))
    for (const row of variants) if (row.note) {
      if (!group.guidance.has(row.label)) group.guidance.set(row.label, new Map())
      const notes = group.guidance.get(row.label)
      if (!notes.has(row.note)) notes.set(row.note, [])
      notes.get(row.note).push(name)
    }
    if (character.ref && !packIds.includes(character.ref.packId)) packIds.push(character.ref.packId)
  }
  // each group opens with its options, then one speaker line per figure (description after an em dash).
  const lines = [...groups.values()].map(group => PROMPT_PROSE.p024 + (group.variants.length ? group.variants.map(row => {
    const notes = [...(group.guidance.get(row.label) || [])].map(([note, names]) =>
      names.length === group.names.length ? note : names.join('、') + '：' + note)
    return row.label + (notes.length ? '（' + notes.join('；') + '）' : '')
  }).join('、') : PROMPT_PROSE.p025) + '\n' + group.lines.join('\n'))
  return {lines, packIds, hasTranslation}
}
// exactly what the story model receives from these settings — the synced worldbook entries in
// order (dialogue format followed by its roster in one entry), with the director's local token estimate so both
// stages compare. `{{user}}` is shown as this chat's player name; nothing when bubbles are off.
export function bubbleInjection(config, options = {}) {
  if (!normalizeBubbleConfig(config).enabled) return []
  const preview = bubbleInstructionPreview(config, {...options, table:false}), text = preview.instruction
  const voice = preview.sections.find(section => section.key === 'voice')?.text || ''
  const roster = bubbleFigureEntries(config, options)[0]
  const content = [text, roster?.content].filter(Boolean).join('\n')
  return [{key:'format', name:BUBBLE_WORLDBOOK_COMMENT, constant:true, text:content,
    ...(roster ? {packs:roster.packIds} : {}), tokens:estimateDirectorTokens(content),
    ...(voice ? {voice:{tokens:estimateDirectorTokens(voice)}} : {})}]
}

export function bubbleVoiceSwitches(config, character) {
  const enabled = Boolean(config.voice?.enabled && character?.voice)
  return {voiceTranslates:enabled && voiceTranslates(character.voiceLang), voiceDirection:enabled && Boolean(character.voiceDirection)}
}

// Preview and injection share the same generated blocks; custom templates retain bubble_format's voice rules.
export function bubbleInstructionPreview(config, options = {}) {
  const current = options.voices ? resolveBubbleVoiceConfig(config, options.voices) : normalizeBubbleConfig(config)
  const translated = current.characters.filter(character => bubbleVoiceSwitches(current, character).voiceTranslates)
  const roster = options.table === false ? '' : figureEmotionEntries(current, options.speakerRows)[0]?.content || ''
  // forms, then field meanings, then rules; multi-line examples close the base format in <examples>.
  const format = [
    PROMPT_PROSE.p008,
    PROMPT_PROSE.p002,
    PROMPT_PROSE.p004,
    PROMPT_PROSE.p023,
    PROMPT_PROSE.p005,
    PROMPT_PROSE.p003,
    PROMPT_PROSE.p006,
    ...(current.characters.some(row=>row.emotions?.length===1 && row.emotions[0].label===undefined) ? [PROMPT_PROSE.p007] : []),
    ...(translated.length ? [] : [PROMPT_PROSE.p009]),
    promptSection('examples', PROMPT_PROSE.p022)
  ].join('\n')
  // Voice languages belong to the shared roster, including separately injected figures.
  const voice = voicedBubblesSection(current, current.characters)
  const userName = str(options.userName, 80) || '你'
  const replacements = {
    bubble_format: [format, voice].filter(Boolean).join('\n'),
    bubble_player: '',
    user: userName,
    // visual variants belong to presentation, never to the writer's emotion vocabulary.
    bubble_emotions: '', // the merged figure section owns this generated guidance.
    bubble_characters: roster
  }
  const sections = [
    { key: 'format', title: '格式规则', text: PROMPT_PROSE.p017 + format },
    { key: 'voice', title: '配音规则', text: voice },
    { key: 'emotions', title: '差分', text: replacements.bubble_emotions },
    { key: 'characters', title: '角色表', text: replacements.bubble_characters },
    { key: 'extra', title: '补充要求', text: current.injection.extra }
  ]
  const custom = current.injection.template
  const segments = custom ? [
    { key: 'custom', title: '自定义模板', text: custom.replace(/^[\t ]*\{\{bubble_emotions\}\}[\t ]*\r?\n/gm, '').replace(/\{\{(bubble_format|bubble_emotions|bubble_characters|bubble_player|user)\}\}/g, (_, key) => replacements[key]).replace(/(?:\r?\n[\t ]*)+$/, '') },
    sections.at(-1)
  ].filter(section => section.text) : sections.filter(section => section.text)
  return { instruction: current.enabled ? promptSection('dialogue_format', segments.map(section => section.text).join('\n')) : '', sections, segments: current.enabled ? segments : [] }

}

export function normalizeVoicePrefs(input) {
  return { version: 1, enabled: input && typeof input.enabled === 'boolean' ? input.enabled : null }
}

function bubbleBookKey(source, cardPath) {
  return source.kind === 'card' ? (source.cardPath === cardPath ? 'card' : 'card:' + source.cardPath) : 'standalone:' + source.path
}
function entryPlacement(entry) {
  return { position: entry.position === 'before_char' ? 0 : entry.position === 'after_char' ? 1 : Number(entry.position), depth: entry.depth ?? 4, role: entry.role ?? 0, order: entry.order ?? 100 }
}
async function bubbleBooks(worldBooks, cardPath) {
  const binding = await worldBooks.binding(cardPath)
  const books = binding.kind === 'multiple' ? (binding.books || []) : binding.source ? [binding] : []
  if (books.some(book => book.available === false)) throw new Error('绑定的世界书不可用，未保存设置；请恢复绑定后重试')
  const sources = books.length ? books.map(book => book.source) : [{ kind: 'card', cardPath }]
  return Promise.all([...new Map(sources.map(source => [bubbleBookKey(source, cardPath), source])).values()].map(async source => ({ source, record: await worldBooks.get(source) })))
}
export async function readDialogueBubblePlacement(worldBooks, cardPath, applied = {}) {
  const records = await bubbleBooks(worldBooks, cardPath)
  const books = records.map(({ source, record }) => ({ key: bubbleBookKey(source, cardPath), name: record.view.displayName || '本卡世界书', source }))
  // every enabled dialogue-bubble entry the bound books hold — this card's and ones another
  // card left behind (own:false, e.g. after the card was copied) — since the story model receives all of them.
  const entries = records.flatMap(({ source, record }) => (record.view.entries || []).flatMap(entry => {
    const owner = entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles
    return owner?.version === 1 && entry.enabled !== false ? [{ book: bubbleBookKey(source, cardPath), bookName: record.view.displayName || '本卡世界书', comment: str(entry.comment, 200), text: String(entry.content || ''),
      constant: entry.constant === true, own: owner.cardKey === cardKey(cardPath), ...(owner.figure ? { figure: owner.figure } : {}) }] : []
  }))
  for (const { source, record } of records) {
    const entry = record.view.entries.find(entry => {
      const owner = entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles
      return owner?.version === 1 && owner.cardKey === cardKey(cardPath)
    })
    if (!entry) continue
    const current = { book: bubbleBookKey(source, cardPath), name: record.view.displayName, ...entryPlacement(entry) }
    return { books, current, manual: Object.entries(applied).some(([key, value]) => current[key] !== value), entries }
  }
  return { books, current: null, manual: false, entries }
}

// Only inspect currently bound books. Exact legacy entries in shared books are
// ambiguous: without ownership metadata we must not claim another card's rule.
export async function syncDialogueBubbleWorldbook(worldBooks, cardPath, config) {
  const current = normalizeBubbleConfig(config)
  const key = cardKey(cardPath)
  const records = await bubbleBooks(worldBooks, cardPath)
  const placement = current.injection.placement || {}
  const destination = placement.book === undefined ? null : records.find(book => bubbleBookKey(book.source, cardPath) === placement.book)
  if (placement.book !== undefined && !destination) throw new Error('目标世界书不在本卡绑定列表中，未修改条目')
  const patch = Object.fromEntries(Object.entries(placement).filter(([key]) => key !== 'book'))
  const owned = [], legacy = [], figureEntries = []
  for (const book of records) {
    for (const entry of book.record?.view?.entries || []) {
      const extra = entry.rawEntry?.extensions?.dsh_tavern_helper_extra || {}
      const owner = extra.forkDialogueBubbles
      if (owner) { if (owner.version === 1 && owner.cardKey === key) (owner.figure ? figureEntries : owned).push({ ...book, entry, extra }); continue }
      if (entry.comment === BUBBLE_WORLDBOOK_COMMENT || LEGACY_BUBBLE_WORLDBOOK_COMMENTS.includes(entry.comment)) legacy.push({ ...book, entry, extra })
    }
  }
  if (legacy.some(item => item.source.kind !== 'card' || item.source.cardPath !== cardPath)) {
    throw new Error('旧版气泡格式条目归属不明确，请在世界书库确认归属后重试；未修改条目')
  }
  const matches = [...owned, ...legacy]
  const keeper = matches[0]
  const moving = keeper && destination && bubbleBookKey(keeper.source, cardPath) !== bubbleBookKey(destination.source, cardPath)
  const plans = new Map(records.map(book => [book, []]))
  function plan(item, op) { const book = records.find(book => book.record === item.record); plans.get(book).push(op) }
  let removed = 0, updated = 0
  for (const item of matches) {
    if (!current.enabled || item !== keeper || moving) { plan(item, { op: 'delete', ref: item.entry.ref }); removed++ }
  }
  if (current.enabled) {
    // Worldbooks are shared across chats; the runtime projection resolves this macro per chat.
    // The same entry feeds both stored worldbooks and foreground capability snapshots.
    const content = bubbleInjection(config, { userName: '{{user}}' })[0].text
    const helperExtra = { ...(keeper?.extra || {}), forkDialogueBubbles: { version: 1, cardKey: key } }
    if (keeper && !moving) {
      if (keeper.entry.content !== content || keeper.entry.comment !== BUBBLE_WORLDBOOK_COMMENT || !keeper.entry.enabled || !keeper.entry.constant || !keeper.extra.forkDialogueBubbles || Object.entries(patch).some(([key, value]) => entryPlacement(keeper.entry)[key] !== value)) {
        plan(keeper, { op: 'update', ref: keeper.entry.ref, patch: { comment: BUBBLE_WORLDBOOK_COMMENT, content, enabled: true, constant: true, helperExtra, ...patch } }); updated++
      }
    } else {
      plans.get(destination || records[0]).push({ op: 'add', entry: { ...(moving ? keeper.entry : {}), comment: BUBBLE_WORLDBOOK_COMMENT, content, enabled: true, constant: true, primaryKeys: [], order: 100, ...(moving ? entryPlacement(keeper.entry) : {}), helperExtra, ...patch } }); updated++
    }
  }
  for (const item of figureEntries) {plan(item,{op:'delete',ref:item.entry.ref});removed++}
  // Snapshot both books before a move; roll back every attempted write on failure.
  const snapshots = new Map()
  if (moving) {
    if (!worldBooks.export || !worldBooks.replaceNative) throw new Error('世界书接口不支持安全移动，未修改条目')
    for (const [book, operations] of plans) if (operations.length) snapshots.set(book, (await worldBooks.export(book.source)).document)
  }
  const attempted = []
  let completed = 0
  try {
    for (const [book, operations] of plans) if (operations.length) {
      attempted.push(book)
      if (moving) {
        const nativeOperations = operations.map(operation => operation.ref && book.source.kind === 'card'
          ? { ...operation, ref: 'entry:' + book.record.view.entries.find(entry => entry.ref === operation.ref).sourceUid } : operation)
        let document = updateWorldBookDocument(snapshots.get(book), { operations: nativeOperations }).document
        if (book === destination && current.enabled) {
          const origin = records.find(book => book.record === keeper.record)
          const raw = Object.values(snapshots.get(origin).entries).find(entry => entry.uid === Number(keeper.entry.sourceUid))
          const added = Object.values(document.entries).find(entry => entry.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles?.cardKey === key)
          if (!raw || !added) throw new Error('移动条目快照不完整')
          document.entries[String(added.uid)] = { ...raw, uid: added.uid, extensions: { ...raw.extensions, ...added.extensions } }
          document = updateWorldBookDocument(document, { operations: [{ op: 'update', ref: 'entry:' + added.uid, patch: operations.find(op => op.op === 'add').entry }] }).document
        }
        await worldBooks.replaceNative(book.source, document)
      } else await worldBooks.update(book.record.source || book.source, { operations })
      completed++
    }
  } catch (error) {
    if (moving) {
      const failures = []
      for (const book of attempted.reverse()) {
        try { await worldBooks.replaceNative(book.source, snapshots.get(book)) } catch (rollback) { failures.push(rollback.message) }
      }
      throw new Error((failures.length ? '移动失败且回滚失败：' + failures.join('；') : '移动失败，已回滚世界书') + '；' + error.message)
    }
    throw new Error((completed ? '部分世界书已更新，设置未保存；请重试：' : '世界书更新失败，设置未保存；请重试：') + error.message)
  }
  const target = destination || keeper || records[0]
  return { source: target.record.source || target.source, name: target.record?.view?.displayName || '', changed: Boolean(removed || updated), removed, updated }
}
