import path from 'node:path'
import {authorAudioLoudness} from './audio-loudness.js'
import {migrateCharacterEmotions, matchBubbleMood, figureDefaultEmotion} from '../asset-packs/figure-emotions.js'
import {assetContent,assetContents,assetDocument} from '../shared/asset-variant-content.js'
import {assetEntryEnabled,resolveAssetSnapshot,resolveFigureSnapshot} from '../shared/asset-pack-refs.js'
import {importFigureVariants} from './import-figure-variants.js'
import {createVoiceAuthoring,retainVoiceEmotionPointers} from './voice-authoring.js'
import figureResolution from '../shared/figure-resolution.cjs'
import {migrateCgFigures} from '../asset-packs/cg-figures.js'
import {normalizePackImport} from './normalize-import.js'
import {migrateFigureNames, migrateFigureNameBaselines, normalizeFigureAliases} from '../asset-packs/figure-names.js'
import {normalizePackTags,normalizeEntryTags} from '../asset-packs/item-migration.js'
import {migrateRecallPriorityManifest, migrateRecallPriorityFigure, migrateRecallPriorityBaselines} from '../asset-packs/recall-priority.js'
import {BLOB_MIME_TYPES,verifyPackFiles,verifyPackHashes} from '../asset-packs/index.js'
import { randomUUID, createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { compose, Transform } from 'node:stream'
import { publicNetwork, downloadBounded } from '../pack-catalogue/network.js'
import { httpsUrl } from '../pack-catalogue/catalogue.js'
import { createCatalogueManager } from '../pack-catalogue/manager.js'
import { baseMetadata, mergeMetadata } from '../pack-catalogue/merge.js'
import { removedEntries, withRemovedEntries } from './incremental-update.js'
const REMOTE_ARCHIVE = Symbol('host-only downloaded archive')
const CARD_URL_DEADLINE_MS = 20 * 60000
import { assertPublicPackChain } from './public-export.js'
import { createSimpleSprite } from './simple-sprite.js'
import { cardMaterialPack, cardMaterialProjection } from './card-material.js'
import { trimAuthoringImages, retireFigureBundles } from './image-closure.js'
import { applyStateImageMapping, retainPublishedStateImages } from './state-images.js'
import {applyResolutionWrites} from './resolution-write.js'
import { removeFigureEmotion } from './remove-figure-emotion.js'
import { copyFigureAssets } from './copy-figure.js'
import {readCopyMouthDebt, copiedMouthDebt, retireLocalMouthDebt} from './copied-mouth-debt.js'
import { copyPackItems } from './copy-items.js'
import { mergePackContents } from './merge-packs.js'
import { moveFigureContents } from './move-figures.js'
import {createStageSetupMethods} from './stage-setup.js'
import {createAutomaticWriteMethods, patchFigureDocument} from './automatic-writes.js'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { createPackStorage } from './storage.js'
import {createModPrivateMethods,isModConfigPack} from './mod-private.js'
import { isMetadataEdit } from './metadata-edit.js'
import { createCardBundleMethods } from './card-bundle.js'
import { isPackSet, readPackSet, packSetFiles } from './pack-set.js'
import { partitionPackSets, COLLECTION_BYTES } from './pack-set-partition.js'
import { PACK_LIMITS, jsonBytes, readDocument, cloneFiles, budget, sealPack, storedCopyHashes, StoredFile, SpooledFile, heldBytes, spooledBytes, verifyBytes, inspectPackScripts, packDiff } from './validation.js'
import widgetContract from '../shared/widget-schema.cjs'
import { createPackLeases } from './leases.js'
export { PACK_LEASE_PATH } from './leases.js'
export {StoredFile} from './validation.js'
export {projectPackFigures} from './export-figures.js'
import { exportPrivacyView } from './export-privacy.js'
import { carryFigureImageMedia, figureImageExtras, figureLookChanges, withFigureImageExtras, FIGURE_IMAGE_EXTENSION } from './figure-image-extras.js'
export {writeZip as writePackZip, openZip as openPackZip, zipPath as packZipPath} from '../zip.js'
import { openZip, writeZip } from '../zip.js'
import { validatePackIdentities, validateAsset, validatePackDocuments, computeContentHash, sha256 } from '../asset-packs/index.js'
import { shape, check, validateUuid, validateShortId, validateStateId, validateHash, validateAssetRef, validateFigureRef, canonicalJson } from '../asset-packs/common.js'

import { channel } from 'node:diagnostics_channel'
const readTiming = channel('dsh.asset.read')
const copy = value => structuredClone(value)
// Snapshot documents share the existing metadata owner; writers copy their edits.
// Already-frozen subtrees make warm reads independent of the pack's document size.
function freezeSnapshot(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child)
    Object.freeze(value)
  }
  return value
}
// Stored author JSON already crossed strict ingress validation; reads only decode it.
const storedDocument = bytes => {
  const started = performance.now()
  const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes)
  try { return JSON.parse(text) } catch (error) { throw Object.assign(error, {code:'INVALID_JSON'}) }
  finally { if (readTiming.hasSubscribers) readTiming.publish({name:'pack.json.parse', bytes:bytes.length, durationMs:performance.now() - started}) }
}
const keys = pack => new Set([
  ...pack.manifest.assets.map(a => 'asset/' + a.kind + '/' + a.id),
  ...(pack.diagnostics || []).map(row => 'asset/widgets/' + row.ref.assetId),
  ...Object.keys(pack.manifest.bundles).map(k => 'bundle/' + k),
  ...Object.keys(pack.manifest.sprites).map(k => 'sprite/' + k),
  ...Object.values(pack.figures || {}).flatMap(f => ['figure/' + f.id, ...f.outfits.map(outfit => 'outfit/' + f.id + '/' + outfit.key)])
])
const contentSnapshot = pack => ({manifest:pack.manifest, figures:pack.figures, sprites:pack.sprites, widgets:pack.widgets || {}, ...(pack.variantDocuments ? {variantDocuments:pack.variantDocuments} : {}), ...(pack.skins && Object.keys(pack.skins).length ? {skins:pack.skins} : {}), ...(pack.performances && Object.keys(pack.performances).length ? {performances:pack.performances} : {})})
// One pack's rows of the voice catalogue. `users`: the figures speaking with it; `previewFigureId`: the figure of that pack a
// preview of it speaks as (its reference audio is read from that pack).
function voiceRows(pack) {
  if (!pack || isModConfigPack(pack)) return null
  const figures = pack.manifest.figures.map(id => pack.figures[id])
  return {voices:Object.entries(pack.manifest.voiceLibrary?.voices || {}).map(([voiceId, voiceSpec]) => {
    const users = figures.filter(f => f.voice?.voice === voiceId).map(f => ({id:f.id, name:f.name, ...(f.imageColor ? {imageColor:f.imageColor} : {})}))
    return {ref:{packId:pack.manifest.id,voiceId}, name:voiceSpec.name, packName:pack.manifest.name,
      revision:pack.local.revision, voiceSpec:copy(voiceSpec), binding:{voice:voiceId}, users, ...(figures[0] ? {previewFigureId:(users[0] || figures[0]).id} : {})}
  })}
}
const snapshot = pack => pack && freezeSnapshot({...(pack.local.autoWrite?{automatic:true}:{}),...(isModConfigPack(pack)?{privateConfig:true}:{}),...contentSnapshot(pack), ...(pack.diagnostics?.length ? {diagnostics:pack.diagnostics} : {}), revision:pack.local.revision, installedAt:pack.local.installedAt, updatedAt:pack.local.updatedAt, ...(pack.local.distribution ? {distribution:pack.local.distribution} : {})})
// what a list row reads — name, revision, counts, size and a few picture refs.
// No files, blobs, sprites, figure or widget documents (the full list was 19 MB for 30 packs); details are per pack.
const SUMMARY_PICTURE_KINDS = ['backgrounds','cg','items','props'], SUMMARY_PICTURES = 8
const summaryPicture = asset => assetContent(asset).media
const summaries = new WeakMap()
function packSummary(pack) {
  if (pack.summary) return pack.summary
  const known = summaries.get(pack)
  if (known) return known
  const {manifest, local} = pack, counts = {}
  for (const asset of manifest.assets) counts[asset.kind] = (counts[asset.kind] || 0) + 1
  if (manifest.figures.length) counts.figures = manifest.figures.length
  // Enabled pictures first, the three kinds interleaved, so a pack of many backgrounds still shows its CG / items.
  const pools = SUMMARY_PICTURE_KINDS.map(kind => manifest.assets.filter(a => a.kind === kind && summaryPicture(a)).sort((a, b) => (b.enabled !== false) - (a.enabled !== false)))
  const pictures = []
  for (let i = 0; pictures.length < SUMMARY_PICTURES && pools.some(p => i < p.length); i++) for (const p of pools) if (i < p.length && pictures.length < SUMMARY_PICTURES) pictures.push({kind:p[i].kind, id:p[i].id, hash:summaryPicture(p[i])})
  const value = {packId:manifest.id, name:manifest.name, ...(manifest.description ? {description:manifest.description} : {}), revision:local.revision, installedAt:local.installedAt, updatedAt:local.updatedAt,
    ...(local.autoWrite ? {automatic:true} : {}), ...(local.distribution ? {distribution:copy(local.distribution)} : {}), ...(pack.diagnostics?.length ? {diagnostics:copy(pack.diagnostics)} : {}), ...(isModConfigPack(pack) ? {privateConfig:true} : {}),
    bytes:manifest.files.reduce((sum, file) => sum + (Number.isFinite(file.size) ? file.size : 0), 0), counts, voices:Object.keys(manifest.voiceLibrary?.voices || {}).length, pictures}
  summaries.set(pack, value)
  return value
}
function cas(current, expectedRevision, proposed) {
  const revision = current?.local?.revision ?? null
  if (expectedRevision === undefined || expectedRevision !== revision) throw Object.assign(new Error('Pack revision changed'), {code:'REVISION_CONFLICT', revision, diff:packDiff(proposed, current?.manifest)})
}
function remapValue(value, packId, nextId, figures) {
  if (Array.isArray(value)) return value.map(v => remapValue(v, packId, nextId, figures))
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapValue(item, packId, nextId, figures)]))
  // Provenance remains anchored to its original identity, unlike operational refs.
  if (value.extensions?.dsh_tavern?.copiedFrom) result.extensions.dsh_tavern.copiedFrom = copy(value.extensions.dsh_tavern.copiedFrom)
  // Performance alias UUIDs are typed references, not arbitrary author strings.
  if (result.schema === 'dsh.performance/1') for (const alias of Object.keys(result.packs)) if (result.packs[alias] === packId) result.packs[alias] = nextId
  if (result.packId === packId) {
    result.packId = nextId
    if (result.figureId && figures[result.figureId]) result.figureId = figures[result.figureId]
  }
  return result
}
async function remapPack(pack, mapping) {
  const manifest = remapValue(pack.manifest, pack.manifest.id, mapping.packId, mapping.figures), files = new Map(pack.files)
  manifest.id = mapping.packId; manifest.figures = manifest.figures.map(id => mapping.figures[id])
  for (const oldId of pack.manifest.figures) {
    const figure = remapValue(pack.figures[oldId], pack.manifest.id, mapping.packId, mapping.figures)
    figure.id = mapping.figures[oldId]
    files.delete(`figures/${oldId}.json`); files.set(`figures/${figure.id}.json`, jsonBytes(figure))
  }
  // Explicit complete refs in author JSON are remapped, not arbitrary strings/code.
  for (const [name, bytes] of files) if (name.endsWith('.json') && !name.startsWith('figures/')) {
    const next = jsonBytes(remapValue(readDocument(bytes), pack.manifest.id, mapping.packId, mapping.figures))
    if (!next.equals(bytes)) files.set(name, next)
  }
  return sealPack(manifest, files, pack, storedCopyHashes(files,[pack]))
}

// writeZip's input-byte count as {done,total} over these entries (an export's progress bar).
const zipProgress = (entries, onProgress) => {
  if (!onProgress) return {}
  const total = entries.reduce((sum, entry) => sum + entry.data.length, 0)
  return {onProgress:done => onProgress({done, total})}
}

/** Construct explicitly; this service is not composed into Tavern or registered as v1. */
export function createAssetPackService(options) {
  const limits = {...PACK_LIMITS, ...options.limits}, now = options.now || Date.now
  // Mods the constructing install retired: patchPack may delete their private files under mods/<id>/ (a local option, never RPC input).
  const retiredModIds = options.retiredModIds || []
  for (const [key, value] of Object.entries(limits)) check(Number.isSafeInteger(value) && value > 0, '$.limits.' + key)
  const storage = createPackStorage({...options, limits}), previews = new Map(), listeners = new Set()
  // limits.spoolBytes bounds the bytes held in memory at once (previews, archives read from bytes, card downloads).
  // What lies on disk (an import's spool, export archives, downloads) grows with the pack and is bounded by the disk
  // alone: a write that runs out of space fails and is cleaned up, never half-installed.
  const archives = new Set()
  const exportArchive = options.exportArchive || (async file => {
    await Promise.all([...archives].filter(archive => archive.expiresAt <= now()).map(archive => archive.dispose()))
    check(archives.size < limits.previews, '$', 'Too many export archives waiting to be saved', 'LIMIT_EXCEEDED')
    const retained = await storage.retainArchive(file)
    const archive = {...retained, expiresAt:now() + limits.previewTtlMs, async dispose() { await retained.dispose(); archives.delete(archive) }}
    archives.add(archive)
    return archive
  })
  async function localArchive(file) {
    const info = await stat(file)
    check(info.isFile() && info.size <= limits.totalSize, '$.file', 'Archive exceeds budget', 'LIMIT_EXCEEDED')
    return {file, size:info.size, local:true}
  }
  // A pack/set import keys its uploadHash on the whole archive (one hash per transfer); a card bundle reads none.
  async function archiveFile(file) {
    const archive = await localArchive(file), hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    return {...archive, archiveSha256:hash.digest('hex')}
  }
  const blankManifest=(id,name,description)=>({format:'dsh-asset-pack',schemaVersion:1,id,name,...(description===undefined?{}:{description}),contentHash:'0'.repeat(64),assets:[],figures:[],sprites:{},bundles:{},blobs:{},files:[]})
  const modValidators=new Map(options.modValidators || [])
  const verify = (manifest, files, previous, sealed = false) => verifyBytes(manifest, files, {limits, decodeMedia:options.decodeMedia, previous, sealed,modValidators,normalizeSkinMods:options.normalizeSkinMods,
    readStoredFile:(name, size) => storage.read(`packs/${manifest.id}/${name}`, size)})
  // local installation times travel with the same atomic revision write.
  function nextLocal(prior, retired = prior?.retired || []) {
    const updatedAt = now()
    return {...(prior?.autoWrite ? {autoWrite:copy(prior.autoWrite)} : {}), ...(prior?.automaticWrites ? {automaticWrites:copy(prior.automaticWrites)} : {}), ...(prior?.mouthDebt?{mouthDebt:copy(prior.mouthDebt)}:{}),...(prior?.stageSetupCardId?{stageSetupCardId:prior.stageSetupCardId}:{}),...(prior?.modConfig?{modConfig:true}:{}),revision:randomUUID(), retired, installedAt:prior?.installedAt ?? updatedAt, updatedAt, ...(prior?.distribution ? {distribution:copy(prior.distribution)} : {})}
  }
  let disposed = false, previewBytes = 0, ingressBytes = 0, catalogue, cardUrlTask, cardUrlController
  let cardUrlBytes = 0
  const pendingSnapshots = new Map()
  const externalUsage = () => cardUrlBytes + (options.externalSpoolUsage?.() || 0)
  function alive() { check(!disposed, '$', 'Asset service disposed', 'ASSET_UNAVAILABLE') }
  const run = (ids, task, readOnly = false) => storage.run(ids, async () => { alive(); try {return await task()} finally {ingressBytes=0} }, readOnly)
  const readRun = (ids, task, readOnly = false) => storage.readRun(ids, async () => { alive(); return task() }, readOnly)
  async function load(id) {
    const data = await storage.load(id)
    return data && {...await metadata(id), ...data}
  }
  // Export keeps media on disk; JSON remains available to privacy checks and layered projection.
  async function loadForExport(id) {
    const pack = await metadata(id)
    if (!pack) return null
    const files = new Map()
    for (const item of pack.manifest.files) {
      const relative = `packs/${id}/${item.path}`
      if (item.path.endsWith('.json')) files.set(item.path, pack.documents.get(item.path) || await storage.read(relative, item.size))
      else files.set(item.path, new StoredFile(item.size, await storage.locate(relative)))
    }
    return {...pack, files}
  }
  const metadataCache = new Map()
  let metadataBytes = 0
  function evictMetadata(id) {
    const old = metadataCache.get(id)
    if (old) { metadataBytes -= old.size; metadataCache.delete(id) }
  }
  // 'manifest' serves media without hydrating figure/sprite documents; 'figures' adds the figure documents only (the voice
  // catalogue: Live2D sprite documents are most of an installation's JSON); true is list-summary only.
  const covers = (have, want) => want === true || !have || have === want || have === 'figures' && want === 'manifest'
  // A record edit outside a pack write changes the figures a pack shows (figureRecordsChanged): its reads start over.
  const recordGenerations = new Map()
  async function metadata(id, summaryOnly = false) {
    const stamp = await storage.stamp(id), signature = stamp === null ? null : stamp + '#' + (recordGenerations.get(id) || 0), cached = metadataCache.get(id)
    if (cached?.signature === signature && covers(cached.summaryOnly, summaryOnly)) {
      metadataCache.delete(id); metadataCache.set(id, cached)
      return cached.pack
    }
    evictMetadata(id)
    if (signature === null) return null
    // Stored bytes were validated on ingress. Reads parse author documents only.
    const manifestBytes = await storage.read(`packs/${id}/manifest.json`, limits.entrySize)
    const manifest = storedDocument(manifestBytes), diagnostics = []
    const unavailable = (asset, error) => diagnostics.push({ref:{packId:id,kind:'widgets',assetId:asset.id}, name:asset.name, code:'WIDGET_UNAVAILABLE', message:error.message})
    // Installed optional items are projected, never migrated or decoded as old widgets.
    // Import/publication remains strict; optional-item projection never rewrites storage.
    if (Array.isArray(manifest.assets)) manifest.assets = manifest.assets.filter(asset => {
      if (asset?.kind !== 'widgets') return true
      try {
        validateAsset(asset)
        check(assetContents(asset).every(content=>manifest.bundles?.[content.bundleKey]?.kind === 'widget' && manifest.bundles[content.bundleKey].entry === content.entry), '$.assets', 'Missing widget bundle')
        return true
      } catch (error) { unavailable(asset,error); return false }
    })
    check(manifest.id === id, id, 'Incomplete pack publication', 'RECOVERY_REQUIRED')
    let total = manifestBytes.length
    check(total <= limits.totalSize, '$.manifest', 'Pack budget exceeded', 'LIMIT_EXCEEDED')
    check(manifest.files.length + 1 <= limits.entries, '$.files', 'File count budget exceeded', 'LIMIT_EXCEEDED')
    for (const file of manifest.files) {
      total += file.size
      check(file.size <= limits.entrySize && total <= limits.totalSize, file.path, 'Pack budget exceeded', 'LIMIT_EXCEEDED')
    }
    const local = await storage.local(id)
    check(typeof local.revision === 'string' && Array.isArray(local.retired), id, 'Invalid local state', 'RECOVERY_REQUIRED')
    const descriptors = new Map(manifest.files.map(file => [file.path, file])), documents = new Map()
    async function documentBytes(name) {
      if (documents.has(name)) return documents.get(name)
      const file = descriptors.get(name)
      check(file, name, 'Missing metadata document', 'FILE_CLOSURE_MISMATCH')
      const bytes = await storage.read(`packs/${id}/${name}`, file.size)
      check(bytes, name, 'Missing metadata document', 'FILE_CLOSURE_MISMATCH')
      documents.set(name, bytes)
      return bytes
    }
    // List rows need the manifest, not every installed figure/sprite. Hydrate those
    // documents only for a detail read; keep widget projection diagnostics in both tiers.
    const figures = {}, sprites = {}, skins = {}, performances = {}
    if (!summaryOnly || summaryOnly === 'figures') {
      const names = [...new Set([
        ...manifest.figures.map(figureId => `figures/${figureId}.json`),
        ...summaryOnly ? [] : [...Object.values(manifest.sprites),
          ...manifest.assets.filter(a => ['skins','performances'].includes(a.kind)).flatMap(a => assetContents(a).map(c => 'bundles/' + c.bundleKey + '/' + c.entry))]
      ])]
      let next = 0
      // Bound cold hydration I/O; drain all workers before releasing the publication gate.
      const reads = await Promise.allSettled(Array.from({length:Math.min(8, names.length)}, async () => {
        while (next < names.length) await documentBytes(names[next++])
      }))
      const failed = reads.find(result => result.status === 'rejected')
      if (failed) throw failed.reason
      for (const figureId of manifest.figures) figures[figureId] = storedDocument(await documentBytes(`figures/${figureId}.json`))
      await storage.freshen(manifest, documents)
      if (!summaryOnly) {
        for (const [key, name] of Object.entries(manifest.sprites)) sprites[key] = storedDocument(await documentBytes(name))
        for (const asset of manifest.assets.filter(a => a.kind === 'skins')) skins[asset.id] = storedDocument(await documentBytes('bundles/' + assetContent(asset).bundleKey + '/' + assetContent(asset).entry))
        for (const asset of manifest.assets.filter(a => a.kind === 'performances')) performances[asset.id] = storedDocument(await documentBytes('bundles/' + assetContent(asset).bundleKey + '/' + assetContent(asset).entry))
      }
    }
    const widgets = {}, variantDocuments = {}
    for (const asset of manifest.assets.filter(a => a.kind === 'widgets')) {
      try {
        const documents={}
        for(const [index,content] of assetContents(asset).entries()) {
          const document=widgetContract.validateStageWidgetDocument(storedDocument(await documentBytes('bundles/'+content.bundleKey+'/'+content.entry)))
          widgetContract.validateStageWidgetSettingValues(document,content.settingsDefaults)
          widgetContract.stageWidgetResolveSettings(document,content.settingsDefaults)
          if(asset.variants)documents[asset.variants.entries[index].id]=document
          else widgets[asset.id]=document
        }
        if(asset.variants){variantDocuments['widgets/'+asset.id]=documents;widgets[asset.id]=documents[asset.variants.default]}
      } catch (error) {
        unavailable(asset,error)
        manifest.assets = manifest.assets.filter(item => item !== asset)
      }
    }
    for (const asset of manifest.assets) if (!summaryOnly && asset.variants && ['skins','performances'].includes(asset.kind)) {
      const documents = {};
      for (const row of asset.variants.entries) documents[row.id] = storedDocument(await documentBytes('bundles/'+row.content.bundleKey+'/'+row.content.entry));
      variantDocuments[asset.kind+'/'+asset.id] = documents;
    }
    check(stamp === await storage.stamp(id), '$.packId', 'Pack changed during validation', 'REVISION_CONFLICT')
    // Inline voice transcripts are already retained in the figure document.
    // Summary entries retain only the projection, not megabytes of manifest indexes.
    const retained = summaryOnly === true ? {summary:packSummary({manifest, diagnostics, local})} : {manifest, figures, sprites, skins, performances, widgets, variantDocuments, diagnostics, local, documents:summaryOnly === 'figures' ? new Map() : documents, files:new Map()}
    const size = Buffer.byteLength(signature) + Buffer.byteLength(JSON.stringify(summaryOnly === true ? retained : {manifest, figures, sprites, skins, performances, widgets, variantDocuments, diagnostics, local})) + (summaryOnly ? 0 : [...documents.values()].reduce((sum, bytes) => sum + bytes.length, 0))
    if (size <= 32 * 1024 ** 2) {
      evictMetadata(id)
      metadataCache.set(id, {signature, pack:retained, size, summaryOnly}); metadataBytes += size
      while (metadataBytes > 32 * 1024 ** 2 || metadataCache.size > 128) evictMetadata(metadataCache.keys().next().value)
    }
    return retained
  }
  async function all() { const packs = []; for (const id of await storage.listIds()) packs.push(await metadata(id)); return packs }
  async function prepareMerge(source, before, input) {
    const merged = mergePackContents(source,before,input)
    trimAuthoringImages(merged.manifest,merged.files,{...source.figures,...before.figures})
    await sealPack(merged.manifest,merged.files,before,storedCopyHashes(merged.files,[source,before]))
    const bytes = merged.manifest.files.reduce((sum,row)=>sum+row.size,0)
    budget(merged.files,limits)
    const manifestBytes = jsonBytes(merged.manifest).length
    check(bytes + manifestBytes <= limits.totalSize && manifestBytes <= limits.entrySize && merged.files.size + 1 <= limits.entries,'$.files','Merged pack exceeds budget','LIMIT_EXCEEDED')
    const figures = Object.fromEntries(merged.manifest.figures.map(id=>[id,readDocument(merged.files.get('figures/'+id+'.json'))]))
    const sprites = Object.fromEntries(Object.entries(merged.manifest.sprites).map(([key,file])=>[key,readDocument(merged.files.get(file))]))
    const pack = {manifest:merged.manifest, files:merged.files, figures, sprites, local:before.local}
    validatePackDocuments(pack)
    return {pack, bytes, mapping:merged.mapping, bundleKeys:merged.bundleKeys, spriteKeys:merged.spriteKeys, voiceKeys:merged.voiceKeys}
  }
  function emit(pack, before) {
    // the host moved the 外貌 a written figure carried into its record (figureRecords): its pictures leave the pack, as
    // after any figure edit (trimAuthoringImages), in a write of their own once this one is done
    if (pack && storage.takeMoved(pack.manifest.id)) queueMicrotask(() => trimMoved(pack.manifest.id).catch(() => { /* the next figure edit trims them */ }))
    const event = {packId:pack?.manifest.id || before.manifest.id, revision:pack?.local.revision ?? null, kinds:[...new Set([...(before?.manifest.assets || []), ...(pack?.manifest.assets || [])].map(a => a.kind))], figures:[...new Set([...(before?.manifest.figures || []), ...(pack?.manifest.figures || [])])]}
    for (const listener of storage.subscribers) { try { listener(copy(event)) } catch { /* Observers cannot roll back a committed write. */ } }
  }
  async function trimMoved(packId) {
    const current = await readRun([packId], () => metadata(packId), true)
    if (current) await edit({packId, expectedRevision:current.local.revision}, (manifest, files, before) => trimAuthoringImages(manifest, files, before.figures), true)
  }
  async function removeInstalledPack(before) {
    const packId = before.manifest.id
    if (before.local.stageSetupCardId || before.local.autoWrite?.cardId) await options.cardTransactions.unbindPack({packId})
    const settings = before.local.autoWrite?.cardId ? options.settings?.read() : null
    if (settings?.values.globalEnabledPackIds.includes(packId)) {
      await options.settings.save({expectedRevision:settings.revision,globalEnabledPackIds:settings.values.globalEnabledPackIds.filter(id => id !== packId)})
    }
    // Keep identities reusable on reinstall; only managed containers clear bindings.
    await storage.publish(packId, null, nextLocal(before.local))
    emit(null, before)
    return {status:'removed', packId}
  }
  async function install(pack, before, distribution, dryRun = false, resolution, copiedDebt) {
    if(!resolution) {
      const original={manifest:copy(pack.manifest),files:new Map(pack.files)},hashed=new Map()
      resolution=await applyResolutionWrites({manifest:pack.manifest,files:pack.files,previous:before,hashed,read:name => spooledBytes(pack.files.get(name))})
      if(resolution.changes.length) {
        await sealPack(pack.manifest,pack.files,original,hashed)
        pack=await verify(pack.manifest,pack.files,before,true)
      }
    }
    retainPublishedStateImages(before,pack,resolution.technical?new Map(resolution.changes.map(row=>[row.previous,row.hash])):undefined,resolution.imageResolutions,resolution.avatarReplacements,resolution.imageRemovals)
    // Removing or reordering existing identities cannot introduce a library-wide collision.
    // Do not hydrate every installed pack while holding the publication fence for a deletion.
    const previousFigureIds = new Set(before?.manifest.figures || [])
    if (!before || pack.manifest.figures.some(id => !previousFigureIds.has(id))) {
      const installed = await all()
      validatePackIdentities([...installed.filter(p => p.manifest.id !== pack.manifest.id).map(p => p.manifest), pack.manifest])
    }
    let prior = before?.local || await storage.local(pack.manifest.id)
    if (copiedDebt) prior = {...prior,mouthDebt:{...prior?.mouthDebt,...copiedDebt}}
    const retired = new Set(prior?.retired || [])
    const nextKeys = keys(pack), oldKeys = before ? keys(before) : []
    for (const key of nextKeys) check(!retired.has(key), '$.identity', 'Retired identity cannot be reused: ' + key, 'DUPLICATE_ID')
    for (const key of oldKeys) if (!nextKeys.has(key)) retired.add(key)
    if (before?.manifest.contentHash === pack.manifest.contentHash && distribution === undefined) return {status:'noop', snapshot:snapshot(before)}
    if (dryRun) return {status:'dry-run', snapshot:snapshot({...pack, local:prior})}
    const local = nextLocal(retireLocalMouthDebt(prior || {}, pack), [...retired].sort())
    if (distribution !== undefined) {
      if (distribution) local.distribution = copy(distribution)
      else delete local.distribution
    }
    alive()
    if (before?.local.stageSetupCardId && (before.manifest.figures.length || before.manifest.assets.length) && !pack.manifest.figures.length && !pack.manifest.assets.length) return removeInstalledPack(before)
    await storage.publish(pack.manifest.id, pack, local, before)
    const saved = {...pack, local}; emit(saved, before)
    return {status:before ? 'updated' : 'installed', snapshot:snapshot(saved)}
  }
  function createFigure(manifest, files, input) {
    const id = input.id === undefined ? randomUUID() : validateUuid(input.id)
    check(!manifest.figures.includes(id), '$.figure.id', 'Figure already exists', 'DUPLICATE_ID')
    const figure = {enabled:true,appearance:'live2d',recall:{mode:'keyword'},emotions:[],...copy(input.figure),id}
    if (manifest.schemaVersion === 2 && !figure.outfits?.some(outfit => outfit.sprite)) figure.schemaVersion = 2
    if (figure.aliases !== undefined) figure.aliases = normalizeFigureAliases(figure.name, figure.aliases)
    manifest.figures.push(id); files.set(`figures/${id}.json`, jsonBytes(figure))
    return {figureId:id}
  }
  async function edit(input, mutate, tryMetadata = false, migrateLocal, dryRun = false, resolutionTargets, resolutionRestore, imageResolutions, avatarReplacements, imageRemovals, sourcePackIds = []) {
    validateUuid(input.packId)
    return run([input.packId, ...sourcePackIds], async () => {
      if (tryMetadata) {
        const before = await metadata(input.packId); cas(before, input.expectedRevision)
        check(before, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
        if (!before.diagnostics?.length) {
          const manifest = copy(before.manifest), files = new Map(before.files), figures = {...before.figures}
          const extra = await mutate(manifest, files, before)
          Object.assign(manifest,normalizePackTags(manifest))
          for(const id of manifest.figures) {
            const name='figures/'+id+'.json',bytes=files.get(name)
            if(!Buffer.isBuffer(bytes))continue
            const figure=readDocument(bytes),normalized=normalizeEntryTags(figure)
            if(normalized!==figure)files.set(name,jsonBytes(normalized))
          }
          for (const id of manifest.figures) if (files.has(`figures/${id}.json`)) figures[id] = readDocument(files.get(`figures/${id}.json`))
          if (isMetadataEdit(before, manifest, figures)) {
            validatePackDocuments({manifest, figures, sprites:before.sprites})
            const updates = new Map()
            for (const id of manifest.figures) {
              const name = `figures/${id}.json`, bytes = files.get(name)
              if (bytes && !bytes.equals(jsonBytes(before.figures[id]))) updates.set(name, bytes)
            }
            manifest.files = await Promise.all(manifest.files.map(async file => updates.has(file.path) ? {path:file.path, size:updates.get(file.path).length, sha256:await sha256(updates.get(file.path))} : file))
            manifest.contentHash = await computeContentHash(manifest)
            check([...updates.values()].every(bytes => bytes.length <= limits.entrySize) && jsonBytes(manifest).length + manifest.files.reduce((sum, file) => sum + file.size, 0) <= limits.totalSize, '$.files', 'Pack budget exceeded', 'LIMIT_EXCEEDED')
            const migratedLocal = migrateLocal ? migrateLocal(before.local,before.figures) : before.local
            if (manifest.contentHash === before.manifest.contentHash && canonicalJson(migratedLocal) === canonicalJson(before.local)) return {status:'noop', snapshot:snapshot(before), ...extra}
            if (dryRun) return {status:'dry-run', snapshot:snapshot({...before, manifest, figures, files, local:migratedLocal}), ...extra}
            const local = nextLocal(retireLocalMouthDebt(migratedLocal, {figures,sprites:before.sprites}))
            await storage.publishMetadata(input.packId, manifest, updates, local)
            const saved = {...before, manifest, figures, files, local};
            for (const asset of manifest.assets) if (asset.variants && before.variantDocuments?.[asset.kind+'/'+asset.id]) saved[asset.kind]={...saved[asset.kind],[asset.id]:before.variantDocuments[asset.kind+'/'+asset.id][asset.variants.default]};
            evictMetadata(input.packId); emit(saved, before)
            return {status:'updated', snapshot:snapshot(saved), ...extra}
          }
        }
      }
      const authored = await metadata(input.packId); cas(authored, input.expectedRevision)
      check(authored, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
      // Keep untouched resources as stored identities, not a full in-memory copy of the pack.
      const before = authored.diagnostics?.length ? await load(input.packId) : {...authored, files:new Map(authored.manifest.files.map(file => [file.path, authored.documents.get(file.path) || new StoredFile(file.size)]))}
      cas(before, input.expectedRevision)
      // `hashed` carries CAS names this edit just computed, so sealing does not hash those bytes again.
      const manifest = copy(before.manifest), files = new Map(before.files), hashed = new Map()
      const extra = await mutate(manifest, files, before, hashed)
      Object.assign(manifest,normalizePackTags(manifest))
          for(const id of manifest.figures) {
            const name='figures/'+id+'.json',bytes=files.get(name)
            if(!Buffer.isBuffer(bytes))continue
            const figure=readDocument(bytes),normalized=normalizeEntryTags(figure)
            if(normalized!==figure)files.set(name,jsonBytes(normalized))
          }
      await authorAudioLoudness(manifest, files, {previous:before, measure:options.measureAudio, read:(name,size) => storage.read(`packs/${manifest.id}/${name}`,size)})
      const resolution=await applyResolutionWrites({manifest,files,previous:before,hashed,targets:resolutionTargets,restore:resolutionRestore,
        read:(name,size)=>storage.read(`packs/${manifest.id}/${name}`,size),compare:resolutionTargets&&input.compare===true})
      resolution.technical=Boolean(resolutionTargets||resolutionRestore)
      resolution.imageResolutions=imageResolutions
      resolution.avatarReplacements=avatarReplacements
      resolution.imageRemovals=imageRemovals
      await sealPack(manifest, files, before, hashed)
      const verified = await verify(manifest, files, before, true)
      for (const [id, document] of Object.entries(verified.widgets)) {
        const known=[before.widgets?.[id],...Object.values(before.variantDocuments?.['widgets/'+id] || {})].map(doc=>canonicalJson(doc?.variables || {}))
        for(const next of [document,...Object.values(verified.variantDocuments?.['widgets/'+id] || {})]) check(known.includes(canonicalJson(next.variables || {})), '$.widgets.' + id + '.variables', 'Variable capability changes require archive inspection and applyImport', 'SCRIPT_CONFIRMATION_REQUIRED')
      }
      const result = await install(verified, migrateLocal ? {...before,local:migrateLocal(before.local,before.figures)} : before, undefined, dryRun, resolution)
      return {...result, ...extra, resolution}
    }, dryRun)
  }
  // An import's spooled entries stay on disk until the last preview reading them goes.
  const spoolDisposals = new Set()
  async function openSpool() {
    let users = 1, opened
    const dir = () => opened ??= storage.spool()
    return {
      // one entry streamed to its spool file and hashed on the way; the extension stays for decoders that read the file
      async take(zip, entry, index) {
        const file = path.join((await dir()).dir, index + path.posix.extname(entry.path)), hash = createHash('sha256')
        await zip.consume(entry, compose(new Transform({transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk) }}), createWriteStream(file, {flags:'wx'})))
        return new SpooledFile(entry.size, file, hash.digest('hex'))
      },
      retain() { users++ },
      // resolves when the last user's release has removed the spool; callers that can wait do, so nothing runs after them
      release() {
        if (--users || !opened) return
        const task = opened.then(spool => spool.dispose()).catch(() => {}).finally(() => spoolDisposals.delete(task))
        spoolDisposals.add(task)
        return task
      }
    }
  }
  function forget(id) { const entry = previews.get(id); previews.delete(id); previewBytes -= entry.size; return entry.spool?.release() }
  function sweep() { for (const [id, entry] of previews) if (entry.expiresAt <= now()) forget(id) }
  // a 素材包合集 holds one preview per pack but counts as one inspection.
  const previewCount = () => new Set([...previews].map(([id, entry]) => entry.set || id)).size
  function dropSet(setId) { for (const [id, entry] of previews) if (entry.set === setId) forget(id) }
  // An archive's documents are read into memory; its media blobs (by far most of a large pack) go to a spool on disk.
  // Resolves {files, spool}: the caller releases the spool once, after retaining it for each preview it keeps.
  async function readZipFile(file, archiveBytes, extraBytes, signal) {
    const zip = await openZip(file, limits), files = new Map()
    guardArchive(zip.entries)
    const held = zip.entries.reduce((sum, entry) => sum + (SPOOLED.test(entry.path) ? 0 : entry.size), 0)
    check(held + archiveBytes + ingressBytes + previewBytes + extraBytes + externalUsage() <= limits.spoolBytes, '$.bytes', 'Import spool budget exceeded', 'LIMIT_EXCEEDED')
    ingressBytes += held + archiveBytes
    const spool = await openSpool()
    try {
      // Even zero-length directory entries must pass CRC verification.
      for (const [index, entry] of zip.entries.entries()) {
        signal?.throwIfAborted()
        if (entry.directory) await zip.read(entry)
        else files.set(entry.path, SPOOLED.test(entry.path) ? await spool.take(zip, entry, index) : await zip.read(entry))
      }
    } catch (error) { spool.release(); throw error }
    return {files, spool}
  }
  async function readZipFiles(bytes, extraBytes = cardBundles.cardBundleUsage().bytes) {
    check(bytes instanceof Uint8Array && bytes.length <= limits.spoolBytes, '$.bytes', 'Archive exceeds spool budget', 'LIMIT_EXCEEDED')
    return storage.temporary(async file => {
      await writeFile(file, bytes, {flag:'wx'})
      return readZipFile(file, bytes.length, extraBytes)
    })
  }
  async function readArchive(bytes, remote) {
    const {files, spool} = remote ? await readZipFile(remote.file, 0, cardBundleUsage().bytes, remote.signal) : await readZipFiles(bytes)
    try {
      if (isPackSet(files)) { const set = []; for (const pack of readPackSet(files)) set.push(await importPack(pack.manifest, pack.files)); return {set, spool} }
      const root = files.get('manifest.json'); check(root, '$', 'Missing pack manifest', 'FILE_CLOSURE_MISMATCH')
      files.delete('manifest.json')
      return {pack:await importPack(readDocument(root),files), spool}
    } catch (error) { spool.release(); throw error }
  }
  async function importPack(manifest,files) {
    // Authenticate external bytes once before shared import normalization can reseal them.
    await verifyPackHashes(manifest); await verifyPackFiles(manifest,files)
    const authenticated = {manifest:{...manifest}, files:new Map(files)}
    const normalized = normalizePackImport(manifest,files)
    manifest = normalized.manifest
    const audioChanged = await authorAudioLoudness(manifest, files, {measure:options.measureAudio})
    const hashed=new Map(),resolution=await applyResolutionWrites({manifest,files,hashed,read:name => spooledBytes(files.get(name))})
    if (normalized.changed||audioChanged||resolution.changes.length) await sealPack(manifest,files,authenticated,hashed)
    return verify(manifest, files, undefined, true)
  }
  // A widget default that names a background of a pack the export does not carry only keeps its reference.
  async function exportWarnings(pack, carried = []) {
    const warnings = []
    for (const asset of pack.manifest.assets) if (asset.kind==='widgets') for(const [index,content] of assetContents(asset).entries()) for (const [field,ref] of Object.entries(content.settingsDefaults || {})) if (ref?.kind==='backgrounds' && ref.packId!==pack.manifest.id && !carried.includes(ref.packId)) {
      const external=await metadata(ref.packId), image=external?.manifest.assets.find(item=>item.kind==='backgrounds' && item.id===ref.assetId)
      const document=assetDocument(pack,asset,asset.variants?.entries[index].id),declaration=document.settingsSchema.fields.find(item=>item.key===field)
      warnings.push({code:'external-widget-default',ref:copy(ref),widgetName:asset.name,settingLabel:widgetContract.stageWidgetSettingLabel(document,declaration.label),packName:external?.manifest.name || null,assetName:image?.name || null})
    }
    return warnings
  }
  // One pack of an import (a single-pack ZIP, or one pack of a 素材包合集): its preview, kept until applyImport.
  async function inspectPack(pack, {remote, uploadHash, installed, copyOnly, setId, spool}) {
    const before = await metadata(pack.manifest.id)
    let distribution, merge
    if (remote) {
      remote.signal.throwIfAborted()
      check(!remote.source || remote.source.packId === pack.manifest.id, '$.packId', 'Catalogue UUID differs from ZIP manifest', 'INTEGRITY_MISMATCH')
      const upstreamContentHash = pack.manifest.contentHash, base = baseMetadata(pack)
      if (before) {
        const prior = before.local.distribution
        const merged = await mergeMetadata(pack, before, remote.source && prior?.sourceId === remote.source.sourceId ? prior.baseMetadata : undefined)
        pack = merged.pack; merge = merged.merge
      }
      distribution = {sourceId:remote.source?.sourceId || null,catalogueUrl:remote.source?.catalogueUrl || null,version:remote.source?.version || null,archiveSha256:remote.archiveSha256,upstreamContentHash,baseMetadata:base}
    }
    const conflictFigures = pack.manifest.figures.filter(id => installed.some(p => p.manifest.id !== pack.manifest.id && p.manifest.figures.includes(id)))
    const identityConflict = conflictFigures.length > 0 || installed.some(p => p.manifest.id !== pack.manifest.id && (pack.manifest.figures.includes(p.manifest.id) || p.manifest.figures.includes(pack.manifest.id)))
    const same = before?.manifest.contentHash === pack.manifest.contentHash && (!remote || canonicalJson(before.local.distribution || null) === canonicalJson(distribution))
    let choices = identityConflict || copyOnly ? ['keep-both','cancel'] : same ? ['noop','cancel'] : before ? ['update','merge','keep-both','cancel'] : ['install','keep-both','cancel']
    const mapping = {packId:randomUUID(), figures:Object.fromEntries(pack.manifest.figures.map(id => [id,randomUUID()]))}
    const remapped = await remapPack(pack, mapping)
    const keep = await verify(remapped.manifest, remapped.files, pack, true)
    const id = randomUUID(), expiresAt = now() + limits.previewTtlMs, size = heldBytes(pack.files) + jsonBytes(pack.manifest).length
    check(previewBytes + cardBundleUsage().bytes + size + externalUsage() <= limits.spoolBytes, '$', 'Preview spool budget exceeded', 'LIMIT_EXCEEDED')
    const preview = {inspectionId:id, uploadHash, packId:pack.manifest.id, contentHash:pack.manifest.contentHash, expectedRevision:before?.local.revision ?? (await storage.local(pack.manifest.id))?.revision ?? null, choices, expiresAt, diff:packDiff(before?.manifest, pack.manifest), incoming:contentSnapshot(pack), current:snapshot(before), conflictFigures, mapping, scriptRisk:inspectPackScripts(pack), figureLooks:choices.includes('update') ? await figureLookChanges(options, before, pack) : [], removed:choices.includes('merge') ? removedEntries(before, pack) : []}
    if (remote) { preview.distribution = {...remote.source, archiveSha256:remote.archiveSha256, integrity:remote.integrity}; preview.merge = merge || {preserved:[],removedEdited:[],withoutBaseline:false,wholePackReplacement:false} }
    spool.retain(); previews.set(id, {pack, keep, preview, expiresAt, size, distribution, spool, ...(setId ? {set:setId} : {})}); previewBytes += size
    return preview
  }
  const cardBundles = createCardBundleMethods({storage, run, readRun, privateExportFile:options.privateExportFile, alive, load:loadForExport, metadata, exportArchive, readZipFile, archiveKey:REMOTE_ARCHIVE, all, verify, importPack, cas, keys, remapPack, remapValue, readZipFiles, limits, now, nextLocal, emit, cards:options.cardTransactions, globalPackIds:options.globalEnabledPackIds, withFigureImageExtras:pack => withFigureImageExtras(pack, options), packPreviewUsage:() => {sweep();return {count:previewCount(),bytes:previewBytes}}})
  const {disposeCardBundles, cardBundleUsage, ...bundleMethods} = cardBundles
  // One revision fence for every lease read: whole bundle payloads, a size, or one byte range.
  const leaseAccess = (entry, names, action) => readRun([entry.packId], async () => {
    const pack = await metadata(entry.packId, 'manifest')
    check(pack, '$.packId', 'Leased pack removed', 'ASSET_UNAVAILABLE')
    // Inert bytes follow content identity; a skin/label publication must not break a mounting figure.
    const unchanged = entry.kind === 'media' ? !!pack.manifest.blobs[entry.hash]
      : entry.kind === 'bundle' ? pack.manifest.bundles[entry.bundleKey]?.contentHash === entry.contentHash
      : pack.local.revision === entry.revision
    check(unchanged, '$.revision', 'Lease content changed', 'REVISION_CONFLICT')
    const files = names.map(name => {
      const file = pack.manifest.files.find(file => file.path === name)
      check(file, name, 'Lease resource outside manifest', 'ASSET_UNAVAILABLE')
      return file
    })
    const result = await action(files)
    alive()
    return result
  })
  const leases = createPackLeases({now, ttlMs:options.leaseTtlMs, maxLeases:options.maxLeases,
    authorize:options.authorizeLease,
    inspect:(entry, name) => leaseAccess(entry, [name], ([file]) => ({size:file.size})),
    readRange:(entry, name, position, length) => leaseAccess(entry, [name], () => storage.readRange(`packs/${entry.packId}/${name}`, position, length)),
    read:(entry, names) => leaseAccess(entry, names, async () => {
      const result = []
      for (const name of names) {
        const bytes = await storage.read(`packs/${entry.packId}/${name}`)
        check(bytes, name, 'Missing lease resource', 'FILE_CLOSURE_MISMATCH')
        result.push(bytes)
      }
      return result
    })
  })
  const service = {
    ...createVoiceAuthoring({assetRoot:options.assetRoot,storage,run,load,edit,cas,limits}),
    ...createStageSetupMethods({assetRoot:options.assetRoot,run,all,load,verify,storage,cards:options.cardTransactions,nextLocal,emit,blankManifest,createFigure}),
    ...createAutomaticWriteMethods({run,readRun,load,metadata,verify,storage,cards:options.cardTransactions,nextLocal,emit,blankManifest,createFigure,cas,now,limits,evictMetadata,globalPackIds:options.globalEnabledPackIds,
      figureImageExtras:(packId, figureIds) => figureImageExtras(options, packId, figureIds),
      carryFigureImageMedia:(packId, extras, manifest, files, hashed) => carryFigureImageMedia(options, packId, extras, manifest, files, hashed)}),
    ...createModPrivateMethods({validators:modValidators,run,metadata,storage,cas,edit,readDocument,jsonBytes,load,verify,sealPack,nextLocal,emit,cards:options.cardTransactions,randomUUID,blankManifest,remapPack}),
    apiVersion:2,
    ...bundleMethods,
    // Direct public HTTPS card bundles use the same pinned-DNS/redirect boundary as pack URLs.
    inspectCardBundleUrl({path, url}) {
      alive(); httpsUrl(url);
      check(!cardUrlTask, '$.url', 'A card download is already running', 'ASSET_UNAVAILABLE');
      const maximum = Math.min(1024 ** 3, limits.totalSize, Math.floor(limits.spoolBytes / 3));
      check(maximum + previewBytes + cardBundleUsage().bytes + externalUsage() <= limits.spoolBytes, '$', 'Shared spool budget exceeded', 'LIMIT_EXCEEDED');
      cardUrlBytes = maximum; const controller = cardUrlController = new AbortController();
      // a whole-download deadline, not a stall timer (the request already drops a connection
      // idle for 30 s). 3 minutes cut a 206 MB GitHub Release bundle below ~9 Mbit/s; 20 minutes allows ~1.4 Mbit/s.
      const timer = setTimeout(() => controller.abort(), CARD_URL_DEADLINE_MS); timer.unref?.();
      cardUrlTask = (async () => {
        const directory = await storage.locate('downloads')
        await mkdir(directory, {recursive:true})
        const file = await storage.locate('downloads/card-' + randomUUID() + '.part')
        try {
          try { await downloadBounded(options.catalogueNetwork || publicNetwork, url, maximum, controller.signal, file) }
          catch (error) {
            // a download failure is always DOWNLOAD_FAILED with a reason the UI can word
            // (HTTP status, timeout, or the network error code), never a raw socket error.
            if (disposed || ['DOWNLOAD_FAILED','LIMIT_EXCEEDED'].includes(error?.code)) throw error
            if (error?.code === 'ENOSPC') throw Object.assign(new Error('Not enough disk space for card download'), {code:'LIMIT_EXCEEDED', path:'$.url'})
            throw Object.assign(new Error(controller.signal.aborted ? 'Download timed out' : 'Network request failed' + (/^E[A-Z_]+$/.test(error?.code || '') ? ' (' + error.code + ')' : '')), {code:'DOWNLOAD_FAILED', path:'$.url'})
          }
          alive();
          return await service.inspectCardBundleFile({path, file});
        } finally {
          await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
      })().finally(() => {
        clearTimeout(timer); cardUrlBytes = 0; cardUrlTask = null; cardUrlController = null;
      });
      return cardUrlTask;
    },
    capabilities:Object.freeze(['layered-face-v1', 'packs', 'figures', 'blobs', 'bundles', 'pack-zip', 'card-bundle', 'leases', 'widget-risk-data', 'pack-catalogue-v1', 'url-install', 'pack-set', 'stage-setup-v1']),
    listPacks:() => readRun([], async () => {
      const entries = []
      // Listing tolerates a broken pack; mutation/identity checks still use strict all().
      for (const packId of await storage.listIds()) {
        try { const pack = await metadata(packId); if (pack) entries.push(snapshot(pack)) }
        catch (error) { entries.push({packId, error:{code:error.code || 'ASSET_UNAVAILABLE', message:error.message || String(error)}}) }
      }
      return entries
    }),
    // Reads manifests and figure documents only (metadata 'figures'), never the Live2D sprite documents a full snapshot hydrates.
    async listVoiceCatalogue() {
      const read = readRun([], async () => {
        const ids = await storage.listIds(), rows = new Array(ids.length)
        let next = 0
        await Promise.all(Array.from({length:Math.min(8, ids.length)}, async () => {
          while (next < ids.length) {
            const index = next++, packId = ids[index]
            try { rows[index] = voiceRows(await metadata(packId, 'figures')) }
            catch (error) { rows[index] = {error:{packId, error:{code:error.code || 'ASSET_UNAVAILABLE', message:error.message || String(error)}}} }
          }
        }))
        return rows
      })
      const [rows, {templates}] = await Promise.all([read, service.listVoiceTemplates()])
      const voices = rows.flatMap(row => row?.voices || []), errors = rows.filter(row => row?.error).map(row => row.error)
      for (const item of templates) voices.push({ref:{templateId:item.templateId}, name:item.name,
        revision:item.revision, voiceSpec:item.voiceSpec, binding:item.binding})
      return {voices, errors}
    },
    // the list views' read; one broken pack is a row of its own, as in listPacks.
    listPackSummaries:() => readRun([], async () => {
      const ids = await storage.listIds(), entries = new Array(ids.length)
      let next = 0
      // Keep the publication gate and every path check, but overlap independent I/O.
      // Bounded workers preserve list order without queuing the entire installation.
      await Promise.all(Array.from({length:Math.min(8, ids.length)}, async () => {
        while (next < ids.length) {
          const index = next++, packId = ids[index]
          try { const pack = await metadata(packId, true); if (pack) entries[index] = copy(packSummary(pack)) }
          catch (error) { entries[index] = {packId, error:{code:error.code || 'ASSET_UNAVAILABLE', message:error.message || String(error)}} }
        }
      }))
      return entries.filter(Boolean)
    }),
    // Transport access checks need one flag, not a cloned pack and all its figures.
    isPrivatePack:({packId}) => { validateUuid(packId); return readRun([packId], async () => {
      return isModConfigPack(await metadata(packId, 'manifest'))
    }) },
    getPackSnapshot({packId, readOnly = false}) {
      validateUuid(packId)
      const key = `${packId}:${Boolean(readOnly)}`
      let loading = pendingSnapshots.get(key)
      // Concurrent consumers share one immutable result from one gated publication read.
      if (!loading) {
        loading = readRun([packId], async () => {
          const started = performance.now(), pack = await metadata(packId), frozenAt = performance.now()
          const value = snapshot(pack)
          if (readTiming.hasSubscribers) {
            readTiming.publish({name:'pack.metadata', packId, durationMs:frozenAt - started})
            readTiming.publish({name:'pack.snapshot.freeze', packId, durationMs:performance.now() - frozenAt})
          }
          return value
        }, readOnly)
        pendingSnapshots.set(key,loading)
      }
      return loading.then(value => { alive(); return value }).finally(() => {
        if (pendingSnapshots.get(key) === loading) pendingSnapshots.delete(key)
      })
    },

    // Host-only, entry-bound reference text. Stored identity is a cache key, not rehashed on reads.
    readAssetText(input) {
      validateAssetRef(input.ref)
      return readRun([input.ref.packId], async () => {
        const pack=await metadata(input.ref.packId)
        const asset=pack?.manifest.assets.find(a=>a.kind===input.ref.kind && a.id===input.ref.assetId)
        check(asset?.credits?.includes(input.path) && input.path.startsWith('credits/'),'$.path','Reference is not bound to this entry','ASSET_UNAVAILABLE')
        const file=pack.manifest.files.find(f=>f.path===input.path)
        check(file && file.size<=16*1024**2,'$.path','Reference unavailable','ASSET_UNAVAILABLE')
        if(input.knownIdentity===file.sha256)return {identity:file.sha256}
        const bytes=await storage.read(`packs/${input.ref.packId}/${file.path}`,file.size)
        return {identity:file.sha256,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
      })
    },
    // Host-only reference reader; browser media still uses authenticated leases.
    readMedia(input) {
      validateUuid(input.packId); validateHash(input.hash)
      return readRun([input.packId], async () => {
        const pack = await metadata(input.packId); cas(pack, input.expectedRevision)
        const descriptor = pack?.manifest.blobs[input.hash]
        check(descriptor, '$.hash', 'Blob missing', 'ASSET_UNAVAILABLE')
        const bytes = await storage.read(`packs/${input.packId}/media/${input.hash}.${descriptor.ext}`, descriptor.size)
        check(bytes, '$.hash', 'Blob missing', 'ASSET_UNAVAILABLE')
        return {bytes, descriptor:copy(descriptor)}
      })
    },
    // A card's loose material (no packs of its own) as one pack named after the card; the card binds it. The same material
    // names the same pack: already installed (perhaps edited since), it is left as it is. Nothing usable: no pack
    // (status 'empty'), only the notices. A new pack's revision lets the caller take it back (removePack) when the card
    // it was made for is not written.
    async importCardMaterial({name, material}) {
      alive(); check(typeof name === 'string' && name.trim().length > 0, '$.name')
      const built = await cardMaterialPack({...material, name}, (await options.voiceChannels?.()) || [])
      if (!built.manifest) return {packId:null, status:'empty', notices:built.notices}
      const packId = built.manifest.id
      return run([packId], async () => {
        if (await metadata(packId)) return {packId, status:'noop', notices:built.notices}
        const result = await install(await importPack(built.manifest, built.files), null)
        return {packId, status:result.status, revision:result.snapshot.revision, notices:built.notices}
      })
    },
    // The figures and backgrounds of a card's packs as cast material (a CHARX export). Files are named
    // <packId>/<sha256>.<ext>; read(file) returns the bytes of one the export keeps.
    async projectCardMaterial({packIds}) {
      const characters = [], backgrounds = [], revisions = new Map()
      for (const packId of packIds) {
        const pack = await service.getPackSnapshot({packId, readOnly:true})
        if (!pack) continue
        revisions.set(packId, pack.revision)
        const file = hash => hash ? packId + '/' + hash + '.' + pack.manifest.blobs[hash].ext : null
        const projected = cardMaterialProjection(pack)
        for (const character of projected.characters) characters.push({...character, avatar:file(character.avatar),
          sprites:Object.fromEntries(Object.entries(character.sprites).map(([emotion, hash]) => [emotion, file(hash)])),
          ...(character.references ? {references:character.references.map(clip => ({file:file(clip.media), text:clip.text}))} : {})})
        for (const background of projected.backgrounds) backgrounds.push({name:background.name, file:file(background.media)})
      }
      const read = async name => {
        const [packId, base] = name.split('/')
        return (await service.readMedia({packId, hash:base.split('.')[0], expectedRevision:revisions.get(packId)})).bytes
      }
      return {characters, backgrounds, read}
    },
    // Application-owned defaults are installed once, off; never overwrite a user's edits.
    ensureBuiltinPack({packId,name,assets}) {
      validateUuid(packId)
      return run([packId],async()=>{
        const before=await metadata(packId)
        if(before)return {status:'noop',snapshot:snapshot(before)}
        const manifest={...blankManifest(packId,name),assets:copy(assets)}
        manifest.contentHash=await computeContentHash(manifest)
        return install(await verify(manifest,new Map(),undefined,true),null)
      })
    },
    createPack(input) {
      const id = randomUUID()
      return run([id], async () => {
        cas(null, input.expectedRevision)
        const manifest = blankManifest(id,input.name,input.description)
        manifest.contentHash = await computeContentHash(manifest)
        // Just sealed here: validate the structure without recomputing the digest.
        return install(await verify(manifest, new Map(), undefined, true), null)
      })
    },
    // Explicit offline ingress only; not exposed by the RPC allowlist.
    // one-time installed-pack migration uses the same CAS transaction as edits.
    // explicit offline migration, with the ordinary CAS and atomic metadata journal.
    async migrateFigureVariants(input) {
      validateUuid(input.packId)
      check(input.dryRun === undefined || typeof input.dryRun === 'boolean', '$.dryRun', 'Expected boolean')
      if(input.dryRun)return run([input.packId],async()=>{
        const before=await metadata(input.packId);cas(before,input.expectedRevision);
        check(before,'$.packId','Pack missing','ASSET_UNAVAILABLE');
        const next=importFigureVariants(before.manifest,before.figures,before.sprites);
        validatePackDocuments({...next,sprites:before.sprites});
        return {status:'dry-run',changed:canonicalJson(next)!==canonicalJson({manifest:before.manifest,figures:before.figures}),snapshot:freezeSnapshot({...snapshot(before),...next})};
      });
      return edit(input,async(manifest,files,before)=>{
        const next=importFigureVariants(manifest,before.figures,before.sprites);
        if(next.manifest.voiceLibrary)manifest.voiceLibrary=next.manifest.voiceLibrary;
        for(const [id,figure]of Object.entries(next.figures))if(canonicalJson(figure)!==canonicalJson(before.figures[id]))files.set('figures/'+id+'.json',jsonBytes(figure));
      },true);
    },
    migrateCharacterEmotions(input) {
      return edit(input, (_manifest,files,before)=>{
        for(const [id,figure] of Object.entries(before.figures)) {
          const next=migrateCharacterEmotions(figure);
          if(next!==figure) files.set('figures/'+id+'.json',jsonBytes(next));
        }
      },true);
    },
    migrateCgFigures(input) {
      return edit(input, manifest => { manifest.assets = migrateCgFigures(manifest).assets })
    },
    migrateFigureNames(input) {
      return edit(input, async (manifest, files, before) => {
        for (const id of manifest.figures) files.set('figures/'+id+'.json',jsonBytes(migrateFigureNames(before.figures[id])))
      }, true, migrateFigureNameBaselines)
    },
    // the one-time 优先级 removal of an installed pack — entries, figures, outfits and the
    // publisher baseline lose recall.priority in one metadata publication. Explicit offline ingress only; not on the RPC allowlist.
    migrateRecallPriority(input) {
      return edit(input, async (manifest, files, before) => {
        manifest.assets = migrateRecallPriorityManifest(manifest).assets
        for (const id of manifest.figures) {
          const next = migrateRecallPriorityFigure(before.figures[id])
          if (next !== before.figures[id]) files.set('figures/'+id+'.json',jsonBytes(next))
        }
      }, true, migrateRecallPriorityBaselines)
    },
    resolveMedia(input) {
      check(input.dryRun===undefined||typeof input.dryRun==='boolean','$.dryRun','Expected boolean')
      const selection=input.restore||input.targets
      check(selection&&typeof selection==='object'&&!Array.isArray(selection)&&!(input.restore&&input.targets),'$.targets','Expected either target dimensions or original avatar sources')
      let restore
      if(input.restore)restore=Object.fromEntries(Object.entries(input.restore).map(([hash,row])=>{
        check(Buffer.isBuffer(row.bytes),'$.restore.'+hash,'Expected original source bytes')
        return [hash,{hash:row.hash,bytes:Buffer.from(row.bytes)}]
      }))
      return edit(input,async()=>{},false,undefined,input.dryRun===true,input.targets&&copy(input.targets),restore)
    },
    migrateStateImages(input) {
      check(input.dryRun === undefined || typeof input.dryRun === 'boolean', '$.dryRun', 'Expected boolean')
      const mapping = copy(input.mapping)
      return edit(input, async (manifest, files, before) => {
        const next = applyStateImageMapping(before,mapping)
        manifest.schemaVersion = next.manifest.schemaVersion
        for (const [id,figure] of Object.entries(next.figures)) files.set('figures/'+id+'.json',jsonBytes(figure))
        for (const [key,sprite] of Object.entries(next.sprites)) files.set(manifest.sprites[key],jsonBytes(sprite))
      }, false, undefined, input.dryRun === true)
    },
    patchPack(input) {
      check(input.dryRun === undefined || typeof input.dryRun === 'boolean', '$.dryRun', 'Expected boolean')
      check(input.imageResolutions === undefined || Array.isArray(input.imageResolutions), '$.imageResolutions', 'Expected an array')
      check(input.avatarReplacements === undefined || Array.isArray(input.avatarReplacements), '$.avatarReplacements', 'Expected an array')
      check(input.imageRemovals === undefined || Array.isArray(input.imageRemovals), '$.imageRemovals', 'Expected an array')
      // Full author-field replacement patch, plus exact byte updates. Never a revision/hash patch.
      const patch = copy(input.patch || {}), updates = input.fileUpdates ? cloneFilesWithDeletes(input.fileUpdates) : new Map()
      return edit(input, async (manifest, files, before) => {
        for (const key of Object.keys(patch)) check(!['id','format','schemaVersion','contentHash','files'].includes(key), '$.patch.' + key, 'Identity/hash fields cannot be patched')
        // Metadata probing and the full transaction each trim their own resource closure.
        Object.assign(manifest, copy(patch))
        // An optional author field patched to undefined is removed.
        for (const [key, value] of Object.entries(patch)) if (value === undefined) delete manifest[key]
        for (const [name, bytes] of updates) {
          check(!name.startsWith('mods/') || bytes === null && retiredModIds.some(id => name.startsWith('mods/'+id+'/')),'$.fileUpdates','Only retired mod namespaces can be removed here','UNKNOWN_FIELD')
          if (name.startsWith('figures/') && bytes !== null) check(manifest.figures.includes(name.slice(8, -5)), '$.fileUpdates', 'Figure document is not in the manifest')
          if (bytes === null) files.delete(name)
          else if (name.startsWith('figures/')) {
            const figure = readDocument(bytes), previous = before.figures[figure.id]
            if (figure.aliases !== undefined && (!previous || figure.name !== previous.name || canonicalJson(figure.aliases) !== canonicalJson(previous.aliases || []))) {
              const aliases = normalizeFigureAliases(figure.name, figure.aliases)
              const changed = canonicalJson(aliases) !== canonicalJson(figure.aliases)
              figure.aliases = aliases
              files.set(name, changed ? jsonBytes(figure) : bytes)
            } else files.set(name, bytes)
          } else files.set(name, bytes)
        }
        trimAuthoringImages(manifest, files, before.figures)
      // a batch of existing figure documents can use the same metadata transaction.
      }, !input.imageResolutions?.length && [...updates].every(([name, bytes]) => bytes !== null && /^figures\/[0-9a-f-]+\.json$/.test(name)), undefined, input.dryRun === true, undefined, undefined, input.imageResolutions, input.avatarReplacements, input.imageRemovals)
    },
    savePackVoice(input) {
      validateShortId(input.voiceId, '$.voiceId')
      return edit(input, async (manifest, files, before) => {
        const library = manifest.voiceLibrary ||= {version:1,voices:{}}
        // the stored figures (the metadata path carries no figure bytes in files).
        const users = Object.values(before.figures).filter(f => f.voice?.voice === input.voiceId)
        check(!users.some(f => f.id !== input.figureId) || input.confirmShared === true, '$.confirmShared', 'Confirm shared voice users', 'SHARED_VOICE_CONFIRMATION_REQUIRED')
        library.voices[input.voiceId] = copy(input.voiceSpec)
        return {affectedFigures:users.map(f => ({id:f.id,name:f.name}))}
      // a change of metadata only (a source's serviceId, emotion labels) publishes without the pack's media.
      }, true)
    },
    saveFigureVoiceBinding(input) {
      return edit(input, async (manifest, files, before) => {
        const name = 'figures/' + input.figureId + '.json'
        check(manifest.figures.includes(input.figureId), '$.figureId', 'Figure missing', 'ASSET_UNAVAILABLE')
        const figure = copy(before.figures[input.figureId])
        if (input.binding === null) delete figure.voice; else figure.voice = copy(input.binding)
        retainVoiceEmotionPointers(figure,manifest)
        files.set(name,jsonBytes(figure))
      }, true)
    },
    createAndAssignPackVoice(input) {
      return edit(input, async (manifest, files) => {
        check(manifest.figures.includes(input.figureId), '$.figureId', 'Figure missing', 'ASSET_UNAVAILABLE')
        const library = manifest.voiceLibrary ||= {version:1,voices:{}}
        const voiceId = 'v-' + randomUUID()
        library.voices[voiceId] = copy(input.voiceSpec)
        const name = 'figures/' + input.figureId + '.json', figure = readDocument(files.get(name))
        figure.voice = {voice:voiceId}; retainVoiceEmotionPointers(figure,manifest); files.set(name,jsonBytes(figure))
        return {voiceId}
      })
    },
    // Host maintenance only: the caller must stop the profile while migrating its references.
    mergePacks(input) {
      validateUuid(input.sourcePackId); validateUuid(input.packId)
      check(input.sourcePackId !== input.packId, '$.sourcePackId', 'Choose distinct packs')
      return run([input.sourcePackId,input.packId], async () => {
        const source = await loadForExport(input.sourcePackId), before = await loadForExport(input.packId)
        cas(source,input.sourceRevision); cas(before,input.expectedRevision)
        check(source && before, '$', 'Both packs must exist', 'ASSET_UNAVAILABLE')
        const {pack, ...details} = await prepareMerge(source,before,input)
        const installed = await all()
        validatePackIdentities([...installed.filter(pack=>![input.packId,input.sourcePackId].includes(pack.manifest.id)).map(pack=>pack.manifest),pack.manifest])
        const retired = new Set(before.local.retired || [])
        for (const key of keys(pack)) check(!retired.has(key),'$.identity','Retired identity cannot be reused: '+key,'DUPLICATE_ID')
        const plan = {...details,contentHash:pack.manifest.contentHash,figures:pack.manifest.figures.length,assets:pack.manifest.assets.length}
        if (input.dryRun) return {status:'dry-run',...plan,...(input.includeSnapshot ? {snapshot:snapshot(pack)} : {})}
        const local = nextLocal(before.local)
        await storage.publish(input.packId,pack,local,before)
        // The offline command owns a full two-pack backup and writes a partial receipt on failure.
        await storage.publish(input.sourcePackId,null,nextLocal(source.local))
        evictMetadata(input.packId); evictMetadata(input.sourcePackId)
        emit({...pack,local},before); emit(null,source)
        return {status:'merged',revision:local.revision,...plan}
      },input.dryRun === true)
    },
    // Replace only unbound sources. The card commit is the durable decision for the whole pack batch.
    consolidatePacks(input) {
      const {packId, expectedRevision, sources, name, card, dryRun, approvedContentHash, assetNames = []} = input
      validateUuid(packId); validateUuid(expectedRevision)
      check(Array.isArray(sources) && sources.length >= 1 && sources.length <= 8,'$.sources','Choose installed source packs')
      for (const source of sources) {
        shape(source,['packId','expectedRevision'],['packId','expectedRevision'],'$.sources')
        validateUuid(source.packId); validateUuid(source.expectedRevision)
      }
      const sourceIds = sources.map(source=>source.packId), ids = new Set([packId,...sourceIds])
      check(ids.size === sources.length+1,'$.sources','Choose distinct packs')
      shape(card,['path','expectedRevision'],['path','expectedRevision'],'$.card')
      check(typeof card.path === 'string' && typeof card.expectedRevision === 'string' && card.expectedRevision.length > 0,'$.card')
      check(typeof name === 'string' && name.trim() && name.length <= 180,'$.name')
      check(typeof dryRun === 'boolean' && Array.isArray(assetNames),'$.dryRun')
      if (!dryRun) validateHash(approvedContentHash)
      const cards = options.cardTransactions
      return run([...ids],async()=>{
        const currentCard = await cards.snapshot({path:card.path})
        check(currentCard.raw && currentCard.revision === card.expectedRevision,'$.card','Card changed','REVISION_CONFLICT')
        const oldCardPacks = cards.inspectRaw(currentCard.raw).boundPackIds
        check(!oldCardPacks.some(id=>ids.has(id) && id !== packId),'$.card','Source still bound','REVISION_CONFLICT')
        const before = await loadForExport(packId); cas(before,expectedRevision)
        check(before && !isModConfigPack(before),'$.packId','Target must be a normal installed pack','ASSET_UNAVAILABLE')
        let pack = before, bytes
        const retire = [], mouthDebt = {...before.local.mouthDebt}, mappings = []
        for (const row of sources) {
          const source = await loadForExport(row.packId); cas(source,row.expectedRevision)
          check(source && !isModConfigPack(source) && !source.local.autoWrite && !source.local.stageSetupCardId,'$.sources','Only normal unbound packs may be consolidated','ASSET_UNAVAILABLE')
          await cards.requireUnboundPack({packId:row.packId})
          check(!options.globalEnabledPackIds?.().includes(row.packId),'$.sources','Source is enabled globally','REVISION_CONFLICT')
          const result = await prepareMerge(source,pack,{name,assetNames:sources.at(-1) === row ? assetNames : []})
          pack = result.pack; bytes = result.bytes; mappings.push(result.mapping)
          const debt = await readCopyMouthDebt(options.assetRoot,row.packId,source.local,options.mouthDebtRoot)
          Object.assign(mouthDebt,copiedMouthDebt(source,pack,source.manifest.figures.map(id=>({kind:'figures',fromId:id,toId:id})),debt))
          retire.push({source,entry:{removeId:row.packId,local:nextLocal(source.local)}})
        }
        const installed = await all()
        validatePackIdentities([...installed.filter(item=>!ids.has(item.manifest.id)).map(item=>item.manifest),pack.manifest])
        const retired = new Set(before.local.retired)
        for (const key of keys(pack)) check(!retired.has(key),'$.identity','Retired identity cannot be reused: '+key,'DUPLICATE_ID')
        const result = {packId,name,figures:pack.manifest.figures.length,assets:pack.manifest.assets.length,bytes,contentHash:pack.manifest.contentHash,sourceIds,card:card.path,mappings}
        if (dryRun) return {status:'dry-run',...result}
        check(result.contentHash === approvedContentHash,'$.approvedContentHash','Candidate differs from the verified pack','REVISION_CONFLICT')
        const local = nextLocal({...before.local,mouthDebt})
        await cards.withBoundPack({...card,packId},async transaction=>{
          await storage.publishMany([{pack,local},...retire.map(row=>row.entry)],transaction)
        })
        evictMetadata(packId); emit({...pack,local},before)
        for (const {source} of retire) { evictMetadata(source.manifest.id); emit(null,source) }
        return {status:'merged',revision:local.revision,...result}
      },dryRun)
    },
    // Host maintenance only, like mergePacks: figures keep their ids and change owner pack; the caller stops the profile and
    // rewrites the (pack, figure) references. Target first, then source; the offline command's backup covers an interruption.
    moveFigures(input) {
      validateUuid(input.sourcePackId); validateUuid(input.packId)
      check(input.sourcePackId !== input.packId, '$.sourcePackId', 'Choose distinct packs')
      return run([input.sourcePackId,input.packId], async () => {
        const source = await loadForExport(input.sourcePackId), before = await loadForExport(input.packId)
        cas(source,input.sourceRevision); cas(before,input.expectedRevision)
        check(source && before, '$', 'Both packs must exist', 'ASSET_UNAVAILABLE')
        const moved = moveFigureContents(source,before,input.figureIds), checks = []
        for (const [next,prior] of [[moved.to,before],[moved.from,source]]) {
          trimAuthoringImages(next.manifest,next.files,{...source.figures,...before.figures})
          await sealPack(next.manifest,next.files,prior,storedCopyHashes(next.files,[source,before]))
          budget(next.files,limits)
          const documents = {figures:Object.fromEntries(next.manifest.figures.map(id=>[id,readDocument(next.files.get('figures/'+id+'.json'))])),sprites:Object.fromEntries(Object.entries(next.manifest.sprites).map(([key,file])=>[key,readDocument(next.files.get(file))]))}
          validatePackDocuments({...documents,manifest:next.manifest}); checks.push({...documents,manifest:next.manifest,files:next.files})
        }
        const [target,remaining] = checks
        const installed = await all()
        validatePackIdentities([...installed.filter(pack=>![input.packId,input.sourcePackId].includes(pack.manifest.id)).map(pack=>pack.manifest),target.manifest,remaining.manifest])
        const retired = new Set(before.local.retired || [])
        for (const key of keys(target)) check(!retired.has(key),'$.identity','Retired identity cannot be reused: '+key,'DUPLICATE_ID')
        const sourceRetired = new Set(source.local.retired || []), nextSourceKeys = keys(remaining)
        for (const key of keys(source)) if (!nextSourceKeys.has(key)) sourceRetired.add(key)
        const debt = Object.fromEntries(input.figureIds.filter(id => source.local.mouthDebt?.[id]).map(id => [id,source.local.mouthDebt[id]]))
        const sourceDebt = {...source.local.mouthDebt}; for (const id of input.figureIds) delete sourceDebt[id]
        const plan = {mapping:moved.mapping,figures:input.figureIds.length,sourceFigures:remaining.manifest.figures.length,targetFigures:target.manifest.figures.length}
        if (input.dryRun) return {status:'dry-run',...plan,...(input.includeSnapshot ? {snapshots:{source:snapshot({...remaining,local:source.local}),target:snapshot({...target,local:before.local})}} : {})}
        const targetLocal = nextLocal({...before.local,mouthDebt:{...before.local.mouthDebt,...debt}}), sourceLocal = nextLocal({...source.local,mouthDebt:sourceDebt},[...sourceRetired].sort())
        await storage.publish(input.packId,target,targetLocal,before)
        await storage.publish(input.sourcePackId,remaining,sourceLocal,source)
        evictMetadata(input.packId); evictMetadata(input.sourcePackId)
        emit({...target,local:targetLocal},before); emit({...remaining,local:sourceLocal},source)
        return {status:'moved',revisions:{source:sourceLocal.revision,target:targetLocal.revision},...plan}
      },input.dryRun === true)
    },
    removePack(input) {
      validateUuid(input.packId)
      return run([input.packId], async () => {
        const before = await metadata(input.packId); cas(before, input.expectedRevision)
        check(before, '$', 'Pack missing', 'ASSET_UNAVAILABLE')
        return removeInstalledPack(before)
      })
    },
    putBlob(input) {
      const bytes = Buffer.from(input.bytes), descriptor = copy(input.descriptor)
      check(!descriptor.mime?.startsWith('image/'), '$.descriptor', 'Images must be bound atomically with patchPack; standalone image staging is not installed')
      return edit(input, async (manifest, files, before, hashed) => {
        const hash = await sha256(bytes)
        check(!manifest.blobs[hash] || canonicalJson(manifest.blobs[hash]) === canonicalJson(descriptor), '$.blob', 'Conflicting hash descriptor')
        manifest.blobs[hash] = descriptor; files.set(`media/${hash}.${descriptor.ext}`, bytes); hashed.set(`media/${hash}.${descriptor.ext}`, hash)
        return {hash, descriptor}
      })
    },
    copyFigure(input) {
      validateFigureRef(input.source)
      let carried
      return edit(input.target, async (manifest, files, _before, hashed) => {
        const source = await load(input.source.packId)
        // the copy takes the source figure's 配图 外貌 along; the host gives it a record of its own
        const extension = (await figureImageExtras(options, input.source.packId, [input.source.figureId]))[input.source.figureId]
        const result = copyFigureAssets(source, input.source.figureId, manifest, files, {extensions:extension ? {[FIGURE_IMAGE_EXTENSION]:extension} : {}})
        if (extension) await carryFigureImageMedia(options, input.source.packId, {[input.source.figureId]:extension}, manifest, files, hashed)
        const debt = await readCopyMouthDebt(options.assetRoot,source.manifest.id,source.local,options.mouthDebtRoot)
        carried = copiedMouthDebt(source,{figures:{[result.figureId]:source.figures[input.source.figureId]},sprites:source.sprites},[{kind:'figures',fromId:input.source.figureId,toId:result.figureId}],debt)
        for (const [name,digest] of storedCopyHashes(files,[source])) hashed.set(name,digest)
        return result
      },false,local => ({...local,mouthDebt:{...local.mouthDebt,...carried}}))
    },
    async reconcileCopiedMouthDebt(input) {
      validateFigureRef(input.source)
      validateUuid(input.figureId)
      validateUuid(input.sourceRevision)
      check(input.packId !== input.source.packId || input.figureId !== input.source.figureId,'$.source','Reconciliation requires an independent copied figure')
      let carried
      const result = await edit(input,async (_manifest,_files,before) => {
        const source = await metadata(input.source.packId)
        cas(source,input.sourceRevision)
        check(source?.figures[input.source.figureId] && before.figures[input.figureId],'$.figureId','Figure missing','ASSET_UNAVAILABLE')
        const debt = await readCopyMouthDebt(options.assetRoot,source.manifest.id,source.local,options.mouthDebtRoot)
        carried = copiedMouthDebt(source,before,[{kind:'figures',fromId:input.source.figureId,toId:input.figureId}],debt)
      },true,local => ({...local,mouthDebt:{...local.mouthDebt,...carried}}),input.dryRun === true)
      return {...result,carriedGaps:carried[input.figureId]?.gaps.length || 0}
    },
    // Publish standalone skins without bringing along the source pack's skin-specific performances.
    publishSkins(input) {
      shape(input, ['packId','expectedRevision','sources','dryRun'], ['packId','expectedRevision','sources'], '$')
      check(input.dryRun === undefined || typeof input.dryRun === 'boolean', '$.dryRun')
      check(Array.isArray(input.sources) && input.sources.length && input.sources.length <= 64, '$.sources')
      const ids = new Set(), sourcePackIds = input.sources.map(row => {
        shape(row, ['packId','expectedRevision','skinIds','replace'], ['packId','expectedRevision','skinIds'], '$.sources[]')
        return validateUuid(row.packId)
      })
      return edit(input, async (manifest, files, before, hashed) => {
        const replacedFiles = [], published = []
        for (const row of input.sources) {
          check(row.packId !== input.packId && Array.isArray(row.skinIds) && row.skinIds.length && row.skinIds.length <= 64, '$.sources[]')
          check(row.replace === undefined || Array.isArray(row.replace) && row.replace.every(id => row.skinIds.includes(id)), '$.sources[].replace')
          const source = await metadata(row.packId, 'manifest')
          cas(source, row.expectedRevision)
          check(source && !isModConfigPack(source), '$.sources[].packId', 'Source pack unavailable', 'ASSET_UNAVAILABLE')
          for (const id of row.skinIds) {
            validateShortId(id)
            check(!ids.has(id), '$.sources[].skinIds', 'Duplicate skin ID', 'DUPLICATE_ID'); ids.add(id)
            const entry = source.manifest.assets.find(a => a.kind === 'skins' && a.id === id)
            check(entry?.bundleKey && entry.entry, '$.sources[].skinIds', 'Skin missing', 'ASSET_UNAVAILABLE')
            const index = manifest.assets.findIndex(a => a.kind === 'skins' && a.id === id), old = manifest.assets[index]
            const origin = {packId:row.packId, kind:'skins', assetId:id}
            const recorded = old?.extensions?.dsh_tavern?.copiedFrom
            check(!old || recorded?.packId === row.packId && recorded.assetId === id || !recorded && row.replace?.includes(id), '$.sources[].skinIds', 'Skin already has a different source', 'REVISION_CONFLICT')
            const bundleKey = old?.bundleKey || entry.bundleKey, bundle = source.manifest.bundles[entry.bundleKey]
            check(old || !Object.hasOwn(manifest.bundles, bundleKey), '$.sources[].skinIds', 'Bundle key already exists', 'DUPLICATE_ID')
            const {credits, extensions, ...sourceEntry} = entry
            const next = {...sourceEntry,bundleKey,extensions:{dsh_tavern:{copiedFrom:origin}}}
            if (index < 0) manifest.assets.push(next); else manifest.assets[index] = next
            if (manifest.bundles[bundleKey]?.contentHash !== bundle.contentHash) {
              const prefix = `bundles/${bundleKey}/`, sourcePrefix = `bundles/${entry.bundleKey}/`
              for (const name of files.keys()) if (name.startsWith(prefix)) {
                replacedFiles.push(name); files.delete(name)
              }
              for (const file of source.manifest.files) if (file.path.startsWith(sourcePrefix)) {
                const name = prefix + file.path.slice(sourcePrefix.length)
                files.set(name, await storage.read(`packs/${row.packId}/${file.path}`, file.size))
                hashed.set(name, file.sha256)
              }
              manifest.bundles[bundleKey] = copy(bundle)
            }
            published.push({id, contentHash:bundle.contentHash, source:origin})
          }
        }
        return {published,replacedFiles}
      }, false, undefined, input.dryRun === true, undefined, undefined, undefined, undefined, undefined, sourcePackIds)
    },
    // items of any kind plus their same-pack closure, into an existing pack (CAS) or a new one.
    copyItems(input) {
      validateUuid(input.sourcePackId)
      const target = input.target, fresh = target && Object.hasOwn(target, 'newPackName')
      check(target && Object.keys(target).sort().join() === (fresh ? 'newPackName' : 'expectedRevision,packId'), '$.target', 'Target is {packId, expectedRevision} or {newPackName}')
      const packId = fresh ? randomUUID() : validateUuid(target.packId)
      check(packId !== input.sourcePackId, '$.target', 'Copy into another pack')
      return run([input.sourcePackId, packId], async () => {
        const source = await load(input.sourcePackId)
        check(source, '$.sourcePackId', 'Pack missing', 'ASSET_UNAVAILABLE')
        const before = fresh ? null : await load(packId)
        if (!fresh) { cas(before, target.expectedRevision); check(before, '$.target.packId', 'Pack missing', 'ASSET_UNAVAILABLE') }
        const manifest = before ? copy(before.manifest) : {format:'dsh-asset-pack', schemaVersion:1, id:packId, name:target.newPackName, contentHash:'0'.repeat(64), assets:[], figures:[], sprites:{}, bundles:{}, blobs:{}, files:[]}
        const files = new Map(before?.files || [])
        // copied figures take their 配图 外貌 along; the host gives each a record of its own
        const extras = await figureImageExtras(options, source.manifest.id, input.itemRefs.filter(ref => ref.kind === 'figures').map(ref => ref.id))
        const copied = copyPackItems(source, input.itemRefs, manifest, files, new Set(before?.local.retired || []), Object.fromEntries(Object.entries(extras).map(([id, extension]) => [id, {[FIGURE_IMAGE_EXTENSION]:extension}])))
        const hashed = storedCopyHashes(files,[source])
        await carryFigureImageMedia(options, source.manifest.id, extras, manifest, files, hashed)
        await sealPack(manifest, files, before, hashed)
        const verified = await verify(manifest, files, before, true)
        const debt = await readCopyMouthDebt(options.assetRoot,source.manifest.id,source.local,options.mouthDebtRoot)
        const carried = copiedMouthDebt(source,verified,copied,debt)
        const result = await install(verified, before, undefined, false, undefined, carried)
        return {packId, revision:result.snapshot.revision, copied}
      })
    },
    createSimpleSprite(input) {
      validateShortId(input.spriteKey)
      return edit(input, async (manifest, files) => {
        const sprite = createSimpleSprite(input, manifest.blobs)
        const path = `sprites/${input.spriteKey}/manifest.json`
        manifest.sprites[input.spriteKey] = path
        files.set(path, jsonBytes(sprite.manifest))
        return {sprite:{manifestKey:input.spriteKey, assets:sprite.assets}}
      })
    },
    removeBlob(input) {
      validateHash(input.hash)
      return edit(input, async (manifest, files) => {
        const descriptor = manifest.blobs[input.hash]; check(descriptor, '$.hash', 'Blob missing', 'ASSET_UNAVAILABLE')
        delete manifest.blobs[input.hash]; files.delete(`media/${input.hash}.${descriptor.ext}`)
      })
    },
    putBundle(input) {
      validateShortId(input.bundleKey)
      const additions = cloneFiles(input.files), descriptor = copy(input.descriptor)
      return edit(input, async (manifest, files) => {
        const prefix = `bundles/${input.bundleKey}/`
        for (const name of files.keys()) if (name.startsWith(prefix)) files.delete(name)
        for (const [name, bytes] of additions) { budget(new Map([[name,bytes]]), limits); files.set(prefix + name, bytes) }
        manifest.bundles[input.bundleKey] = {...descriptor, contentHash:'0'.repeat(64)}
      })
    },
    removeBundle(input) {
      validateShortId(input.bundleKey)
      return edit(input, async (manifest, files) => {
        delete manifest.bundles[input.bundleKey]
        for (const name of files.keys()) if (name.startsWith(`bundles/${input.bundleKey}/`)) files.delete(name)
      })
    },
    // Host-only delivery: figures, voices and optional reference audio share one CAS transaction.
    deliverFigures(input) {
      const delivery = input.delivery
      shape(delivery, ['version', 'figures', 'voices', 'audio'], ['version', 'figures'], '$.delivery')
      check(delivery.version === 1 && Array.isArray(delivery.figures) && delivery.figures.length > 0, '$.delivery')
      check(input.dryRun === undefined || typeof input.dryRun === 'boolean', '$.dryRun')
      return edit(input, async (manifest, files, before, hashed) => {
        if (delivery.audio !== undefined) {
          check(Array.isArray(delivery.audio), '$.delivery.audio')
          const seen = new Set()
          for (const item of delivery.audio) {
            shape(item, ['hash', 'descriptor', 'bytes'], ['hash', 'descriptor', 'bytes'], '$.delivery.audio[]')
            validateHash(item.hash)
            check(!seen.has(item.hash), '$.delivery.audio', 'Duplicate audio attachment', 'DUPLICATE_ID'); seen.add(item.hash)
            check(item.bytes instanceof Uint8Array && item.descriptor?.mime?.startsWith('audio/'), '$.delivery.audio', 'Only reference audio attachments are accepted')
            const bytes = Buffer.from(item.bytes), descriptor = copy(item.descriptor)
            check(await sha256(bytes) === item.hash, '$.delivery.audio', 'Audio content identity mismatch', 'HASH_MISMATCH')
            check(!manifest.blobs[item.hash] || canonicalJson(manifest.blobs[item.hash]) === canonicalJson(descriptor), '$.delivery.audio', 'Conflicting hash descriptor')
            const name = `media/${item.hash}.${descriptor.ext}`
            manifest.blobs[item.hash] = descriptor; files.set(name, bytes); hashed.set(name, item.hash)
          }
        }
        const rows = Object.values(before.figures).map(figure => ({actorKey:figure.id, name:figure.name, aliases:figure.aliases, ref:{packId:input.packId,figureId:figure.id}}))
        const seen = new Set()
        for (const entry of delivery.figures) {
          shape(entry, ['id', 'copyFrom', 'figure', 'patch'], ['id'], '$.delivery.figures[]')
          validateUuid(entry.id)
          check(!seen.has(entry.id), '$.delivery.figures[].id', 'Duplicate delivery figure', 'DUPLICATE_ID'); seen.add(entry.id)
          const target = figureResolution.resolveFigureName(rows, {packId:input.packId,figureId:entry.id})
          const existing = target.status === 'resolved' ? before.figures[target.ref.figureId] : undefined
          check(!(entry.copyFrom !== undefined && entry.figure !== undefined), '$.delivery.figures[]', 'Choose copyFrom or figure')
          let figure = existing
          if (entry.copyFrom !== undefined) {
            const source = figureResolution.resolveFigureName(rows, entry.copyFrom)
            check(source.status === 'resolved', '$.delivery.figures[].copyFrom', 'Source figure missing', 'ASSET_UNAVAILABLE')
            figure = before.figures[source.ref.figureId]
          } else if (entry.figure !== undefined) figure = entry.figure
          check(figure, '$.delivery.figures[]', 'New figures need copyFrom or figure', 'ASSET_UNAVAILABLE')
          const patch = entry.patch || {}
          shape(patch, ['name', 'aliases', 'description', 'enabled', 'recall', 'voice'], [], '$.delivery.figures[].patch')
          figure = {...copy(figure), ...copy(patch), id:entry.id}
          if (figure.aliases !== undefined) figure.aliases = normalizeFigureAliases(figure.name, figure.aliases)
          if (!existing) manifest.figures.push(entry.id)
          files.set(`figures/${entry.id}.json`, jsonBytes(figure))
        }
        if (delivery.voices !== undefined) {
          shape(delivery.voices, Object.keys(delivery.voices), [], '$.delivery.voices')
          manifest.voiceLibrary = {...(manifest.voiceLibrary || {version:1}), voices:{...manifest.voiceLibrary?.voices, ...copy(delivery.voices)}}
        }
      }, false, undefined, input.dryRun === true)
    },
    createFigure(input) {
      return edit(input, async (manifest, files) => createFigure(manifest, files, input))
    },
    // The records of these figures are going away or linking elsewhere: each figure takes the identity its record gave it
    // (what readers see now) into its own document, in the same save as the record's (ADR 0011).
    releaseFigureIdentities(releases, receipt, save) {
      const groups = Map.groupBy(releases, release => release.packId)
      return run([...groups.keys()], async () => {
        const entries = []
        for (const [id, edits] of groups) {
          validateUuid(id)
          const before = await metadata(id)
          // a record whose figure is gone already ends a link to nothing
          if (!before) continue
          const manifest = copy(before.manifest), figures = {...before.figures}, updates = new Map(), intents = new Map()
          for (const {figureId} of edits) {
            validateUuid(figureId)
            if (!figures[figureId]) continue
            intents.set(figureId, 'released')
            updates.set('figures/' + figureId + '.json', jsonBytes(figures[figureId]))
          }
          if (!updates.size) continue
          validatePackDocuments({manifest, figures, sprites:before.sprites})
          manifest.files = await Promise.all(manifest.files.map(async file => {
            const bytes = updates.get(file.path)
            return bytes ? {path:file.path, size:bytes.length, sha256:await sha256(bytes)} : file
          }))
          manifest.contentHash = await computeContentHash(manifest)
          check([...updates.values()].every(bytes => bytes.length <= limits.entrySize)
            && jsonBytes(manifest).length + manifest.files.reduce((sum, file) => sum + file.size, 0) <= limits.totalSize, '$.files', 'Pack budget exceeded', 'LIMIT_EXCEEDED')
          const local = nextLocal(before.local)
          entries.push({id, manifest, figures, updates, local, before, intents})
        }
        const result = await storage.publishMetadataBatch(entries, receipt, () => save())
        for (const {id, manifest, figures, local, before} of entries) {
          evictMetadata(id)
          emit({...before, manifest, figures, local}, before)
        }
        return result
      })
    },
    // The host's character records changed outside a pack write (a 人物库 edit): these packs' figures read again.
    // packIds omitted: every installed pack (a 人物库 came or went).
    async figureRecordsChanged({packIds} = {}) {
      const ids = packIds ?? await readRun([], () => storage.listIds())
      return readRun(ids, async () => {
        for (const id of ids) {
          recordGenerations.set(id, (recordGenerations.get(id) || 0) + 1)
          evictMetadata(id)
          const bytes = await storage.read(`packs/${id}/manifest.json`), local = bytes && await storage.local(id)
          const figures = bytes ? readDocument(bytes).figures : []
          if (figures.length) for (const listener of storage.subscribers) { try { listener({packId:id, revision:local.revision, kinds:[], figures:[...figures]}) } catch { /* observers cannot fail a read */ } }
        }
      })
    },
    // Read-only: how each installed figure is stored (whole, or without its identity), per pack with figures.
    figureDocumentForms() {
      return readRun([], async () => {
        const rows = []
        for (const packId of await storage.listIds()) {
          const forms = await storage.figureForms(packId)
          if (forms.whole.length || forms.withoutIdentity.length) rows.push({packId, ...forms})
        }
        return rows
      })
    },
    // Writes every figure document of these packs again, as the host's figureRecords stores them now (switching where a
    // figure's identity is kept, and back). The figures readers see do not change.
    rewriteFigureDocuments({packIds}) {
      return run(packIds, async () => {
        const rewritten = []
        for (const id of packIds) {
          validateUuid(id)
          const before = await metadata(id)
          check(before, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
          if (!before.manifest.figures.length) continue
          const updates = new Map(before.manifest.figures.map(figureId => ['figures/' + figureId + '.json', before.documents.get('figures/' + figureId + '.json')]))
          // the stored manifest, not the read projection (which hides unavailable optional items)
          const manifest = readDocument(await storage.read(`packs/${id}/manifest.json`))
          await storage.freshen(manifest, before.documents)
          const local = nextLocal(before.local)
          await storage.publishMetadata(id, manifest, updates, local)
          evictMetadata(id)
          emit({...before, local}, before)
          rewritten.push({packId:id, figures:before.manifest.figures.length})
        }
        return {rewritten}
      })
    },
    patchFigure(input) {
      validateUuid(input.figureId)
      const patch = copy(input.patch)
      return edit(input, async (manifest, files, before) => {
        const figure = patchFigureDocument(before.figures[input.figureId], patch)
        files.set(`figures/${input.figureId}.json`, jsonBytes(figure))
        trimAuthoringImages(manifest, files, before.figures)
      }, true)
    },
    // manual avatar crop (card-centric-ux.md §6.8), in whatever pack the figure lives in.
    // scope 'outfit' sets outfit.avatarCrop and drops per-state manual crops, scope 'state' sets one state;
    // crop null resets that scope to the automatic crop. Auto crops are never rewritten.
    setFigureAvatarCrop(input) {
      validateUuid(input.packId); validateUuid(input.figureId); validateShortId(input.outfitKey, '$.outfitKey')
      check(input.scope === 'outfit' || input.scope === 'state', '$.scope', 'Scope must be outfit or state')
      if (input.scope === 'state') validateStateId(input.stateId, '$.stateId')
      const crop = input.crop === null ? null : copy(input.crop)
      if (crop !== null) {
        check(crop && typeof crop === 'object' && !Array.isArray(crop) && Object.keys(crop).sort().join() === 'h,w,x,y', '$.crop', 'Crop must be {x,y,w,h}')
        for (const key of ['x','y','w','h']) { check(Number.isFinite(crop[key]), '$.crop.' + key, 'Crop must be finite'); crop[key] = Math.round(crop[key] * 1e5) / 1e5 }
      }
      return edit(input, async (manifest, files, before) => {
        const figure = before.figures[input.figureId]
        check(figure, '$.figureId', 'Figure missing', 'ASSET_UNAVAILABLE')
        const index = figure.outfits.findIndex(outfit => outfit.key === input.outfitKey)
        check(index >= 0 && figure.outfits[index].sprite, '$.outfitKey', 'Outfit has no static sprite', 'ASSET_UNAVAILABLE')
        const outfit = copy(figure.outfits[index]), manual = {...(outfit.sprite.avatarCrop || {})}
        if (input.scope === 'outfit') {
          if (crop) outfit.avatarCrop = crop; else delete outfit.avatarCrop
          for (const key of Object.keys(manual)) delete manual[key]
        } else if (crop) manual[input.stateId] = crop
        else delete manual[input.stateId]
        if (Object.keys(manual).length) outfit.sprite.avatarCrop = manual; else delete outfit.sprite.avatarCrop
        const next = {...figure, outfits:figure.outfits.map((item, i) => i === index ? outfit : item)}
        files.set(`figures/${input.figureId}.json`, jsonBytes(next))
      }, true)
    },
    setFigureEmotionFallback(input) {
      validateUuid(input.figureId);validateShortId(input.outfitKey,'$.outfitKey');
      check(typeof input.enabled==='boolean','$.enabled','Expected boolean');
      return edit(input, (_manifest,files,before)=>{
        const figure=copy(before.figures[input.figureId]);
        check(figure,'$.figureId','Figure missing','ASSET_UNAVAILABLE');
        const outfit=figure.outfits.find(o=>o.key===input.outfitKey);
        check(outfit,'$.outfitKey','Outfit missing','ASSET_UNAVAILABLE');
        const emotion=matchBubbleMood(input.emotionId,figure.emotions || [])?.id;
        check(emotion && emotion!==figureDefaultEmotion(figure,outfit),'$.emotionId','Expected a non-default figure emotion','INVALID_MANIFEST');
        // `use` names the 差分 that stands in (缺图时用), through the same resolver; the
        // default (or none) clears it, so the marked 差分 shows the default as before.
        const use=input.enabled && input.use != null ? matchBubbleMood(input.use,figure.emotions || [])?.id : null;
        check(input.use == null || !input.enabled || use && use!==emotion,'$.use','Expected another figure emotion','INVALID_MANIFEST');
        const marks=new Set(outfit.fallbackEmotions || []),to={...(outfit.fallbackTo || {})};
        if(input.enabled) marks.add(emotion); else marks.delete(emotion);
        if(use && use!==figureDefaultEmotion(figure,outfit)) to[emotion]=use; else delete to[emotion];
        if(marks.size) outfit.fallbackEmotions=[...marks]; else delete outfit.fallbackEmotions;
        if(Object.keys(to).length) outfit.fallbackTo=to; else delete outfit.fallbackTo;
        files.set('figures/'+input.figureId+'.json',jsonBytes(figure));
      },true);
    },
    removeFigureEmotion(input) {
      validateUuid(input.figureId); validateStateId(input.emotionId, '$.emotionId')
      return edit(input, (manifest, files, before) => removeFigureEmotion(manifest, files, before, input.figureId, input.emotionId))
    },
    removeFigure(input) {
      validateUuid(input.figureId)
      return edit(input, async (manifest, files, before) => {
        check(manifest.figures.includes(input.figureId), '$.figureId', 'Figure missing', 'ASSET_UNAVAILABLE')
        manifest.figures = manifest.figures.filter(id => id !== input.figureId); files.delete(`figures/${input.figureId}.json`)
        trimAuthoringImages(manifest, files, before.figures)
        retireFigureBundles(manifest, files, [before.figures[input.figureId]], manifest.figures.map(id => before.figures[id]))
      })
    },
    resolveAssets:({refs}) => readRun(refs.map(ref => { validateAssetRef(ref); return ref.packId }), async () => {
      const result = [], packs = new Map(), ids = [...new Set(refs.map(ref => ref.packId))]
      let next = 0
      // Independent packs share the publication gate; drain reads before releasing it.
      const reads = await Promise.allSettled(Array.from({length:Math.min(8, ids.length)}, async () => {
        while (next < ids.length) {
          const id = ids[next++]
          packs.set(id, await metadata(id, 'manifest'))
        }
      }))
      const failed = reads.find(read => read.status === 'rejected')
      if (failed) throw failed.reason
      for (const ref of refs) {
        const pack = packs.get(ref.packId)
        result.push(resolveAssetSnapshot(pack && {...pack,revision:pack.local.revision},ref))
      }
      return result
    }),
    resolveFigures:({refs}) => readRun(refs.map(ref => { validateFigureRef(ref); return ref.packId }), async () => {
      const result = [], packs = new Map()
      for (const ref of refs) {
        if (!packs.has(ref.packId)) packs.set(ref.packId, await metadata(ref.packId))
        const pack = packs.get(ref.packId)
        result.push(resolveFigureSnapshot(pack && {...pack,revision:pack.local.revision},ref))
      }
      return result
    }),
    async inspectImportFile({file, copy}) {
      return service.inspectImport({copy, [REMOTE_ARCHIVE]:await archiveFile(file)})
    },
    async inspectCardBundleFile({file, path}) {
      return service.inspectCardBundle({path, [REMOTE_ARCHIVE]:await localArchive(file)})
    },
    inspectImport(input) {
      const remote = input[REMOTE_ARCHIVE]
      check(remote || input.bytes instanceof Uint8Array && input.bytes.length <= limits.spoolBytes, '$.bytes', 'Archive exceeds spool budget', 'LIMIT_EXCEEDED')
      const bytes = remote ? null : Buffer.from(input.bytes)
      return run([], async () => {
        sweep(); check(previewCount() + cardBundleUsage().count < limits.previews, '$', 'Preview limit exceeded', 'LIMIT_EXCEEDED')
        const read = await readArchive(bytes, remote)
        try { return await inspectRead(read) } finally { await read.spool.release() }
      })
      async function inspectRead(read) {
        const installed = await all()
        // One hash per transfer: a downloaded archive's own digest, else the uploaded bytes once (shared by a set's packs).
        const uploadHash = remote?.archiveSha256 || await sha256(bytes), options = {remote:remote?.local ? undefined : remote, uploadHash, installed, copyOnly:input.copy === true, spool:read.spool}
        if (!read.set) return copy(await inspectPack(read.pack, options))
        // a 素材包合集 — one ordinary preview per pack, each confirmed and applied on its own
        // (applyImport); discarding the set's inspectionId drops every pack still pending. A catalogue entry is one pack.
        check(!remote?.source, '$.packId', 'Catalogue entry is not a pack set', 'INTEGRITY_MISMATCH')
        const setId = randomUUID(), packs = []
        try { for (const pack of read.set) packs.push(await inspectPack(pack, {...options, setId})) }
        catch (error) { dropSet(setId); throw error }
        return copy({kind:'pack-set', inspectionId:setId, uploadHash, expiresAt:Math.min(...packs.map(p => p.expiresAt)), packs})
      }
    },
    applyImport(input) {
      return run([], async () => {
        sweep(); const entry = previews.get(input.inspectionId)
        check(entry, '$.inspectionId', 'Import preview expired', 'ASSET_UNAVAILABLE')
        check(entry.preview.choices.includes(input.decision), '$.decision', 'Explicit preview decision required')
        if (input.decision === 'cancel') { await forget(input.inspectionId); return {status:'cancelled'} }
        const before = await metadata(entry.pack.manifest.id)
        cas(before || {local:await storage.local(entry.pack.manifest.id)}, input.expectedRevision, entry.pack.manifest)
        check(input.expectedRevision === entry.preview.expectedRevision, '$.expectedRevision', 'Preview revision changed', 'REVISION_CONFLICT')
        check(input.decision === 'noop' || !entry.preview.scriptRisk.length || input.acceptScriptRisk === true,'$.acceptScriptRisk','Accept or cancel this import script risk','SCRIPT_CONFIRMATION_REQUIRED')
        const adopt = input.adoptLooks ?? []
        const updating = ['update','merge'].includes(input.decision)
        check(Array.isArray(adopt) && (!adopt.length || updating) && new Set(adopt).size === adopt.length && adopt.every(id => entry.preview.figureLooks.some(row => row.figureId === id)), '$.adoptLooks', 'Adopted looks must be figures the update preview lists')
        let candidate = input.decision === 'keep-both' ? entry.keep : entry.pack
        // 增量更新 keeps the local 启用 / 召回词 / 别名 (a catalogue download merged them at inspection) and the entries only the installed version has.
        if (input.decision === 'merge') {
          const merged = entry.distribution ? candidate : (await mergeMetadata(candidate, before, before.local.distribution?.baseMetadata)).pack
          candidate = await withRemovedEntries(merged, before, {verify, read:(name, size) => storage.read(`packs/${before.manifest.id}/${name}`, size)})
        }
        if (input.createFigures !== undefined) {
          check(before && ['update','noop'].includes(input.decision) && Array.isArray(input.createFigures), '$.createFigures', 'Figure creation requires an installed-pack update')
          const added = candidate.manifest.figures.filter(id => !before.manifest.figures.includes(id))
          check(new Set(input.createFigures).size === input.createFigures.length && added.length === input.createFigures.length && added.every(id => input.createFigures.includes(id)), '$.createFigures', 'Explicit added figure identities must match the import')
          // Use the native creation path on the candidate, then publish once under the import CAS.
          const manifest = copy(candidate.manifest), files = new Map(candidate.files)
          manifest.figures = manifest.figures.filter(id => !added.includes(id))
          for (const id of added) {
            const name = `figures/${id}.json`, bytes = files.get(name)
            createFigure(manifest, files, {id,figure:candidate.figures[id]})
            check(canonicalJson(readDocument(files.get(name))) === canonicalJson(readDocument(bytes)), '$.createFigures', 'Native creation changed the reviewed figure')
            files.set(name, bytes)
          }
          check(canonicalJson(manifest.figures) === canonicalJson(candidate.manifest.figures), '$.createFigures', 'New figures must follow existing figures')
          candidate = {...candidate,manifest,files}
        }
        // The host learns which figures take the incoming 外貌 before the write it follows; a failed write takes the choice back.
        const adopting = updating && options.adoptFigureImageLooks
        if (adopting) await options.adoptFigureImageLooks({packId:entry.pack.manifest.id, figureIds:adopt})
        let result
        try { result = input.decision === 'noop' ? {status:'noop',snapshot:snapshot(before)} : await install(candidate, input.decision === 'keep-both' ? null : before, input.decision === 'keep-both' ? null : entry.distribution) }
        catch (error) { if (adopting && adopt.length) await options.adoptFigureImageLooks({packId:entry.pack.manifest.id, figureIds:[]}); throw error }
        await forget(input.inspectionId)
        return {...result, ...(input.decision === 'keep-both' ? {mapping:copy(entry.preview.mapping)} : {})}
      })
    },
    // `progress` ({onProgress}) is a local option of the host transport, never RPC input: onProgress({done,total}) in
    // input bytes while the archive is written (the browser's export progress bar).
    exportPack(input, progress = {}) {
      validateUuid(input.packId)
      return (options.privateExportFile ? readRun : run)([input.packId], async () => {
        let pack = await loadForExport(input.packId); cas(pack, input.expectedRevision)
        check(pack, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
        // Only a local service constructor can select a private destination, never RPC input.
        if (!options.privateExportFile) await assertPublicPackChain(pack, metadata)
        pack = await exportPrivacyView(await withFigureImageExtras(pack, options))
        const warnings = await exportWarnings(pack)
        const write = async file => {
          const entries = [{path:'manifest.json',data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([path,data]) => ({path,data,file:data.file}))]
          await writeZip(file, entries, zipProgress(entries, progress.onProgress))
          const archive = options.privateExportFile ? {output:file} : await exportArchive(file)
          return {...archive, contentHash:pack.manifest.contentHash, revision:pack.local.revision, filename:pack.manifest.id + '.zip',warnings}
        }
        return options.privateExportFile ? write(options.privateExportFile) : storage.temporary(write)
      }, !!options.privateExportFile)
    },
    // the 素材库's batch export — two or more whole packs, each through the
    // exportPack checks (CAS, public chain, layered export), in bounded 素材包合集 volumes. A widget default pointing into another
    // pack of the same set is carried, so it is no warning.
    exportPacks(input, progress = {}) {
      check(input && Object.keys(input).every(key => key === 'packs') && Array.isArray(input.packs) && input.packs.length > 1, '$.packs', 'Two or more packs required')
      for (const item of input.packs) check(item && Object.keys(item).every(key => ['packId','expectedRevision'].includes(key)), '$.packs', 'Unknown export field', 'UNKNOWN_FIELD')
      const ids = input.packs.map(item => validateUuid(item.packId))
      check(new Set(ids).size === ids.length, '$.packs', 'Duplicate pack', 'DUPLICATE_ID')
      return run(ids, async () => {
        const declared = [], warnings = [], archives = [], exported = []
        for (const item of input.packs) {
          const pack = await metadata(item.packId); cas(pack, item.expectedRevision)
          check(pack, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
          await assertPublicPackChain(pack, metadata)
          warnings.push(...await exportWarnings(pack, ids))
          declared.push({...pack, files:new Map(pack.manifest.files.map(file => [file.path, {length:file.size}]))})
        }
        // Partition declarations before loading media: memory scales with one volume, not the library.
        const groups = partitionPackSets(declared, {bytes:Math.min(options.collectionBytes || COLLECTION_BYTES, limits.totalSize), entries:limits.entries})
        const total = declared.reduce((sum, pack) => sum + pack.manifest.files.reduce((n, file) => n + file.size, 0), 0)
        let before = 0
        try {
          for (const group of groups) {
            const packs = []
            for (const item of group) packs.push(await exportPrivacyView(await withFigureImageExtras(await loadForExport(item.manifest.id), options)))
            const files = packs.length === 1 ? new Map([['manifest.json',jsonBytes(packs[0].manifest)], ...packs[0].files]) : packSetFiles(packs)
            exported.push(...packs.map(pack => ({packId:pack.manifest.id, contentHash:pack.manifest.contentHash, revision:pack.local.revision})))
            archives.push(await storage.temporary(async file => {
              const entries = [...files].map(([path,data]) => ({path,data,file:data.file}))
              await writeZip(file, entries, {onProgress:progress.onProgress && (done => progress.onProgress({done:Math.min(total, before + done), total}))})
              before += entries.reduce((sum, entry) => sum + entry.data.length, 0)
              const archive = await exportArchive(file)
              return {...archive, filename:groups.length === 1 ? 'asset-packs-' + ids.length + '.zip' : '\u7d20\u6750\u5305\u5408\u96c6-' + (archives.length + 1) + 'of' + groups.length + '.zip'}
            }))
          }
          return {...(archives.length === 1 ? archives[0] : {archives}), packs:exported, warnings}
        } catch (error) {
          for (const archive of archives) await archive.dispose?.()
          throw error
        }
      })
    },
    // Host-only projection of already validated, skin-owned option media.
    readSkinAsset({ref,assetKey,expectedRevision}) {
      return readRun([ref.packId],async()=>{
        const pack=await metadata(ref.packId),asset=pack?.manifest.assets.find(row=>row.kind==='skins' && row.id===ref.assetId),content=asset && assetContent(asset)
        check(asset && pack.local.revision===expectedRevision,'$.ref','Skin revision changed','ASSET_UNAVAILABLE')
        const relative=pack.skins?.[ref.assetId]?.assets?.[assetKey]
        check(relative,'$.assetKey','Skin asset unavailable','ASSET_UNAVAILABLE')
        const file='bundles/'+content.bundleKey+'/'+path.posix.join(path.posix.dirname(content.entry),relative),descriptor=pack.manifest.files.find(row=>row.path===file)
        check(descriptor,'$.assetKey','Skin asset unavailable','ASSET_UNAVAILABLE')
        const ext=path.posix.extname(file).slice(1),mime=ext==='svg'?'image/svg+xml':BLOB_MIME_TYPES[ext]
        const bytes=await storage.read('packs/'+ref.packId+'/'+file,descriptor.size)
        check(bytes,'$.assetKey','Skin asset unavailable','ASSET_UNAVAILABLE')
        return {bytes,mime}
      })
    },
    leaseMedia(input) {
      validateUuid(input.packId); validateHash(input.hash)
      return readRun([input.packId], async () => {
        const pack = await metadata(input.packId, 'manifest'), descriptor = pack?.manifest.blobs[input.hash]
        check(descriptor, '$.hash', 'Blob missing', 'ASSET_UNAVAILABLE')
        return leases.issue({...input, revision:pack.local.revision, resources:[{name:'media', path:`media/${input.hash}.${descriptor.ext}`, mime:descriptor.mime, hash:input.hash}], entry:'media', kind:'media'})
      })
    },
    leaseBundle(input) {
      validateUuid(input.packId); validateShortId(input.bundleKey)
      return readRun([input.packId], async () => {
        const pack = await metadata(input.packId, 'manifest'), bundle = pack?.manifest.bundles[input.bundleKey]
        check(['live2d','spine','skin','performance','entrance','video'].includes(bundle?.kind), '$.bundleKey', 'Only inert bundles may use media leases', 'WIDGET_UNAUTHORIZED')
        const prefix = `bundles/${input.bundleKey}/`
        // Spine skeleton/atlas are inert data read by the browser runtime, never executed.
        // so are a skin's own WOFF2 font faces (font.faces).
        // and its static SVG images (validated inert by skin-svg.js).
        // and a 视频 bundle's video (signature-checked WebM / MP4 media, played by <video>).
        const types = {json:'application/json', moc3:'application/octet-stream', ...(bundle.kind === 'spine' ? {skel:'application/octet-stream', atlas:'text/plain; charset=utf-8'} : {}), ...(bundle.kind === 'skin' ? {woff2:'font/woff2', svg:'image/svg+xml'} : {}), ...(bundle.kind === 'video' ? {webm:'video/webm', mp4:'video/mp4'} : {}), png:'image/png', webp:'image/webp', jpg:'image/jpeg', jpeg:'image/jpeg', wav:'audio/wav', mp3:'audio/mpeg', ogg:'audio/ogg', m4a:'audio/mp4', flac:'audio/flac'}
        const resources = pack.manifest.files.filter(f => f.path.startsWith(prefix) && types[f.path.split('.').at(-1).toLowerCase()]).map(f => ({name:f.path.slice(prefix.length), path:f.path, mime:types[f.path.split('.').at(-1).toLowerCase()], hash:f.sha256, size:f.size}))
        return leases.issue({...input, revision:pack.local.revision, contentHash:bundle.contentHash, resources, entry:bundle.entry, kind:'bundle'})
      })
    },
    // Host-only: the browser control allowlist never accepts an authorization callback.
    leaseWidget(input) {
      validateAssetRef(input.ref)
      check(input.ref.kind === 'widgets' && typeof input.authorize === 'function', '$', 'Active widget scope required', 'ASSET_UNAVAILABLE')
      return readRun([input.ref.packId], async () => {
        const pack = await metadata(input.ref.packId)
        const asset = pack?.manifest.assets.find(asset => asset.kind === 'widgets' && asset.id === input.ref.assetId && asset.enabled)
        check(asset && pack.local.revision === input.expectedRevision, '$', 'Widget revision changed or disabled', 'ASSET_UNAVAILABLE')
        const content = assetContent(asset), document = pack.widgets[asset.id], directory = content.entry.includes('/') ? content.entry.slice(0,content.entry.lastIndexOf('/')+1) : ''
        const prefix = `bundles/${content.bundleKey}/`
        const types = {html:'text/html', js:'text/javascript', css:'text/css', json:'application/json', png:'image/png', webp:'image/webp', jpg:'image/jpeg', jpeg:'image/jpeg', svg:'image/svg+xml', wav:'audio/wav', mp3:'audio/mpeg', ogg:'audio/ogg', m4a:'audio/mp4', flac:'audio/flac', woff:'font/woff', woff2:'font/woff2'}
        const resources = pack.manifest.files.filter(f => f.path.startsWith(prefix) && types[f.path.split('.').at(-1).toLowerCase()]).map(f => ({name:f.path.slice(prefix.length), path:f.path, mime:types[f.path.split('.').at(-1).toLowerCase()], hash:f.sha256}))
        return leases.issue({...input, packId:input.ref.packId, revision:pack.local.revision, resources, entry:directory + document.view.entry, kind:'widget'})
      })
    },
    respondLease:(input) => leases.response(input),
    releaseLease:(ticket) => leases.release(ticket),
    subscribe(listener) { alive(); check(typeof listener === 'function', '$.listener'); storage.subscribers.add(listener); listeners.add(listener); return () => { storage.subscribers.delete(listener); listeners.delete(listener) } },
    async dispose() { cardUrlController?.abort(); await Promise.allSettled([cardUrlTask]); await catalogue.dispose(); disposed = true; leases.dispose(); disposeCardBundles(); for (const id of [...previews.keys()]) forget(id); metadataCache.clear(); metadataBytes = 0; for (const fn of listeners) storage.subscribers.delete(fn); listeners.clear(); await storage.run([], async () => {}); await Promise.all([...archives].map(archive => archive.dispose())); await Promise.all(spoolDisposals) }
  }
  catalogue = createCatalogueManager({assetRoot:options.assetRoot, limits, settings:options.catalogueSettings, network:options.catalogueNetwork, now,
    maxArchiveBytes:options.maxArchiveBytes,
    listInstalled:() => run([], all),
    inspectFile:(file, info) => service.inspectImport({[REMOTE_ARCHIVE]:{file,...info}}),
    discardInspection:id => run([], () => {if(previews.has(id)) forget(id); else dropSet(id)})
  })
  const applyImport = service.applyImport
  return Object.freeze({...service,...catalogue.methods,
    spoolUsage:() => cardUrlBytes + ingressBytes + previewBytes + cardBundleUsage().bytes,
    // host transport only: a directory on the library's disk for one streamed archive upload
    openUploadSpool:() => storage.spool(),
    async applyImport(input) {
      catalogue.applying(input.inspectionId)
      try {const result=await applyImport(input);catalogue.applied(input.inspectionId,result);return result}
      catch(error) {catalogue.applied(input.inspectionId,null,error);throw error}
    }
  })
}
// A pack's media blobs, also inside a 素材包合集 or card bundle (packs/<id>/media/…): the entries an import spools to disk.
const SPOOLED = /^(?:packs\/[0-9a-f-]{36}\/)?media\/[0-9a-f]{64}\.[a-z0-9]+$/
function cloneFilesWithDeletes(files) { return new Map([...files].map(([key,value]) => [key,value === null ? null : Buffer.from(value)])) }
function guardArchive(entries) {
  const spellings = new Map(), files = new Set(entries.filter(e => !e.directory).map(e => e.path.toLowerCase()))
  for (const entry of entries) {
    const parts = entry.path.replace(/\/$/, '').split('/')
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/'), folded = name.toLowerCase()
      check(!spellings.has(folded) || spellings.get(folded) === name, name, 'ZIP case collision', 'INVALID_PATH')
      check(i === parts.length || !files.has(folded), name, 'ZIP file/directory collision', 'INVALID_PATH')
      spellings.set(folded, name)
    }
  }
}
