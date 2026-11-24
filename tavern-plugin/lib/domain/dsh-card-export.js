import {stat} from 'node:fs/promises'
import {writePackZip as writeZip} from '../../packages/dsh-asset-library/lib/pack-v2/service.js'
import {stripPngTextChunks} from './file-resources.js'
import {coverImageAsPng} from './card-cover-image.js'
import {withoutPlayerChoices} from './card-export-settings.js'
import {projectDshCard, packArchiveEntries} from './dsh-card-export-projection.js'
import {exportStageDeclaration} from '../../packages/dsh-presentation-protocol/src/card-stage-export.js'
import {MAX_CARD_JSON_BYTES} from './card-assets.js'

// dependencies: bound packs the archive does not carry (withCardExport); the card keeps those bindings.
export async function exportDshCardSnapshot({card, packs = [], excludeFigures = [], dependencies = [], ...options}) {
  const projected = await projectDshCard(card, packs, excludeFigures)
  const embedded = new Set(projected.packs.map(({manifest}) => manifest.id))
  const referenced = new Set()
  const visit = value => { if (typeof value === 'string' && value.startsWith('embeded://')) referenced.add(value.slice(10)); else if (value && typeof value === 'object') Object.values(value).forEach(visit) }
  visit(projected.card)
  const entries = (options.entries || []).filter(entry => !entry.path.startsWith('assets/') || referenced.has(entry.path))
  return writeDshCard({...options, card:projected.card,
    packs:projected.packs.map(({manifest}) => ({id:manifest.id, path:'assets/' + manifest.id + '/', format:manifest.format, contentHash:manifest.contentHash, title:manifest.name || manifest.title || '', credits:(manifest.credits || []).map(file => 'assets/' + manifest.id + '/' + file)})),
    dependencies:dependencies.filter(dependency => !embedded.has(dependency.id)),
    entries:[...entries, ...projected.packs.flatMap(packArchiveEntries)]})
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
export async function writeDshCard({file, card, packs = [], dependencies = [], plugins = [], entries = [], defaults, extensions = {}, cover, onProgress}) {
  const document = withoutPlayerChoices(structuredClone(card.data ? card : {data:card}))
  document.spec = 'chara_card_v3'
  document.spec_version = '3.0'
  const data = document.data || document
  if (exportStageDeclaration(data.extensions?.dsh_tavern)) defaults = {...defaults, stage:true}
  const manifest = {...extensions, format:'dshcard', formatVersion:1,
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
  const result = await writeZip(file, all, onProgress ? await archiveProgress(all, packs, onProgress) : {})
  return {...result, size:(await stat(file)).size, file, card:document, manifest}
}
