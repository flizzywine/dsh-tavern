import {randomUUID} from 'node:crypto'
import {check, shape, canonicalJson, validateUuid} from '../asset-packs/common.js'
import {validatePackIdentities, spriteResourcePaths, sha256} from '../asset-packs/index.js'
import {normalizeFigureAliases} from '../asset-packs/figure-names.js'
import {STANDARD_FIGURE_EMOTIONS, matchBubbleMood} from '../asset-packs/figure-emotions.js'
import {voiceReferences} from '../shared/voice-schema.js'
import {sealPack, jsonBytes, readDocument, budget, storedCopyHashes} from './validation.js'
import {imageKind, imageDimensions} from './media.js'
import {copyFigureAssets} from './copy-figure.js'
import {createSimpleSprite} from './simple-sprite.js'
import {trimAuthoringImages, retireFigureBundles} from './image-closure.js'
import {FIGURE_IMAGE_EXTENSION} from './figure-image-extras.js'
import {searchLibrary} from './library-search.js'

// Ordinary editing and automatic deltas use the same optional-field semantics.
export function patchFigureDocument(before, patch) {
  check(before && !Object.hasOwn(patch, 'id'), '$.figure', 'Missing figure or attempted identity change')
  const figure = {...before, ...structuredClone(patch)}
  for (const key of ['aliases', 'description', 'guidance', 'identityAppearance', 'identitySettei', 'heightCm', 'heightBasis', 'elevationCm', 'imageColor', 'autoColor', 'emotions', 'voice', 'extensions']) {
    if (patch[key] === null) delete figure[key]
  }
  if (figure.aliases !== undefined && (Object.hasOwn(patch, 'aliases') || Object.hasOwn(patch, 'name'))) figure.aliases = normalizeFigureAliases(figure.name, figure.aliases)
  return figure
}

// A patch receipt stores only changed fields. Missing keys in before/after mean
// absence, not null; the union also covers optional fields removed by a patch.
export function automaticFieldDelta(before, after) {
  const old = {}, next = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (canonicalJson(before[key] ?? null) === canonicalJson(after[key] ?? null) && Object.hasOwn(before,key) === Object.hasOwn(after,key)) continue
    if (Object.hasOwn(before,key)) old[key] = structuredClone(before[key])
    if (Object.hasOwn(after,key)) next[key] = structuredClone(after[key])
  }
  return {before:old, after:next}
}

// The 外貌 a copied figure carries is in transit to its 配图 record (the host moves it there right after the write):
// it is not pack content, so receipts and undo compare the figure without it.
const durableFigure = figure => {
  if (!figure.extensions?.[FIGURE_IMAGE_EXTENSION]) return figure
  const next = structuredClone(figure)
  delete next.extensions[FIGURE_IMAGE_EXTENSION]
  return next
}

export function mutateAutomaticFigure({manifest, files, change, createFigure}) {
  if (change.op === 'create') {
    const {figureId} = createFigure(manifest,files,{figure:change.value})
    return {ref:{packId:manifest.id,kind:'figures',figureId},before:null,after:readDocument(files.get('figures/' + figureId + '.json'))}
  }
  check(change.op === 'patch' && change.ref?.kind === 'figures' && change.ref.packId === manifest.id, '$.change')
  const figureId = change.ref.figureId, file = 'figures/' + figureId + '.json'
  check(manifest.figures.includes(figureId), '$.figure', 'Figure unavailable', 'NOT_FOUND')
  const before = readDocument(files.get(file)), after = patchFigureDocument(before,change.patch)
  files.set(file,jsonBytes(after))
  return {ref:{packId:manifest.id,kind:'figures',figureId},...automaticFieldDelta(before,after)}
}

export function undoAutomaticDelta(current, delta) {
  if (delta.before === null) {
    check(canonicalJson(durableFigure(current)) === canonicalJson(delta.after), '$.writeId', 'Automatically created item was edited', 'AUTOMATIC_WRITE_CHANGED')
    return null
  }
  const restored = structuredClone(current)
  for (const key of new Set([...Object.keys(delta.before), ...Object.keys(delta.after)])) {
    check(Object.hasOwn(current,key) === Object.hasOwn(delta.after,key) && canonicalJson(current[key] ?? null) === canonicalJson(delta.after[key] ?? null), '$.writeId', 'Automatically changed field was edited', 'AUTOMATIC_WRITE_CHANGED')
    if (Object.hasOwn(delta.before,key)) restored[key] = structuredClone(delta.before[key])
    else delete restored[key]
  }
  return restored
}

// Who may write what. auto-figure (a new speaker's name) only creates; auto-cast (the casting assistant) also copies a figure
// from any installed pack and changes the automatic pack's own figures: their texts, voice, 人设图 and still images.
const WRITERS = Object.freeze({
  'auto-figure': {ops:['create'], texts:['name','aliases'], media:false, sourceKind:'story-speaker'},
  'auto-cast': {ops:['create','copy','patch'], texts:['name','aliases','description','guidance'], media:true, sourceKind:'auto-cast'}
})
const CHANGE_FIELDS = {create:[['op','kind','value'],['op','kind','value']], copy:[['op','kind','source','patch'],['op','kind','source']], patch:[['op','kind','ref','patch'],['op','kind','ref']]}
const IMAGE_KEY = /^[A-Za-z0-9_-]{1,40}$/

// The authority binds one immutable request: image bytes compare as bytes, everything else as canonical JSON.
function sameRequest(a, b) {
  const {images:x = {}, ...left} = a, {images:y = {}, ...right} = b
  return canonicalJson(left) === canonicalJson(right) && canonicalJson(Object.keys(x).sort()) === canonicalJson(Object.keys(y).sort())
    && Object.entries(x).every(([key, bytes]) => y[key] instanceof Uint8Array && Buffer.compare(bytes, y[key]) === 0)
}

// Images enter here once: PNG, with the dimensions a still sprite records. Publication decodes them (verify).
async function readImages(images, writer) {
  const result = new Map()
  if (images === undefined) return result
  check(writer.media && images && typeof images === 'object' && !Array.isArray(images), '$.images', 'Writer operation not authorized', 'NOT_AUTHORIZED_WRITER')
  for (const [key, value] of Object.entries(images)) {
    check(IMAGE_KEY.test(key) && value instanceof Uint8Array, '$.images.' + key)
    const bytes = Buffer.from(value)
    check(imageKind(bytes) === 'png', '$.images.' + key, 'Images must be PNG')
    const [width, height] = imageDimensions(bytes, 'png')
    result.set(key, {bytes, width, height, hash:await sha256(bytes)})
  }
  return result
}

function addImage(manifest, files, hashed, image) {
  const descriptor = {ext:'png', mime:'image/png', size:image.bytes.length}, name = `media/${image.hash}.png`
  check(!manifest.blobs[image.hash] || canonicalJson(manifest.blobs[image.hash]) === canonicalJson(descriptor), '$.images', 'Conflicting hash descriptor')
  manifest.blobs[image.hash] = descriptor; files.set(name, image.bytes); hashed.set(name, image.hash)
}

// An undo removes the voices its write added once no figure speaks with them (and nobody changed them), with the
// reference audio only they used.
function retireVoices(manifest, files, voices) {
  const library = manifest.voiceLibrary
  if (!voices.length || !library) return
  const bound = new Set(manifest.figures.map(id => readDocument(files.get(`figures/${id}.json`)).voice?.voice))
  const media = new Set()
  for (const [id, spec] of voices) if (!bound.has(id) && canonicalJson(library.voices[id] ?? null) === canonicalJson(spec)) {
    for (const ref of voiceReferences(spec)) media.add(ref.media)
    delete library.voices[id]
  }
  const used = new Set()
  const visit = value => {
    if (typeof value === 'string' && media.has(value)) used.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(manifest.assets); visit(library)
  for (const hash of media) if (!used.has(hash) && manifest.blobs[hash]) {
    files.delete(`media/${hash}.${manifest.blobs[hash].ext}`)
    delete manifest.blobs[hash]
  }
}

// Host capabilities bind a committed source and its planner to one immutable request.
// Only review operations are suitable for the browser control transport.
export function createAutomaticWriteMethods({run, readRun, all, load, metadata, verify, storage, cards, nextLocal, emit, blankManifest, createFigure, cas, now, limits, evictMetadata, globalPackIds = () => [], figureImageExtras = async () => ({})}) {
  const authorities = new WeakMap()
  const clone = structuredClone
  const receipt = (pack, writeId) => {
    const entry = pack.local.automaticWrites?.find(row => row.writeId === writeId)
    check(entry, '$.writeId', 'Automatic write not found', 'NOT_FOUND')
    return entry
  }
  const result = (pack, cardRevision, entry, status = 'noop') => ({status, packId:pack?.manifest.id || null, revision:pack?.local.revision || null, cardRevision, writeId:entry?.writeId || null, refs:entry?.changes.map(row => row.ref) || []})
  async function publish(pack, before, local) {
    await storage.publish(pack.manifest.id, pack, local, before)
    evictMetadata(pack.manifest.id)
    emit({...pack,local}, before)
  }

  // One write's figure changes. `sources` loads another installed pack once per write (copies and copied voices).
  function figureWriter({manifest, files, hashed, images, writer, writerId, at, writeId, occurrenceId, request, sources}) {
    const image = key => {
      check(typeof key === 'string' && images.has(key), '$.changes[].image', 'Unknown image key')
      const found = images.get(key)
      addImage(manifest, files, hashed, found)
      return found
    }
    const catalogued = packId => check(request.catalogueRevisions.some(row => row.packId === packId), '$.changes[]', 'Source catalogue missing', 'REVISION_CONFLICT')
    async function bindVoice(figure, voice, added) {
      shape(voice, ['from','spec','language'], [], '$.changes[].voice')
      check(!voice.from !== !voice.spec, '$.changes[].voice', 'Choose from or spec')
      let spec, stem = 'auto-voice'
      if (voice.from) {
        shape(voice.from, ['packId','voiceId'], ['packId','voiceId'], '$.changes[].voice.from')
        catalogued(voice.from.packId)
        const source = await sources(voice.from.packId)
        spec = source.manifest.voiceLibrary?.voices[voice.from.voiceId]
        check(spec, '$.changes[].voice.from', 'Voice missing', 'ASSET_UNAVAILABLE')
        for (const ref of voiceReferences(spec)) {
          const descriptor = source.manifest.blobs[ref.media], name = `media/${ref.media}.${descriptor.ext}`
          manifest.blobs[ref.media] = clone(descriptor); files.set(name, source.files.get(name)); hashed.set(name, ref.media)
        }
        stem = voice.from.voiceId
      } else spec = voice.spec
      const library = manifest.voiceLibrary ||= {version:1, voices:{}}
      let id = Object.keys(library.voices).find(key => canonicalJson(library.voices[key]) === canonicalJson(spec))
      if (!id) {
        id = stem
        for (let n = 2; Object.hasOwn(library.voices, id); n++) id = stem.slice(0,60) + '-' + n
        library.voices[id] = clone(spec); added[id] = clone(spec)
      }
      figure.voice = {voice:id, ...(voice.language === undefined ? {} : {language:voice.language})}
    }
    function setSettei(figure, settei) {
      shape(settei, ['image','palette'], ['image'], '$.changes[].settei')
      check(!figure.identitySettei, '$.changes[].settei', '「' + figure.name + '」已经有人设图', 'DUPLICATE_ID')
      figure.identitySettei = {board:image(settei.image).hash, version:at, palette:clone(settei.palette || [])}
    }
    // A still image for one 差分 of one outfit. No outfit yet: a default one; its first image lets an avatar-only figure
    // onto the stage, and its avatar is the image's top crop (no separate avatar).
    function drawSprite(figure, row, spriteDeltas) {
      shape(row, ['outfit','emotion','image'], ['emotion','image'], '$.changes[].sprites[]')
      const emotion = matchBubbleMood(row.emotion, figure.emotions || [])
      check(emotion, '$.changes[].sprites[].emotion', '「' + figure.name + '」没有差分「' + row.emotion + '」；可用：' + (figure.emotions || []).map(item => item.label || item.id).join('、'), 'MISSING_DEPENDENCY')
      let outfit = row.outfit === undefined ? figure.outfits.find(item => item.enabled) : figure.outfits.find(item => item.key === row.outfit)
      check(outfit || row.outfit === undefined, '$.changes[].sprites[].outfit', 'Outfit missing', 'ASSET_UNAVAILABLE')
      if (!outfit) {
        let key = 'default'
        for (let n = 2; figure.outfits.some(item => item.key === key); n++) key = 'default-' + n
        outfit = {key, label:'默认', enabled:true}
        figure.outfits.push(outfit)
      }
      check(!outfit.live2d && !outfit.spine, '$.changes[].sprites[].outfit', 'A model outfit takes no still images')
      const picture = image(row.image)
      let key = outfit.sprite?.manifestKey, next
      if (!key) {
        key = 'auto' + randomUUID().replaceAll('-', '').slice(0, 24)
        const made = createSimpleSprite({images:{[emotion.id]:{hash:picture.hash, width:picture.width, height:picture.height}}, name:figure.name}, manifest.blobs)
        manifest.sprites[key] = `sprites/${key}/manifest.json`
        outfit.sprite = {manifestKey:key, assets:made.assets}
        next = made.manifest
        if (!spriteDeltas.has(key)) spriteDeltas.set(key, null)
      } else {
        const prior = readDocument(files.get(manifest.sprites[key]))
        if (!spriteDeltas.has(key)) spriteDeltas.set(key, prior)
        check(prior.emotions && !prior.emotions[emotion.id], '$.changes[].sprites[]', '「' + figure.name + '」的「' + (emotion.label || emotion.id) + '」已经有立绘', 'DUPLICATE_ID')
        const src = `assets/${emotion.id}-${picture.hash.slice(0, 12)}.png`
        next = {...prior, emotions:{...prior.emotions, [emotion.id]:prior.kind === 'static-sprites' ? {src} : {stage:{src, width:picture.width, height:picture.height}}}}
        const assets = {...outfit.sprite.assets, [src]:picture.hash}
        outfit.sprite = {...outfit.sprite, assets:Object.fromEntries(spriteResourcePaths(next).map(path => [path, assets[path]]))}
      }
      files.set(manifest.sprites[key], jsonBytes(next))
      // the default face is the figure's first 差分 once drawn; until then the first one drawn
      const first = figure.emotions[0].id
      if (emotion.id === first) delete outfit.defaultEmotion
      else if (!next.emotions[outfit.defaultEmotion ?? first]) outfit.defaultEmotion = emotion.id
      if (figure.appearance === 'avatar') figure.appearance = 'sprite'
    }
    return async function apply(change, seen) {
      check(writer.ops.includes(change?.op) && change.kind === 'figures', '$.changes', 'Writer operation not authorized', 'NOT_AUTHORIZED_WRITER')
      const [allowed, required] = CHANGE_FIELDS[change.op]
      shape(change, [...allowed, ...(writer.media ? ['voice','settei','sprites','looks'] : [])], required, '$.changes[]')
      const fields = [...(change.op === 'copy' ? ['figure'] : []), ...Object.keys(change.value || change.patch || {}), ...(change.op === 'create' ? ['emotions'] : []),
        ...(change.voice ? ['voice'] : []), ...(change.settei ? ['identitySettei'] : []), ...(change.sprites ? ['outfits','appearance'] : [])]
      const mark = {writeId, writerId, at, fields, source:{kind:writer.sourceKind, occurrenceId}}
      // voices: the voices this change added to the pack (a copy brings its figure's along), for undo
      let figureId, before = null
      const voices = {}, spriteDeltas = new Map()
      if (change.op === 'create') {
        shape(change.value, writer.texts, ['name','aliases'], '$.changes[].value')
        figureId = createFigure(manifest, files, {figure:{schemaVersion:1, ...clone(change.value), enabled:true, recall:{mode:'keyword'}, appearance:'avatar',
          emotions:clone(STANDARD_FIGURE_EMOTIONS), outfits:[], extensions:{'dsh.automatic-write':mark}}}).figureId
      } else if (change.op === 'copy') {
        shape(change.source, ['packId','figureId'], ['packId','figureId'], '$.changes[].source')
        catalogued(change.source.packId)
        const source = await sources(change.source.packId)
        check(source.figures[change.source.figureId], '$.changes[].source', 'Figure missing', 'ASSET_UNAVAILABLE')
        check((source.manifest.schemaVersion ?? 1) === (manifest.schemaVersion ?? 1), '$.changes[].source', '这个人物的图片格式和自动素材包不同，不能复制；请新建人物', 'UNSUPPORTED_SCHEMA_VERSION')
        // the copy takes the source figure's 配图 外貌 along; the host gives it a record of its own
        const look = (await figureImageExtras(source.manifest.id, [change.source.figureId]))[change.source.figureId]
        const had = new Set(Object.keys(manifest.voiceLibrary?.voices || {}))
        figureId = copyFigureAssets(source, change.source.figureId, manifest, files, {extensions:{...(look ? {[FIGURE_IMAGE_EXTENSION]:look} : {}), 'dsh.automatic-write':mark}}).figureId
        for (const [name, digest] of storedCopyHashes(files, [source])) hashed.set(name, digest)
        for (const [id, spec] of Object.entries(manifest.voiceLibrary?.voices || {})) if (!had.has(id)) voices[id] = clone(spec)
      } else {
        shape(change.ref, ['packId','kind','figureId'], ['packId','kind','figureId'], '$.changes[].ref')
        figureId = change.ref.figureId
        check(change.ref.packId === manifest.id && change.ref.kind === 'figures' && manifest.figures.includes(figureId), '$.changes[].ref', 'Only figures of the automatic pack can be changed', 'NOT_AUTHORIZED_WRITER')
        before = readDocument(files.get(`figures/${figureId}.json`))
      }
      check(!seen.has(figureId), '$.changes[]', 'One change per figure and write', 'DUPLICATE_ID'); seen.add(figureId)
      const file = `figures/${figureId}.json`
      let figure = readDocument(files.get(file))
      if (change.patch !== undefined) {
        shape(change.patch, writer.texts, [], '$.changes[].patch')
        figure = patchFigureDocument(figure, change.patch)
      }
      // a speaker created before figures came with the standard 差分 gets them with its next automatic change
      if (!figure.emotions?.length) figure.emotions = clone(STANDARD_FIGURE_EMOTIONS)
      // looks: the 外貌 the casting assistant wrote ({face, bodySFW}). Like a copied figure's, it is in transit to the figure's
      // 配图 人物库 record, its one home: the host moves it there after the write (image-character-follow.js), so 场景配图 draws the
      // same person as the 立绘.
      if (change.looks !== undefined) {
        shape(change.looks, ['face','bodySFW'], [], '$.changes[].looks')
        const traits = Object.fromEntries(Object.entries(change.looks).map(([key, text]) => [key, String(text ?? '').trim()]).filter(([, text]) => text))
        check(Object.keys(traits).length && Object.values(traits).every(text => text.length <= 400), '$.changes[].looks', '外貌每项不超过 400 字')
        figure.extensions = {...figure.extensions, [FIGURE_IMAGE_EXTENSION]:{...figure.extensions?.[FIGURE_IMAGE_EXTENSION], traits}}
      }
      if (change.voice !== undefined) await bindVoice(figure, change.voice, voices)
      if (change.settei !== undefined) setSettei(figure, change.settei)
      if (change.sprites !== undefined) {
        check(Array.isArray(change.sprites) && change.sprites.length > 0, '$.changes[].sprites')
        for (const row of change.sprites) drawSprite(figure, row, spriteDeltas)
      }
      files.set(file, jsonBytes(figure))
      const delta = before ? automaticFieldDelta(durableFigure(before), durableFigure(figure)) : {before:null, after:durableFigure(figure)}
      return {ref:{packId:manifest.id, kind:'figures', figureId}, ...delta,
        ...(spriteDeltas.size ? {sprites:Object.fromEntries([...spriteDeltas].map(([key, old]) => [key, {before:old, after:readDocument(files.get(manifest.sprites[key]))}]))} : {}),
        ...(Object.keys(voices).length ? {voices} : {})}
    }
  }

  return {
    registerAutomaticWriter({writerId, plan}) {
      check(Object.hasOwn(WRITERS, writerId) && typeof plan === 'function', '$.writerId', 'Writer is not authorized', 'NOT_AUTHORIZED_WRITER')
      let active = true
      const live = () => check(active, '$.writerId', 'Writer has been released', 'NOT_AUTHORIZED_WRITER')
      return Object.freeze({
        readContext({path}) {
          live()
          return run([], async () => {
            const card = await cards.snapshot({path})
            check(card.raw, '$.path', 'Card unavailable', 'NOT_FOUND')
            const packs = await all(), identity = cards.inspectRaw(card.raw), globalEnabledPackIds = globalPackIds()
            // A bound or global pack that is not installed is no catalogue to plan against (a shared card, a deleted pack):
            // the card is exactly one 自动素材 is for, so it is named (missingPackIds) and the automatic pack is still written.
            const named = [...new Set([...identity.boundPackIds,...globalEnabledPackIds])], ids = named.filter(id => packs.some(pack => pack.manifest.id === id))
            const routed = packs.find(pack => pack.local.autoWrite?.cardId === card.cardId)
            return {card, globalEnabledPackIds, missingPackIds:named.filter(id => !ids.includes(id)), packs:clone(packs.filter(pack => ids.includes(pack.manifest.id)).map(pack => ({manifest:pack.manifest,figures:pack.figures,revision:pack.local.revision}))),
              detached:!!routed && !identity.boundPackIds.includes(routed.manifest.id), target:routed ? {packId:routed.manifest.id,expectedRevision:routed.local.revision} : null}
          })
        },
        // 全库搜索: every installed pack, read only (library-search.js).
        searchLibrary({query, limit}) {
          live()
          return readRun([], async () => searchLibrary((await all()).map(pack => ({manifest:pack.manifest, figures:pack.figures, revision:pack.local.revision})), {query, limit}))
        },
        authorize(input, source, context) {
          live()
          for (const key of ['chatId','branchId','messageId']) check(typeof source?.[key] === 'string' && source[key].length > 0, '$.source.' + key)
          check(Number.isSafeInteger(source.turn) && source.turn > 0 && Number.isSafeInteger(source.revision) && source.revision >= 0, '$.source')
          check(Array.isArray(source.paragraphIds) && source.paragraphIds.every(id => typeof id === 'string' && id.length > 0), '$.source.paragraphIds')
          const authority = Object.freeze(Object.create(null))
          authorities.set(authority, {input:clone(input), source:clone(source), context:clone(context), plan, active:() => active, writerId})
          return authority
        },
        dispose() { active = false }
      })
    },
    writeAutomaticItems(input, authority) {
      const grant = authorities.get(authority)
      check(grant?.active() && sameRequest(grant.input, input), '$.authority', 'Writer is not authorized', 'NOT_AUTHORIZED_WRITER')
      const request = grant.input, writer = WRITERS[grant.writerId]
      check(typeof request.requestId === 'string' && request.requestId.length > 0, '$.requestId')
      check(Array.isArray(request.catalogueRevisions), '$.catalogueRevisions')
      return run([], async () => {
        check(grant.active(), '$.authority', 'Writer has been released', 'NOT_AUTHORIZED_WRITER')
        const card = await cards.snapshot({path:request.path})
        check(card.raw && card.revision === request.expectedCardRevision, '$.expectedCardRevision', 'Card changed', 'REVISION_CONFLICT')
        const identity = cards.inspectRaw(card.raw), packs = await all()
        const routed = packs.find(pack => pack.local.autoWrite?.cardId === card.cardId)
        if (routed && !identity.boundPackIds.includes(routed.manifest.id)) return result(routed, card.revision)
        check((request.target?.packId || null) === (routed?.manifest.id || null), '$.target', 'Automatic target changed', 'REVISION_CONFLICT')
        if (routed) cas(routed, request.target.expectedRevision)
        const installed = id => packs.some(pack => pack.manifest.id === id)
        for (const id of identity.boundPackIds.filter(installed)) {
          check(request.catalogueRevisions.some(row => row.packId === id), '$.catalogueRevisions', 'Bound catalogue missing', 'REVISION_CONFLICT')
        }
        for (const row of request.catalogueRevisions) {
          const pack = packs.find(pack => pack.manifest.id === row.packId)
          check(pack, '$.catalogue', 'Catalogue unavailable', 'ASSET_UNAVAILABLE')
          cas(pack, row.revision)
        }
        const duplicate = routed?.local.automaticWrites?.find(row => row.requestId === request.requestId)
        if (duplicate) return result(routed, card.revision, duplicate)
        // The registered planner, not free-form caller changes, owns the final intent.
        const globalEnabledPackIds = globalPackIds()
        for (const id of globalEnabledPackIds.filter(installed)) check(request.catalogueRevisions.some(row => row.packId === id), '$.catalogueRevisions', 'Global catalogue changed', 'REVISION_CONFLICT')
        const changes = await grant.plan({packs:clone(packs.map(pack => ({manifest:pack.manifest, figures:pack.figures, revision:pack.local.revision}))), card:clone(card), source:clone(grant.source), context:clone(grant.context), globalEnabledPackIds})
        check(canonicalJson(changes) === canonicalJson(request.changes), '$.changes', 'Catalogue changed; plan again', 'REVISION_CONFLICT')
        if (!changes.length) return result(routed, card.revision)
        const images = await readImages(request.images, writer)
        const before = routed ? await load(routed.manifest.id) : null
        const packId = before?.manifest.id || randomUUID()
        const manifest = before ? clone(before.manifest) : blankManifest(packId, identity.name + ' · 自动素材')
        const files = new Map(before?.files || []), hashed = new Map(), writeId = randomUUID(), at = new Date(now()).toISOString(), diffs = []
        const loaded = new Map()
        const sources = async id => {
          if (!loaded.has(id)) loaded.set(id, await load(id))
          check(loaded.get(id), '$.changes[]', 'Pack unavailable', 'ASSET_UNAVAILABLE')
          return loaded.get(id)
        }
        const apply = figureWriter({manifest, files, hashed, images, writer, writerId:grant.writerId, at, writeId, occurrenceId:randomUUID(), request, sources})
        const seen = new Set()
        for (const change of changes) diffs.push(await apply(change, seen))
        await sealPack(manifest, files, before, hashed)
        const pack = await verify(manifest, files, before, true)
        validatePackIdentities([...packs.filter(p => p.manifest.id !== packId).map(p => p.manifest), manifest])
        const local = nextLocal(before?.local)
        local.autoWrite ||= {cardId:card.cardId, createdName:manifest.name}
        const source = Object.fromEntries(['chatId','branchId','revision','turn','messageId','bodyOperationId','paragraphIds'].filter(key => grant.source[key] !== undefined).map(key => [key,clone(grant.source[key])]))
        const entry = {writeId, requestId:request.requestId, writerId:grant.writerId, at, source, changes:diffs, status:'pending'}
        local.automaticWrites = [...(local.automaticWrites || []), entry]
        check(jsonBytes(local).length <= limits.entrySize, '$.automaticWrites', 'Receipt budget exceeded', 'LIMIT_EXCEEDED')
        check(grant.active(), '$.authority', 'Writer has been released', 'NOT_AUTHORIZED_WRITER')
        let cardRevision = card.revision
        if (before) {
          await cards.withExistingBoundPack({path:request.path,expectedRevision:card.revision,packId}, () => {
            check(grant.active(), '$.authority', 'Writer has been released', 'NOT_AUTHORIZED_WRITER')
            return storage.publish(packId,pack,local,before)
          })
        } else {
          await cards.withBoundPack({path:request.path,expectedRevision:card.revision,packId}, async transaction => {
            check(grant.active(), '$.authority', 'Writer has been released', 'NOT_AUTHORIZED_WRITER')
            await storage.publishMany([{pack,local}], transaction)
            cardRevision = transaction.record.afterRevision
          })
        }
        evictMetadata(packId); emit({...pack,local}, before)
        return result({...pack,local}, cardRevision, entry, 'committed')
      })
    },
    listAutomaticWrites({packId, cursor = 0, limit = 50}) {
      validateUuid(packId)
      check(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 100, '$.cursor')
      return run([packId], async () => {
        const pack = await metadata(packId)
        check(pack, '$.packId', 'Pack unavailable', 'ASSET_UNAVAILABLE')
        const entries = pack.local.automaticWrites || [], end = Math.min(cursor + limit, entries.length)
        return {revision:pack.local.revision, entries:clone(entries.slice(cursor,end)), nextCursor:end < entries.length ? end : null}
      })
    },
    reviewAutomaticWrite({packId, expectedRevision, writeId}) {
      validateUuid(packId)
      return run([packId], async () => {
        const before = await metadata(packId); cas(before, expectedRevision)
        check(before, '$.packId', 'Pack unavailable', 'ASSET_UNAVAILABLE')
        const entry = receipt(before,writeId)
        if (entry.status !== 'pending') return {status:entry.status,revision:before.local.revision}
        const local = nextLocal(before.local)
        local.automaticWrites.find(row => row.writeId === writeId).status = 'reviewed'
        await publish(before,before,local)
        return {status:'reviewed',revision:local.revision}
      })
    },
    undoAutomaticWrite({packId, expectedRevision, writeId}) {
      validateUuid(packId)
      return run([packId], async () => {
        const before = await load(packId); cas(before,expectedRevision)
        check(before, '$.packId', 'Pack unavailable', 'ASSET_UNAVAILABLE')
        const entry = receipt(before,writeId)
        if (entry.status === 'undone') return {status:'undone',revision:before.local.revision,refs:[]}
        const present = entry.changes.filter(row => before.figures[row.ref.figureId])
        const restored = present.map(row => ({row, figure:undoAutomaticDelta(before.figures[row.ref.figureId],row)}))
        const manifest = clone(before.manifest), files = new Map(before.files), local = nextLocal(before.local)
        local.retired = [...local.retired]
        for (const {row,figure} of restored) {
          if (figure) files.set('figures/' + row.ref.figureId + '.json',jsonBytes(figure))
          else {
            manifest.figures = manifest.figures.filter(id => id !== row.ref.figureId)
            files.delete('figures/' + row.ref.figureId + '.json')
            local.retired.push('figure/' + row.ref.figureId)
          }
          // still images this write drew go back to the sprite they had (or the sprite goes)
          for (const [key, delta] of Object.entries(row.sprites || {})) {
            const name = manifest.sprites[key]
            check(name && canonicalJson(readDocument(files.get(name))) === canonicalJson(delta.after), '$.writeId', 'Automatically drawn image was changed', 'AUTOMATIC_WRITE_CHANGED')
            if (delta.before) files.set(name, jsonBytes(delta.before))
            else { delete manifest.sprites[key]; files.delete(name) }
          }
        }
        const remaining = manifest.figures.map(id => readDocument(files.get('figures/' + id + '.json')))
        trimAuthoringImages(manifest, files, before.figures)
        retireFigureBundles(manifest, files, restored.filter(item => !item.figure).map(item => before.figures[item.row.ref.figureId]), remaining)
        retireVoices(manifest, files, present.flatMap(row => Object.entries(row.voices || {})))
        await sealPack(manifest,files,before)
        budget(files,limits)
        const pack = await verify(manifest,files,before,true)
        local.automaticWrites.find(row => row.writeId === writeId).status = 'undone'
        await publish(pack,before,local)
        return {status:'undone',revision:local.revision,refs:present.map(row => row.ref)}
      })
    }
  }
}
