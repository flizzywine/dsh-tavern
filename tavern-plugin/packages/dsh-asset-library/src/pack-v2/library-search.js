// 全库搜索 for the casting assistant: every installed pack, not only a card's bound ones. The result is model context, so a
// name several figures share lists all of them (the model tells them apart); identity itself is the shared resolver's
// (resolveFigureName) — no alias table of its own.
import figureResolution from '../shared/figure-resolution.cjs'
import {check, text} from '../asset-packs/common.js'
import {figureEmotionRows} from '../asset-packs/figure-emotions.js'
import voiceAutoCastRule from '../shared/voice-auto-cast.cjs'

const {voiceAutoCast, castLanguage, castVoiceOrder} = voiceAutoCastRule

const {normalizeCatalogueText, resolveFigureName, codepointCompare} = figureResolution
const SUMMARY = 300
const short = value => value && [...value].length > SUMMARY ? [...value].slice(0, SUMMARY).join('') + '…' : value
const includesAll = (texts, terms) => {
  const haystack = texts.filter(Boolean).map(normalizeCatalogueText).join('\n')
  return terms.every(term => haystack.includes(term))
}

// packs: installed pack snapshots ({manifest, figures, revision}); each row names its pack revision, which a copy's request\n// lists in its catalogueRevisions. Figures rank exact name/alias first, then a name/alias that
// contains every word, then any text (介绍, 使用情景, its voice's name and 使用场景, the pack name) that does; voices match
// their name, 使用场景 or pack name and are only the 通用声音 (voiceRows; `systemPacks`: the packs 通用声音 / 旁白 point at).
// `more` counts what the limit left out.
export function searchLibrary(packs, {query, limit = 20, systemPacks = []}) {
  text(query, '$.query', 200)
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, '$.limit')
  checkPackIds(systemPacks)
  const needle = normalizeCatalogueText(query), terms = needle.split(' ').filter(Boolean)
  check(terms.length > 0, '$.query', 'Query required')
  const entries = packs.flatMap(pack => pack.manifest.figures.map(figureId => ({pack, figure:pack.figures[figureId], ref:{packId:pack.manifest.id, figureId}})))
  const identity = resolveFigureName(entries.map(({figure, ref}) => ({ref, name:figure.name, aliases:figure.aliases || []})), query)
  const voiceOf = (pack, id) => id === undefined ? null : pack.manifest.voiceLibrary?.voices[id] || null
  const figures = []
  for (const {pack, figure, ref} of entries) {
    const names = [figure.name, ...(figure.aliases || [])]
    const voice = voiceOf(pack, figure.voice?.voice)
    const rank = names.some(name => normalizeCatalogueText(name) === needle) ? 0 : includesAll(names, terms) ? 1
      : includesAll([...names, figure.description, figure.guidance, voice?.name, voice?.guidance, pack.manifest.name], terms) ? 2 : -1
    if (rank < 0) continue
    const outfits = figure.outfits.filter(outfit => outfit.enabled)
    figures.push({rank, row:{packId:ref.packId, packName:pack.manifest.name, revision:pack.revision, ref, name:figure.name, aliases:figure.aliases || [],
      ...(figure.description ? {description:short(figure.description)} : {}), ...(figure.guidance ? {guidance:short(figure.guidance)} : {}),
      outfits:outfits.length, emotions:figureEmotionRows(figure).length,
      stage:figure.enabled && outfits.some(outfit => outfit.sprite || outfit.live2d || outfit.spine),
      voice:voice ? {voiceId:figure.voice.voice, name:voice.name, language:castLanguage(figure.voice.language || voice.language), ...(voice.guidance ? {guidance:voice.guidance} : {})} : null,
      // the automatic pack holds schema-1 figures; a figure of another image format cannot be copied into it
      copyable:(pack.manifest.schemaVersion ?? 1) === 1,
      match:['exact', 'name', 'text'][rank]}})
  }
  const voices = voiceRows(packs, systemPacks, (voice, pack) => includesAll([voice.name, voice.guidance, pack.manifest.name], terms))
  figures.sort((a, b) => a.rank - b.rank || codepointCompare(a.row.name, b.row.name) || codepointCompare(a.row.packName, b.row.packName))
  return {query, identity:identity.status === 'resolved' ? {status:'resolved', ref:identity.ref} : {status:identity.status},
    figures:figures.slice(0, limit).map(item => item.row), voices:voices.slice(0, limit),
    more:{figures:Math.max(0, figures.length - limit), voices:Math.max(0, voices.length - limit)}}
}
// The audible voice, independent of its pack, display name, language and synthesis model.
export function castingVoiceKey(voice, binding) {
  if (!voice || binding?.source === null) return null
  const source = voice.sources[binding?.source ?? voice.defaultSource]
  if (!source) return null
  const identity = source.kind === 'voice-id' ? source.voiceId : source.kind === 'preset' ? source.voiceName
    : source.references.length ? [...new Set(source.references.map(clip => clip.media))].sort() : null
  return identity ? JSON.stringify([source.provider, source.kind, identity]) : null
}

// Shared eligibility for voice search and the full casting catalogue, in the 通用声音 order (castVoiceOrder). language: the
// voice's (castLanguage); fallback: a voice of a pack 通用声音 / 旁白 point at, its language's 默认通用声音, which any number
// of new speakers of that language may share when no other voice of it is free.
const checkPackIds = ids => check(Array.isArray(ids) && ids.length <= 8 && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 80), '$.systemPacks')
function voiceRows(packs, systemPacks, keep) {
  const voices = []
  for (const pack of packs) for (const [voiceId, voice] of Object.entries(pack.manifest.voiceLibrary?.voices || {})) {
    if (!voiceAutoCast(voice, pack.manifest.id, systemPacks) || !keep(voice, pack)) continue
    const sound = castingVoiceKey(voice)
    if (!sound) continue
    const users = pack.manifest.figures.map(id => pack.figures[id]).filter(figure => figure.voice?.voice === voiceId).map(figure => figure.name)
    voices.push({packId:pack.manifest.id, packName:pack.manifest.name, revision:pack.revision, voiceId, name:voice.name, language:castLanguage(voice.language), sound,
      ...(systemPacks.includes(pack.manifest.id) ? {fallback:true} : {}),
      ...(voice.guidance ? {guidance:voice.guidance} : {}), figures:users})
  }
  return voices.sort(castVoiceOrder)
}
// 全库通用声音: every installed pack's 通用声音 (the casting assistant reads them all instead of guessing keywords), or only
// those speaking `language` (a primary subtag: a speaker is cast only with voices of its own language); `more` counts what
// the limit left out.
export function listLibraryVoices(packs, {limit = 60, systemPacks = [], language} = {}) {
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= 200, '$.limit')
  checkPackIds(systemPacks)
  check(language === undefined || typeof language === 'string' && /^[a-z]{2,3}$/.test(language), '$.language')
  // A copy can add a different language or usage description; show it once per language, preferring a 默认通用声音, then a
  // described entry.
  const rank = row => (row.fallback ? 2 : 0) + (row.guidance ? 1 : 0), distinct = new Map()
  for (const row of voiceRows(packs, systemPacks, voice => language === undefined || castLanguage(voice.language) === language)) {
    const key = JSON.stringify([row.sound, row.language])
    if (!distinct.has(key) || rank(row) > rank(distinct.get(key))) distinct.set(key, row)
  }
  const voices = [...distinct.values()]
  return {voices:voices.slice(0, limit), more:Math.max(0, voices.length - limit)}
}