// 全库搜索 for the casting assistant: every installed pack, not only a card's bound ones. The result is model context, so a
// name several figures share lists all of them (the model tells them apart); identity itself is the shared resolver's
// (resolveFigureName) — no alias table of its own.
import figureResolution from '../shared/figure-resolution.cjs'
import {check, text} from '../asset-packs/common.js'
import {figureEmotionRows} from '../asset-packs/figure-emotions.js'

const {normalizeCatalogueText, resolveFigureName, codepointCompare} = figureResolution
const SUMMARY = 300
const short = value => value && [...value].length > SUMMARY ? [...value].slice(0, SUMMARY).join('') + '…' : value
const includesAll = (texts, terms) => {
  const haystack = texts.filter(Boolean).map(normalizeCatalogueText).join('\n')
  return terms.every(term => haystack.includes(term))
}

// packs: installed pack snapshots ({manifest, figures, revision}); each row names its pack revision, which a copy's request\n// lists in its catalogueRevisions. Figures rank exact name/alias first, then a name/alias that
// contains every word, then any text (介绍, 使用情景, its voice's name and 使用场景, the pack name) that does; voices match
// their name, 使用场景 or pack name. `more` counts what the limit left out.
export function searchLibrary(packs, {query, limit = 20}) {
  text(query, '$.query', 200)
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, '$.limit')
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
      voice:voice ? {voiceId:figure.voice.voice, name:voice.name, ...(voice.guidance ? {guidance:voice.guidance} : {})} : null,
      // the automatic pack holds schema-1 figures; a figure of another image format cannot be copied into it
      copyable:(pack.manifest.schemaVersion ?? 1) === 1,
      match:['exact', 'name', 'text'][rank]}})
  }
  const voices = []
  for (const pack of packs) for (const [voiceId, voice] of Object.entries(pack.manifest.voiceLibrary?.voices || {})) {
    if (!includesAll([voice.name, voice.guidance, pack.manifest.name], terms)) continue
    const users = pack.manifest.figures.map(id => pack.figures[id]).filter(figure => figure.voice?.voice === voiceId).map(figure => figure.name)
    voices.push({packId:pack.manifest.id, packName:pack.manifest.name, revision:pack.revision, voiceId, name:voice.name, language:voice.language,
      ...(voice.guidance ? {guidance:voice.guidance} : {}), figures:users})
  }
  figures.sort((a, b) => a.rank - b.rank || codepointCompare(a.row.name, b.row.name) || codepointCompare(a.row.packName, b.row.packName))
  voices.sort((a, b) => codepointCompare(a.name, b.name) || codepointCompare(a.packName, b.packName))
  return {query, identity:identity.status === 'resolved' ? {status:'resolved', ref:identity.ref} : {status:identity.status},
    figures:figures.slice(0, limit).map(item => item.row), voices:voices.slice(0, limit),
    more:{figures:Math.max(0, figures.length - limit), voices:Math.max(0, voices.length - limit)}}
}
