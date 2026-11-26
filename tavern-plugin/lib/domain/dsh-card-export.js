import {stat} from 'node:fs/promises'
import {writePackZip as writeZip, compressExportPacks} from '../../packages/dsh-asset-library/lib/pack-v2/service.js'
import {stripPngTextChunks} from './file-resources.js'
import {coverImageAsPng} from './card-cover-image.js'
import {withoutPlayerChoices} from './card-export-settings.js'
import {projectDshCard, packArchiveEntries} from './dsh-card-export-projection.js'
import {exportStageDeclaration} from '../../packages/dsh-presentation-protocol/src/card-stage-export.js'
import {MAX_CARD_JSON_BYTES} from './card-assets.js'
import {publishCardZip} from './zip-file.js'

// dependencies: bound packs the archive does not carry (withCardExport); the card keeps those bindings.
// compress ({directory}): 压缩素材 — the packs go out with smaller media (compressExportPacks, written under directory),
// reported to onProgress as {stage: 'compress', done, total, pack} before the archive is written; the result carries
// `compressed` (before and after bytes of the packs).
// update ({version, files: Set of sha256, converted}, optional): an update package on top of an earlier release — the pack
// files that release already had (by content) stay out, the card and every pack manifest and figure document go in, and
// dsh.json says what it builds on (formatVersion 2, `base`); `converted` reuses that release's compressed media.
// The result's `release` is what this export holds: {packs: [{id, title, contentHash, files: [sha256]}], converted}.
export async function exportDshCardSnapshot({card, packs = [], excludeFigures = [], dependencies = [], compress, update, ...options}) {
  let projected = await projectDshCard(card, packs, excludeFigures), compressed, converted = {}
  if (compress) {
    const result = await compressExportPacks(projected.packs, {directory:compress.directory, reuse:update?.converted, onProgress:options.onProgress && (progress => options.onProgress({stage:'compress', ...progress}))})
    projected = {card:result.rewrite(projected.card), packs:result.packs}
    compressed = result.summary; converted = result.converted
  }
  const sent = update ? updateEntries(projected.packs, update.files) : {entries:projected.packs.flatMap(packArchiveEntries), omitted:0}
  const embedded = new Set(projected.packs.map(({manifest}) => manifest.id))
  const referenced = new Set()
  const visit = value => { if (typeof value === 'string' && value.startsWith('embeded://')) referenced.add(value.slice(10)); else if (value && typeof value === 'object') Object.values(value).forEach(visit) }
  visit(projected.card)
  const entries = (options.entries || []).filter(entry => !entry.path.startsWith('assets/') || referenced.has(entry.path))
  const written = await writeDshCard({...options, card:projected.card,
    packs:projected.packs.map(({manifest}) => ({id:manifest.id, path:'assets/' + manifest.id + '/', format:manifest.format, contentHash:manifest.contentHash, title:manifest.name || manifest.title || '', credits:(manifest.credits || []).map(file => 'assets/' + manifest.id + '/' + file)})),
    dependencies:dependencies.filter(dependency => !embedded.has(dependency.id)),
    ...(sent.omitted ? {base:{version:update.version}} : {}),
    entries:[...entries, ...sent.entries]})
  const release = {packs:projected.packs.map(({manifest}) => ({id:manifest.id, title:manifest.name || manifest.title || '', contentHash:manifest.contentHash, files:manifest.files.map(file => file.sha256)})), converted}
  return {...written, release, omitted:sent.omitted, ...(compressed ? {compressed} : {})}
}

// The archive entries of an update package: a pack file the base release already had (same content) is left out, except
// the documents the importer reads from the archive itself (the manifest, which is always written, and figure documents).
function updateEntries(packs, files) {
  let omitted = 0
  const entries = packs.flatMap(pack => {
    const prefix = 'assets/' + pack.manifest.id + '/', hashes = new Map(pack.manifest.files.map(file => [file.path, file.sha256]))
    return packArchiveEntries(pack).filter(entry => {
      const relative = entry.path.slice(prefix.length)
      const keep = relative === 'manifest.json' || /^figures\/[^/]+\.json$/.test(relative) || !files.has(hashes.get(relative))
      if (!keep) omitted++
      return keep
    })
  })
  return {entries, omitted}
}

// writeZip's running byte count as {done, total, pack}: the entry the count is in names its pack (assets/<pack id>/).
async function archiveProgress(entries, packs, onProgress) {
  const titles = new Map(packs.map(pack => [pack.path, pack.title]))
  const ends = [], names = []
  let total = 0
  for (const entry of entries) {
    total += entry.data ? entry.data.length : entry.size ?? (await stat(entry.file)).size
    ends.push(total)
    const prefix = entry.path.startsWith('assets/') ? entry.path.slice(0, entry.path.indexOf('/', 7) + 1) : ''
    names.push(titles.get(prefix) || '')
  }
  let at = 0
  onProgress({done:0, total, pack:names[0] || ''})
  return {onProgress:done => {
    while (at < ends.length - 1 && done >= ends[at]) at++
    onProgress({done, total, pack:names[at]})
  }}
}

export const cardArchiveJson = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')

// The only dsh.json writer. Managed locks are optional v1 extensions, not a second format.
// dependencies: [{id, title, contentHash}] packs the card binds but does not carry; the importer needs them installed.
// onProgress({done, total, pack}) (optional): input bytes written into the archive out of all of them, and the title of
// the pack whose files are being written ('' for the card's own files); a throw from it stops the write.
// base ({version}): an update package — some pack files are left out and come from the importer's asset library (formatVersion 2).
export async function writeDshCard({file, card, packs = [], dependencies = [], plugins = [], entries = [], defaults, extensions = {}, cover, base, onProgress}) {
  const document = withoutPlayerChoices(structuredClone(card.data ? card : {data:card}))
  document.spec = 'chara_card_v3'
  document.spec_version = '3.0'
  const data = document.data || document
  if (exportStageDeclaration(data.extensions?.dsh_tavern)) defaults = {...defaults, stage:true}
  const manifest = {...extensions, format:'dshcard', formatVersion:base ? 2 : 1, ...(base ? {base} : {}),
    card:{title:data.name || 'Character', ...(data.character_version ? {version:data.character_version} : {}), ...(data.creator ? {author:data.creator} : {})},
    plugins, packs, ...(dependencies.length ? {dependencies} : {}), ...(defaults ? {defaults} : {})}
  const files = [...entries]
  if (cover) {
    cover = stripPngTextChunks(await coverImageAsPng(cover))
    data.assets = [{type:'icon', name:'main', ext:'png', uri:'embeded://assets/icon/images/main.png'}, ...(data.assets || []).filter(asset => !(asset.type === 'icon' && asset.name === 'main'))]
    files.push({path:'assets/icon/images/main.png', data:cover})
  }
  const cardJson = cardArchiveJson(document)
  if (cardJson.length > MAX_CARD_JSON_BYTES) throw new Error('人物卡 card.json 超过 ' + MAX_CARD_JSON_BYTES / 1024 ** 2 + ' MiB')
  const all = [{path:'card.json', data:cardJson}, {path:'dsh.json', data:cardArchiveJson(manifest)}, ...files]
  const progress = onProgress ? await archiveProgress(all, packs, onProgress) : {}
  const result = await publishCardZip(file, temporary => writeZip(temporary, all, progress), {
    entries: new Map(all.map(entry => [entry.path, entry.size ?? entry.data?.length]))
  })
  return {...result, card:document, manifest}
}
