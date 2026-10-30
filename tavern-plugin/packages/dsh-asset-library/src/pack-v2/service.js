import path from 'node:path'
import {authorAudioLoudness} from './audio-loudness.js'
import {enforceTriggers} from '../asset-packs/trigger-lint.js'
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
import { createReadStream } from 'node:fs'
import { publicNetwork, readBounded } from '../pack-catalogue/network.js'
import { httpsUrl } from '../pack-catalogue/catalogue.js'
import { createCatalogueManager } from '../pack-catalogue/manager.js'
import { baseMetadata, mergeMetadata } from '../pack-catalogue/merge.js'
const REMOTE_ARCHIVE = Symbol('host-only downloaded archive')
const CARD_URL_DEADLINE_MS = 20 * 60000
import { assertPublicPackChain } from './public-export.js'
import { createSimpleSprite } from './simple-sprite.js'
import { trimAuthoringImages } from './image-closure.js'
import { applyStateImageMapping, retainPublishedStateImages } from './state-images.js'
import {applyResolutionWrites} from './resolution-write.js'
import { removeFigureEmotion } from './remove-figure-emotion.js'
import { copyFigureAssets } from './copy-figure.js'
import {readCopyMouthDebt, copiedMouthDebt, retireLocalMouthDebt} from './copied-mouth-debt.js'
import { copyPackItems } from './copy-items.js'
import { mergePackContents } from './merge-packs.js'
import {createStageSetupMethods} from './stage-setup.js'
import { stat, writeFile } from 'node:fs/promises'
import { createPackStorage } from './storage.js'
import {createModPrivateMethods,isModConfigPack} from './mod-private.js'
import { isMetadataEdit } from './metadata-edit.js'
import { createCardBundleMethods } from './card-bundle.js'
import { isPackSet, readPackSet, packSetFiles } from './pack-set.js'
import { partitionPackSets, COLLECTION_BYTES } from './pack-set-partition.js'
import { PACK_LIMITS, jsonBytes, readDocument, cloneFiles, budget, sealPack, storedCopyHashes, StoredFile, verifyBytes, inspectPackScripts, packDiff } from './validation.js'
import widgetContract from '../shared/widget-schema.cjs'
import { createPackLeases } from './leases.js'
export { PACK_LEASE_PATH } from './leases.js'
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
const snapshot = pack => pack && freezeSnapshot({...(isModConfigPack(pack)?{privateConfig:true}:{}),...contentSnapshot(pack), ...(pack.diagnostics?.length ? {diagnostics:pack.diagnostics} : {}), revision:pack.local.revision, installedAt:pack.local.installedAt, updatedAt:pack.local.updatedAt, ...(pack.local.distribution ? {distribution:pack.local.distribution} : {})})
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
    ...(local.distribution ? {distribution:copy(local.distribution)} : {}), ...(pack.diagnostics?.length ? {diagnostics:copy(pack.diagnostics)} : {}), ...(isModConfigPack(pack) ? {privateConfig:true} : {}),
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

/** Construct explicitly; this service is not composed into Tavern or registered as v1. */
export function createAssetPackService(options) {
  const limits = {...PACK_LIMITS, ...options.limits}, now = options.now || Date.now
  for (const [key, value] of Object.entries(limits)) check(Number.isSafeInteger(value) && value > 0, '$.limits.' + key)
  const storage = createPackStorage({...options, limits}), previews = new Map(), listeners = new Set()
  const archives = new Set()
  const archiveBytes = () => [...archives].reduce((sum, archive) => sum + archive.size, 0)
  const exportArchive = options.exportArchive || (async file => {
    await Promise.all([...archives].filter(archive => archive.expiresAt <= now()).map(archive => archive.dispose()))
    const {size} = await stat(file)
    check(size <= limits.totalSize && previewBytes + cardBundleUsage().bytes + externalUsage() + size <= limits.spoolBytes, '$', 'Export archive spool budget exceeded', 'LIMIT_EXCEEDED')
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
    return {...(prior?.mouthDebt?{mouthDebt:copy(prior.mouthDebt)}:{}),...(prior?.stageSetupCardId?{stageSetupCardId:prior.stageSetupCardId}:{}),...(prior?.modConfig?{modConfig:true}:{}),revision:randomUUID(), retired, installedAt:prior?.installedAt ?? updatedAt, updatedAt, ...(prior?.distribution ? {distribution:copy(prior.distribution)} : {})}
  }
  let disposed = false, previewBytes = 0, ingressBytes = 0, catalogue, cardUrlTask, cardUrlController
  let cardUrlBytes = 0
  const pendingSnapshots = new Map()
  const externalUsage = () => archiveBytes() + cardUrlBytes + (options.externalSpoolUsage?.() || 0) + (catalogue?.usage() || 0)
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
  // 'manifest' serves media without hydrating figure/sprite documents; true is list-summary only.
  async function metadata(id, summaryOnly = false) {
    const signature = await storage.stamp(id), cached = metadataCache.get(id)
    if (cached?.signature === signature && (summaryOnly === true || !cached.summaryOnly || summaryOnly === 'manifest' && cached.summaryOnly === 'manifest')) {
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
    if (!summaryOnly) {
      const names = [...new Set([
        ...manifest.figures.map(figureId => `figures/${figureId}.json`),
        ...Object.values(manifest.sprites),
        ...manifest.assets.filter(a => ['skins','performances'].includes(a.kind)).flatMap(a => assetContents(a).map(c => 'bundles/' + c.bundleKey + '/' + c.entry))
      ])]
      let next = 0
      // Bound cold hydration I/O; drain all workers before releasing the publication gate.
      const reads = await Promise.allSettled(Array.from({length:Math.min(8, names.length)}, async () => {
        while (next < names.length) await documentBytes(names[next++])
      }))
      const failed = reads.find(result => result.status === 'rejected')
      if (failed) throw failed.reason
      for (const figureId of manifest.figures) figures[figureId] = storedDocument(await documentBytes(`figures/${figureId}.json`))
      for (const [key, name] of Object.entries(manifest.sprites)) sprites[key] = storedDocument(await documentBytes(name))
      for (const asset of manifest.assets.filter(a => a.kind === 'skins')) skins[asset.id] = storedDocument(await documentBytes('bundles/' + assetContent(asset).bundleKey + '/' + assetContent(asset).entry))
      for (const asset of manifest.assets.filter(a => a.kind === 'performances')) performances[asset.id] = storedDocument(await documentBytes('bundles/' + assetContent(asset).bundleKey + '/' + assetContent(asset).entry))
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
    check(signature === await storage.stamp(id), '$.packId', 'Pack changed during validation', 'REVISION_CONFLICT')
    // Inline voice transcripts are already retained in the figure document.
    // Summary entries retain only the projection, not megabytes of manifest indexes.
    const retained = summaryOnly === true ? {summary:packSummary({manifest, diagnostics, local})} : {manifest, figures, sprites, skins, performances, widgets, variantDocuments, diagnostics, local, documents, files:new Map()}
    const size = Buffer.byteLength(signature) + Buffer.byteLength(JSON.stringify(summaryOnly === true ? retained : {manifest, figures, sprites, skins, performances, widgets, variantDocuments, diagnostics, local})) + (summaryOnly ? 0 : [...documents.values()].reduce((sum, bytes) => sum + bytes.length, 0))
    if (size <= 32 * 1024 ** 2) {
      evictMetadata(id)
      metadataCache.set(id, {signature, pack:retained, size, summaryOnly}); metadataBytes += size
      while (metadataBytes > 32 * 1024 ** 2 || metadataCache.size > 128) evictMetadata(metadataCache.keys().next().value)
    }
    return retained
  }
  async function all() { const packs = []; for (const id of await storage.listIds()) packs.push(await metadata(id)); return packs }
  function emit(pack, before) {
    const event = {packId:pack?.manifest.id || before.manifest.id, revision:pack?.local.revision ?? null, kinds:[...new Set([...(before?.manifest.assets || []), ...(pack?.manifest.assets || [])].map(a => a.kind))], figures:[...new Set([...(before?.manifest.figures || []), ...(pack?.manifest.figures || [])])]}
    for (const listener of storage.subscribers) { try { listener(copy(event)) } catch { /* Observers cannot roll back a committed write. */ } }
  }
  async function removeInstalledPack(before) {
    const packId = before.manifest.id
    if (before.local.stageSetupCardId) await options.cardTransactions.unbindPack({packId})
    // Removal is not retirement: reinstalling the same pack restores refs.
    await storage.publish(packId, null, nextLocal(before.local))
    emit(null, before)
    return {status:'removed', packId}
  }
  async function install(pack, before, distribution, dryRun = false, resolution, copiedDebt) {
    if(!resolution) {
      const original={manifest:copy(pack.manifest),files:new Map(pack.files)},hashed=new Map()
      resolution=await applyResolutionWrites({manifest:pack.manifest,files:pack.files,previous:before,hashed})
      if(resolution.changes.length) {
        await sealPack(pack.manifest,pack.files,original,hashed)
        pack=await verify(pack.manifest,pack.files,before,true)
      }
    }
    retainPublishedStateImages(before,pack,resolution.technical?new Map(resolution.changes.map(row=>[row.previous,row.hash])):undefined,resolution.imageResolutions)
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
  function triggerOverrides(input, before, manifest, files) {
    const figures = Object.fromEntries(manifest.figures.map(id => {
      const bytes = files.get(`figures/${id}.json`)
      return [id, Buffer.isBuffer(bytes) ? readDocument(bytes) : before.figures[id]]
    }).filter(([, figure]) => figure))
    return enforceTriggers(before, {manifest, figures}, input.force)
  }
  async function edit(input, mutate, tryMetadata = false, migrateLocal, dryRun = false, resolutionTargets, resolutionRestore, imageResolutions) {
    validateUuid(input.packId)
    return run([input.packId], async () => {
      if (tryMetadata) {
        const before = await metadata(input.packId); cas(before, input.expectedRevision)
        check(before, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
        if (!before.diagnostics?.length) {
          const manifest = copy(before.manifest), files = new Map(before.files), figures = {...before.figures}
          await mutate(manifest, files, before)
          const forcedOverrides = triggerOverrides(input, before, manifest, files)
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
            if (manifest.contentHash === before.manifest.contentHash && canonicalJson(migratedLocal) === canonicalJson(before.local)) return {status:'noop', snapshot:snapshot(before)}
            if (dryRun) return {status:'dry-run', snapshot:snapshot({...before, manifest, figures, files, local:migratedLocal}), forcedOverrides}
            const local = nextLocal(retireLocalMouthDebt(migratedLocal, {figures,sprites:before.sprites}))
            await storage.publishMetadata(input.packId, manifest, updates, local)
            const saved = {...before, manifest, figures, files, local};
            for (const asset of manifest.assets) if (asset.variants && before.variantDocuments?.[asset.kind+'/'+asset.id]) saved[asset.kind]={...saved[asset.kind],[asset.id]:before.variantDocuments[asset.kind+'/'+asset.id][asset.variants.default]};
            evictMetadata(input.packId); emit(saved, before)
            return {status:'updated', snapshot:snapshot(saved), forcedOverrides}
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
      const forcedOverrides = triggerOverrides(input, before, manifest, files)
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
      await sealPack(manifest, files, before, hashed)
      const verified = await verify(manifest, files, before, true)
      for (const [id, document] of Object.entries(verified.widgets)) {
        const known=[before.widgets?.[id],...Object.values(before.variantDocuments?.['widgets/'+id] || {})].map(doc=>canonicalJson(doc?.variables || {}))
        for(const next of [document,...Object.values(verified.variantDocuments?.['widgets/'+id] || {})]) check(known.includes(canonicalJson(next.variables || {})), '$.widgets.' + id + '.variables', 'Variable capability changes require archive inspection and applyImport', 'SCRIPT_CONFIRMATION_REQUIRED')
      }
      const result = await install(verified, migrateLocal ? {...before,local:migrateLocal(before.local,before.figures)} : before, undefined, dryRun, resolution)
      return {...result, ...extra, forcedOverrides, resolution}
    }, dryRun)
  }
  function sweep() { for (const [id, entry] of previews) if (entry.expiresAt <= now()) { previews.delete(id); previewBytes -= entry.size } }
  // a 素材包合集 holds one preview per pack but counts as one inspection.
  const previewCount = () => new Set([...previews].map(([id, entry]) => entry.set || id)).size
  function dropSet(setId) { for (const [id, entry] of previews) if (entry.set === setId) { previews.delete(id); previewBytes -= entry.size } }
  async function readZipFile(file, archiveBytes, extraBytes, signal) {
    const zip = await openZip(file, limits), files = new Map()
    guardArchive(zip.entries)
    check(zip.totalSize + archiveBytes + ingressBytes + previewBytes + extraBytes + externalUsage() <= limits.spoolBytes, '$.bytes', 'Import spool budget exceeded', 'LIMIT_EXCEEDED')
    ingressBytes += zip.totalSize + archiveBytes
    // Even zero-length directory entries must pass CRC verification.
    for (const entry of zip.entries) { signal?.throwIfAborted(); const content = await zip.read(entry); if (!entry.directory) files.set(entry.path, content) }
    return files
  }
  async function readZipFiles(bytes, extraBytes = cardBundles.cardBundleUsage().bytes) {
    check(bytes instanceof Uint8Array && bytes.length <= limits.spoolBytes, '$.bytes', 'Archive exceeds spool budget', 'LIMIT_EXCEEDED')
    return storage.temporary(async file => {
      await writeFile(file, bytes, {flag:'wx'})
      return readZipFile(file, bytes.length, extraBytes)
    })
  }
  async function readArchive(bytes, remote) {
    const files = remote ? await readZipFile(remote.file, 0, cardBundleUsage().bytes, remote.signal) : await readZipFiles(bytes)
    if (isPackSet(files)) { const set = []; for (const pack of readPackSet(files)) set.push(await importPack(pack.manifest, pack.files)); return {set} }
    const root = files.get('manifest.json'); check(root, '$', 'Missing pack manifest', 'FILE_CLOSURE_MISMATCH')
    files.delete('manifest.json')
    return importPack(readDocument(root),files)
  }
  async function importPack(manifest,files) {
    // Authenticate external bytes once before shared import normalization can reseal them.
    await verifyPackHashes(manifest); await verifyPackFiles(manifest,files)
    const authenticated = {manifest:{...manifest}, files:new Map(files)}
    const normalized = normalizePackImport(manifest,files)
    manifest = normalized.manifest
    const audioChanged = await authorAudioLoudness(manifest, files, {measure:options.measureAudio})
    const hashed=new Map(),resolution=await applyResolutionWrites({manifest,files,hashed})
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
  async function inspectPack(pack, {remote, uploadHash, installed, copyOnly, setId}) {
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
    let choices = identityConflict || copyOnly ? ['keep-both','cancel'] : same ? ['noop','cancel'] : before ? ['update','keep-both','cancel'] : ['install','keep-both','cancel']
    const mapping = {packId:randomUUID(), figures:Object.fromEntries(pack.manifest.figures.map(id => [id,randomUUID()]))}
    const remapped = await remapPack(pack, mapping)
    const keep = await verify(remapped.manifest, remapped.files, pack, true)
    const id = randomUUID(), expiresAt = now() + limits.previewTtlMs, size = budget(pack.files, limits) + jsonBytes(pack.manifest).length
    check(previewBytes + cardBundleUsage().bytes + size + externalUsage() <= limits.spoolBytes, '$', 'Preview spool budget exceeded', 'LIMIT_EXCEEDED')
    const preview = {inspectionId:id, uploadHash, packId:pack.manifest.id, contentHash:pack.manifest.contentHash, expectedRevision:before?.local.revision ?? (await storage.local(pack.manifest.id))?.revision ?? null, choices, expiresAt, diff:packDiff(before?.manifest, pack.manifest), incoming:contentSnapshot(pack), current:snapshot(before), conflictFigures, mapping, scriptRisk:inspectPackScripts(pack)}
    if (remote) { preview.distribution = {...remote.source, archiveSha256:remote.archiveSha256, integrity:remote.integrity}; preview.merge = merge || {preserved:[],removedEdited:[],withoutBaseline:false,wholePackReplacement:false} }
    previews.set(id, {pack, keep, preview, expiresAt, size, distribution, ...(setId ? {set:setId} : {})}); previewBytes += size
    return preview
  }
  const cardBundles = createCardBundleMethods({storage, run, alive, load:loadForExport, metadata, exportArchive, readZipFile, archiveKey:REMOTE_ARCHIVE, all, verify, importPack, cas, keys, remapPack, remapValue, readZipFiles, limits, now, nextLocal, emit, cards:options.cardTransactions, globalPackIds:options.globalEnabledPackIds, packPreviewUsage:() => {sweep();return {count:previewCount(),bytes:previewBytes}}})
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
    ...createStageSetupMethods({assetRoot:options.assetRoot,run,all,load,verify,storage,cards:options.cardTransactions,nextLocal,emit,blankManifest,createFigure,triggerOverrides}),
    ...createModPrivateMethods({validators:modValidators,run,metadata,storage,cas,edit,readDocument,jsonBytes,load,verify,sealPack,nextLocal,emit,cards:options.cardTransactions,randomUUID,blankManifest,remapPack}),
    apiVersion:2,
    ...bundleMethods,
    // Direct public HTTPS card bundles use the same pinned-DNS/redirect boundary as pack URLs.
    inspectCardBundleUrl({path, url}) {
      alive(); httpsUrl(url);
      check(!cardUrlTask, '$.url', 'A card download is already running', 'ASSET_UNAVAILABLE');
      const maximum = Math.min(256 * 1024 ** 2, Math.floor(limits.spoolBytes / 3));
      check(maximum + previewBytes + cardBundleUsage().bytes + externalUsage() <= limits.spoolBytes, '$', 'Shared spool budget exceeded', 'LIMIT_EXCEEDED');
      cardUrlBytes = maximum; const controller = cardUrlController = new AbortController();
      // a whole-download deadline, not a stall timer (the request already drops a connection
      // idle for 30 s). 3 minutes cut a 206 MB GitHub Release bundle below ~9 Mbit/s; 20 minutes allows ~1.4 Mbit/s.
      const timer = setTimeout(() => controller.abort(), CARD_URL_DEADLINE_MS); timer.unref?.();
      cardUrlTask = (async () => {
        try {
          let bytes
          try { bytes = await readBounded(options.catalogueNetwork || publicNetwork, url, maximum, controller.signal) }
          catch (error) {
            // a download failure is always DOWNLOAD_FAILED with a reason the UI can word
            // (HTTP status from readBounded, timeout, or the network error code), never a raw socket error.
            if (disposed || ['DOWNLOAD_FAILED','LIMIT_EXCEEDED'].includes(error?.code)) throw error
            throw Object.assign(new Error(controller.signal.aborted ? 'Download timed out' : 'Network request failed' + (/^E[A-Z_]+$/.test(error?.code || '') ? ' (' + error.code + ')' : '')), {code:'DOWNLOAD_FAILED', path:'$.url'})
          }
          alive();
          return await bundleMethods.inspectCardBundle({path, bytes});
        } finally { clearTimeout(timer); cardUrlBytes = 0; cardUrlTask = null; cardUrlController = null; }
      })();
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
      // Full author-field replacement patch, plus exact byte updates. Never a revision/hash patch.
      const patch = copy(input.patch || {}), updates = input.fileUpdates ? cloneFilesWithDeletes(input.fileUpdates) : new Map()
      return edit(input, async (manifest, files, before) => {
        for (const key of Object.keys(patch)) check(!['id','format','schemaVersion','contentHash','files'].includes(key), '$.patch.' + key, 'Identity/hash fields cannot be patched')
        // Metadata probing and the full transaction each trim their own resource closure.
        Object.assign(manifest, copy(patch))
        // An optional author field patched to undefined is removed.
        for (const [key, value] of Object.entries(patch)) if (value === undefined) delete manifest[key]
        for (const [name, bytes] of updates) {
          check(!name.startsWith('mods/'),'$.fileUpdates','Mod private files cannot be edited here','UNKNOWN_FIELD')
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
      }, !input.imageResolutions?.length && [...updates].every(([name, bytes]) => bytes !== null && /^figures\/[0-9a-f-]+\.json$/.test(name)), undefined, input.dryRun === true, undefined, undefined, input.imageResolutions)
    },
    savePackVoice(input) {
      validateShortId(input.voiceId, '$.voiceId')
      return edit(input, async (manifest, files) => {
        const library = manifest.voiceLibrary ||= {version:1,voices:{}}
        const users = [...files].filter(([p]) => p.startsWith('figures/')).map(([,b]) => readDocument(b)).filter(f => f.voice?.voice === input.voiceId)
        check(!users.some(f => f.id !== input.figureId) || input.confirmShared === true, '$.confirmShared', 'Confirm shared voice users', 'SHARED_VOICE_CONFIRMATION_REQUIRED')
        library.voices[input.voiceId] = copy(input.voiceSpec)
        return {affectedFigures:users.map(f => ({id:f.id,name:f.name}))}
      })
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
        const merged = mergePackContents(source,before,input)
        trimAuthoringImages(merged.manifest,merged.files,{...source.figures,...before.figures})
        const hashes = storedCopyHashes(merged.files,[source,before])
        await sealPack(merged.manifest,merged.files,before,hashes)
        budget(merged.files,limits)
        const checked = {figures:Object.fromEntries(merged.manifest.figures.map(id=>[id,readDocument(merged.files.get('figures/'+id+'.json'))])),sprites:Object.fromEntries(Object.entries(merged.manifest.sprites).map(([key,file])=>[key,readDocument(merged.files.get(file))]))}
        validatePackDocuments({...checked,manifest:merged.manifest})
        const installed = await all()
        validatePackIdentities([...installed.filter(pack=>![input.packId,input.sourcePackId].includes(pack.manifest.id)).map(pack=>pack.manifest),merged.manifest])
        const retired = new Set(before.local.retired || [])
        for (const key of keys({...checked,manifest:merged.manifest})) check(!retired.has(key),'$.identity','Retired identity cannot be reused: '+key,'DUPLICATE_ID')
        const plan = {mapping:merged.mapping,bundleKeys:merged.bundleKeys,spriteKeys:merged.spriteKeys,voiceKeys:merged.voiceKeys,contentHash:merged.manifest.contentHash,figures:merged.manifest.figures.length,assets:merged.manifest.assets.length,bytes:merged.manifest.files.reduce((sum,row)=>sum+row.size,0)}
        if (input.dryRun) return {status:'dry-run',...plan,...(input.includeSnapshot ? {snapshot:snapshot({...checked,manifest:merged.manifest,local:before.local})} : {})}
        const pack = {...checked,manifest:merged.manifest,files:merged.files}, local = nextLocal(before.local)
        await storage.publish(input.packId,pack,local,before)
        // The offline command owns a full two-pack backup and writes a partial receipt on failure.
        await storage.publish(input.sourcePackId,null,nextLocal(source.local))
        evictMetadata(input.packId); evictMetadata(input.sourcePackId)
        emit({...pack,local},before); emit(null,source)
        return {status:'merged',revision:local.revision,...plan}
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
        const result = copyFigureAssets(source, input.source.figureId, manifest, files)
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
        const copied = copyPackItems(source, input.itemRefs, manifest, files, new Set(before?.local.retired || []))
        await sealPack(manifest, files, before, storedCopyHashes(files,[source]))
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
    patchFigure(input) {
      validateUuid(input.figureId)
      const patch = copy(input.patch)
      return edit(input, async (manifest, files, before) => {
        check(before.figures[input.figureId] && !Object.hasOwn(patch, 'id'), '$.figure', 'Missing figure or attempted identity change')
        const figure = {...before.figures[input.figureId], ...patch}
        // null deletes optional top-level fields; omission preserves them.
        // Required and unknown keys stay in the document for strict validation to reject.
        for (const key of ['aliases', 'description', 'identityAppearance', 'identitySettei', 'heightCm', 'heightBasis', 'elevationCm', 'imageColor', 'autoColor', 'emotions', 'voice', 'extensions']) {
          if (patch[key] === null) delete figure[key]
        }
        if (figure.aliases !== undefined && (Object.hasOwn(patch, 'aliases') || Object.hasOwn(patch, 'name'))) figure.aliases = normalizeFigureAliases(figure.name, figure.aliases)
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
        // Retire only this figure's models; shared outfits and asset bundles survive.
        const owned = new Set(before.figures[input.figureId].outfits.flatMap(outfit => [outfit.live2d?.bundleKey, outfit.spine?.bundleKey]).filter(Boolean))
        const used = new Set(manifest.assets.flatMap(asset=>assetContents(asset).map(content=>content.bundleKey)))
        for (const id of manifest.figures) for (const outfit of before.figures[id].outfits) {
          used.add(outfit.live2d?.bundleKey); used.add(outfit.spine?.bundleKey)
        }
        for (const key of owned) if (!used.has(key)) {
          delete manifest.bundles[key]
          for (const file of files.keys()) if (file.startsWith(`bundles/${key}/`)) files.delete(file)
        }
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
        const read = await readArchive(bytes, remote), installed = await all()
        // One hash per transfer: a downloaded archive's own digest, else the uploaded bytes once (shared by a set's packs).
        const uploadHash = remote?.archiveSha256 || await sha256(bytes), options = {remote:remote?.local ? undefined : remote, uploadHash, installed, copyOnly:input.copy === true}
        if (!read.set) return copy(await inspectPack(read, options))
        // a 素材包合集 — one ordinary preview per pack, each confirmed and applied on its own
        // (applyImport); discarding the set's inspectionId drops every pack still pending. A catalogue entry is one pack.
        check(!remote?.source, '$.packId', 'Catalogue entry is not a pack set', 'INTEGRITY_MISMATCH')
        const setId = randomUUID(), packs = []
        try { for (const pack of read.set) packs.push(await inspectPack(pack, {...options, setId})) }
        catch (error) { dropSet(setId); throw error }
        return copy({kind:'pack-set', inspectionId:setId, uploadHash, expiresAt:Math.min(...packs.map(p => p.expiresAt)), packs})
      })
    },
    applyImport(input) {
      return run([], async () => {
        sweep(); const entry = previews.get(input.inspectionId)
        check(entry, '$.inspectionId', 'Import preview expired', 'ASSET_UNAVAILABLE')
        check(entry.preview.choices.includes(input.decision), '$.decision', 'Explicit preview decision required')
        if (input.decision === 'cancel') { previews.delete(input.inspectionId); previewBytes -= entry.size; return {status:'cancelled'} }
        const before = await metadata(entry.pack.manifest.id)
        cas(before || {local:await storage.local(entry.pack.manifest.id)}, input.expectedRevision, entry.pack.manifest)
        check(input.expectedRevision === entry.preview.expectedRevision, '$.expectedRevision', 'Preview revision changed', 'REVISION_CONFLICT')
        check(input.decision === 'noop' || !entry.preview.scriptRisk.length || input.acceptScriptRisk === true,'$.acceptScriptRisk','Accept or cancel this import script risk','SCRIPT_CONFIRMATION_REQUIRED')
        let candidate = input.decision === 'keep-both' ? entry.keep : entry.pack
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
        const result = input.decision === 'noop' ? {status:'noop',snapshot:snapshot(before)} : await install(candidate, input.decision === 'keep-both' ? null : before, input.decision === 'keep-both' ? null : entry.distribution)
        previews.delete(input.inspectionId); previewBytes -= entry.size
        return {...result, ...(input.decision === 'keep-both' ? {mapping:copy(entry.preview.mapping)} : {})}
      })
    },
    exportPack(input) {
      validateUuid(input.packId)
      return run([input.packId], async () => {
        let pack = await loadForExport(input.packId); cas(pack, input.expectedRevision)
        check(pack, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
        await assertPublicPackChain(pack, metadata)
        check(budget(pack.files, limits) * 2 <= limits.spoolBytes, '$', 'Export spool budget exceeded', 'LIMIT_EXCEEDED')
        const warnings = await exportWarnings(pack)
        return storage.temporary(async file => {
          await writeZip(file, [{path:'manifest.json',data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([path,data]) => ({path,data,file:data.file}))])
          const archive = await exportArchive(file)
          return {...archive, contentHash:pack.manifest.contentHash, revision:pack.local.revision, filename:pack.manifest.id + '.zip',warnings}
        })
      })
    },
    // the 素材库's batch export — two or more whole packs, each through the
    // exportPack checks (CAS, public chain, layered export), in bounded 素材包合集 volumes. A widget default pointing into another
    // pack of the same set is carried, so it is no warning.
    exportPacks(input) {
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
        try {
          for (const group of groups) {
            const packs = []
            for (const item of group) packs.push(await loadForExport(item.manifest.id))
            const files = packs.length === 1 ? new Map([['manifest.json',jsonBytes(packs[0].manifest)], ...packs[0].files]) : packSetFiles(packs)
            check(budget(files, limits) * 2 <= limits.spoolBytes, '$', 'Export spool budget exceeded', 'LIMIT_EXCEEDED')
            exported.push(...packs.map(pack => ({packId:pack.manifest.id, contentHash:pack.manifest.contentHash, revision:pack.local.revision})))
            archives.push(await storage.temporary(async file => {
              await writeZip(file, [...files].map(([path,data]) => ({path,data,file:data.file})))
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
    async dispose() { cardUrlController?.abort(); await Promise.allSettled([cardUrlTask]); await catalogue.dispose(); disposed = true; leases.dispose(); disposeCardBundles(); previews.clear(); previewBytes = 0; metadataCache.clear(); metadataBytes = 0; for (const fn of listeners) storage.subscribers.delete(fn); listeners.clear(); await storage.run([], async () => {}); await Promise.all([...archives].map(archive => archive.dispose())) }
  }
  catalogue = createCatalogueManager({assetRoot:options.assetRoot, limits, settings:options.catalogueSettings, network:options.catalogueNetwork, now,
    maxArchiveBytes:options.maxArchiveBytes,
    resourceUsage:() => {sweep();return archiveBytes() + ingressBytes + previewBytes + cardBundleUsage().bytes + (options.externalSpoolUsage?.() || 0)},
    listInstalled:() => run([], all),
    inspectFile:(file, info) => service.inspectImport({[REMOTE_ARCHIVE]:{file,...info}}),
    discardInspection:id => run([], () => {const entry=previews.get(id);if(entry) {previews.delete(id);previewBytes-=entry.size} else dropSet(id)})
  })
  const applyImport = service.applyImport
  return Object.freeze({...service,...catalogue.methods,
    spoolUsage:() => archiveBytes() + ingressBytes + previewBytes + cardBundleUsage().bytes + catalogue.usage(),
    async applyImport(input) {
      catalogue.applying(input.inspectionId)
      try {const result=await applyImport(input);catalogue.applied(input.inspectionId,result);return result}
      catch(error) {catalogue.applied(input.inspectionId,null,error);throw error}
    }
  })
}
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
