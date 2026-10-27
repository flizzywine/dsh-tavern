import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { BLOB_MIME_TYPES } from '../asset-library/asset-packs/index.js'
import { audioKind, imageKind } from '../asset-library/pack-v2/media.js'
import { validateStageSkin, stageSkinFiles } from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { validateStageEntrance } from './stage-entrance.js'

// A card's stage material (backgrounds, music, sound effects, ambience, items) lives in the asset library (docs/design/asset-library.md):
// entries of the card's own pack, which the card's cast manifest binds by id (boundPackIds).
// Leases are the only way bytes leave the library: the page gets a lease URL, export reads through one.
export const STAGE_MEDIA_SCOPE = 'dsh-tavern-stage'
export const STAGE_READ_SCOPE = 'dsh-tavern-host'
// The page may be served from a custom scheme; the host lease route applies Tavern's own origin
// check and presents every lease request to the library under this one host origin.
export const STAGE_LEASE_ORIGIN = 'http://dsh-tavern.internal'
// A lease outlives a long paused track; it is reused, so a page keeps one URL per media.
export const STAGE_LEASE_TTL_MS = 24 * 60 * 60 * 1000
const KINDS = Object.freeze({
  backgrounds: { id: 'bg', type: 'background', media: imageKind },
  music: { id: 'music', type: 'music', media: audioKind },
  sfx: { id: 'sfx', type: 'sfx', media: audioKind },
  ambience: { id: 'ambience', type: 'ambience', media: audioKind },
  props: { id: 'prop', type: 'prop', media: imageKind }
})
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const coded = (message, code) => Object.assign(new Error(message), { code })

function entryName(value, kind, index) {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return [...name].slice(0, 256).join('') || (KINDS[kind].type + '_' + (index + 1))
}

// `globalPackIds()`: the packs the player turned on for every card (全局, the tavern setting globalEnabledPackIds).
export function createStageMaterial({ library, castAssets, globalPackIds = async () => [], now = Date.now, warn = () => {} }) {
  // One writer per card: import, migration and the lazy check never interleave on a card's pack.
  const queues = new Map()
  function serial(cardPath, task) {
    const next = (queues.get(cardPath) || Promise.resolve()).then(task)
    const settled = next.then(() => {}, () => {})
    queues.set(cardPath, settled)
    void settled.then(() => { if (queues.get(cardPath) === settled) queues.delete(cardPath) })
    return next
  }
  const snapshotOf = packId => library.getPackSnapshot({ packId }).catch(() => null)
  const boundIds = async cardPath => {
    const ids = (await castAssets.read(cardPath)).boundPackIds
    return Array.isArray(ids) ? ids : []
  }

  // The card's own pack: the first bound pack, created as 「<卡名> · 本卡素材包」 when there is none.
  async function ownPack(cardPath, cardName) {
    const ids = await boundIds(cardPath)
    const existing = ids.length ? await snapshotOf(ids[0]) : null
    if (existing) return existing
    const taken = new Set((await library.listPacks()).map(pack => pack.manifest?.name))
    const base = (String(cardName || '').trim() || '人物卡') + ' · 本卡素材包'
    let name = base
    for (let n = 2; taken.has(name); n++) name = base + ' (' + n + ')'
    const { snapshot } = await library.createPack({ name, expectedRevision: null })
    // A bound pack that no longer exists is replaced by the new one.
    await castAssets.setBoundPackIds(cardPath, [snapshot.manifest.id, ...ids.slice(1)])
    return snapshot
  }

  // Each item is one publication, so one unusable file never blocks the rest. A new entry is 蓝灯 without trigger words.
  async function place(pack, kind, item, index, bytes, ext, hash) {
    const descriptor = { ext, mime: BLOB_MIME_TYPES[ext], size: bytes.length }
    for (let attempt = 1; attempt <= 9; attempt++) {
      const id = KINDS[kind].id + '-' + hash.slice(0, 16) + (attempt > 1 ? '-' + attempt : '')
      if (pack.manifest.assets.some(asset => asset.kind === kind && asset.id === id)) continue
      const entry = { kind, id, name: entryName(item.name, kind, index), enabled: true, recall: { mode: 'constant', keywords: [] }, directorNote: '', media: hash }
      try {
        const { snapshot } = await library.patchPack({ packId: pack.manifest.id, expectedRevision: pack.revision,
          patch: { assets: [...pack.manifest.assets, entry], blobs: { ...pack.manifest.blobs, [hash]: descriptor } },
          fileUpdates: pack.manifest.blobs[hash] ? new Map() : new Map([['media/' + hash + '.' + ext, bytes]]) })
        return { pack: snapshot, id }
      } catch (error) {
        // A retired id never names new content again; the next suffix does.
        if (error?.code !== 'DUPLICATE_ID') throw error
      }
    }
    throw coded('No free entry id', 'DUPLICATE_ID')
  }

  async function add(cardPath, cardName, items) {
    const added = [], rejected = []
    let pack = null
    for (const [index, item] of items.entries()) {
      const bytes = Buffer.from(item.bytes), ext = KINDS[item.kind].media(bytes)
      if (!ext) { rejected.push(item); continue }
      const hash = sha256(bytes)
      pack ||= await ownPack(cardPath, cardName)
      const same = pack.manifest.assets.find(asset => asset.kind === item.kind && asset.media === hash)
      if (same) { added.push({ ...item, id: same.id }); continue }
      try {
        const placed = await place(pack, item.kind, item, index, bytes, ext, hash)
        pack = placed.pack
        added.push({ ...item, id: placed.id })
      } catch (error) {
        if (error?.code === 'REVISION_CONFLICT') throw error
        rejected.push({ ...item, reason: error?.code || 'INVALID_INPUT' })
      }
    }
    // An empty binding list marks the card's material as library-owned, even when nothing fitted.
    if (!Array.isArray((await castAssets.read(cardPath)).boundPackIds)) await castAssets.setBoundPackIds(cardPath, [])
    return { added, rejected }
  }

  // The one move of material a card stored before the library existed: image backgrounds and music
  // extras become entries; what the library cannot hold stays as kept files, exported as before.
  async function migrate(cardPath, cardName) {
    const manifest = await castAssets.read(cardPath)
    const backgrounds = Array.isArray(manifest.backgrounds) ? manifest.backgrounds : null
    const music = Array.isArray(manifest.boundPackIds) ? [] : (manifest.extras || []).filter(item => item.type === 'music')
    if (!backgrounds && !music.length) return
    const items = []
    for (const [kind, rows] of [['backgrounds', backgrounds || []], ['music', music]]) {
      for (const row of rows) {
        const bytes = await castAssets.readFile(cardPath, row.file)
        if (bytes) items.push({ kind, name: row.name, ext: row.ext || String(row.file).split('.').pop(), file: row.file, bytes })
      }
    }
    const { added, rejected } = await add(cardPath, cardName, items)
    await castAssets.finishStageMove(cardPath, {
      moved: added.map(item => item.file),
      kept: rejected.filter(item => item.kind === 'backgrounds').map(item => ({ type: 'background', name: item.name, ext: item.ext, file: item.file }))
    })
  }
  const ready = (cardPath, cardName) => serial(cardPath, () => migrate(cardPath, cardName))

  // Leases are cached per media and renewed well before expiry, never revoked under a playing page.
  const leases = new Map()
  const stop = library.subscribe(event => {
    if (event.revision !== null) return
    for (const key of leases.keys()) if (key.startsWith(event.packId + '\u0000')) leases.delete(key)
  })
  async function mediaUrl(row, bundleKey, leaseBundle) {
    if (!row) return ''
    const key = bundleKey || row.ref.packId + '\u0000' + row.media
    const cached = leases.get(key)
    if (cached) {
      const lease = await cached.catch(() => null)
      // Renewed in the last quarter of its life, long before a paused page could hold an expired URL.
      if (lease && lease.expiresAt - now() > (lease.expiresAt - lease.issuedAt) / 4) return lease.url
      if (leases.get(key) === cached) leases.delete(key)
    }
    const issuedAt = now()
    const pending = (leaseBundle ? leaseBundle() : library.leaseMedia({ packId: row.ref.packId, hash: row.media, origin: STAGE_LEASE_ORIGIN, scope: STAGE_MEDIA_SCOPE })).then(lease => ({ ...lease, issuedAt }))
    leases.set(key, pending)
    pending.catch(() => { if (leases.get(key) === pending) leases.delete(key) })
    while (leases.size > 256) {
      const oldest = leases.keys().next().value
      leases.get(oldest).then(lease => library.releaseLease(lease.ticket)).catch(() => {})
      leases.delete(oldest)
    }
    try { return (await pending).url } catch (error) { warn(error); return '' }
  }

  // The card's packs in binding order, then (`global`) the player's global packs in id order.
  async function entries(cardPath, cardName, global = false) {
    try { await ready(cardPath, cardName) } catch (error) { warn(error) }
    const rows = [], bound = await boundIds(cardPath)
    for (const packId of global ? [...new Set([...bound, ...(await globalPackIds()).slice().sort()])] : bound) {
      const pack = await snapshotOf(packId)
      for (const asset of pack?.manifest.assets || []) if (Object.hasOwn(KINDS, asset.kind)) rows.push({ pack, asset })
    }
    return rows
  }

  // What the stage may use: lit entries, in binding then pack order, each with its recall, so the director is offered a
  // green entry only when the text names it or 判断模型 recalls it (stage-judge-recall.js; a green entry's director note
  // is what the judge reads). Names and refs only: the director's frozen catalog never holds a lease.
  async function catalog(cardPath, cardName) {
    const result = { background: [], music: [], sfx: [], ambience: [], items: [] }
    for (const { pack, asset } of await entries(cardPath, cardName, true)) {
      if (asset.enabled !== true) continue
      const row = { name: asset.name, ref: { packId: pack.manifest.id, kind: asset.kind, assetId: asset.id }, media: asset.media, recall: asset.recall,
        ...(asset.recall.mode === 'keyword' && asset.directorNote ? { note: asset.directorNote } : {}) }
      if (asset.kind === 'backgrounds') { result.background.push(row); continue }
      if (asset.kind === 'props') { result.items.push(row); continue }
      if (asset.kind === 'sfx' || asset.kind === 'ambience') { result[asset.kind].push(asset.volume === undefined ? row : { ...row, volume: asset.volume }); continue }
      result.music.push({ ...row, pack: pack.manifest.name,
        ...Object.fromEntries(['volume', 'loopStart', 'loopEnd'].filter(key => asset[key] !== undefined).map(key => [key, asset[key]])) })
    }
    return result
  }
  // A music (or ambience) row as the page plays it: identity names the exact content, so a renewed lease never restarts it.
  async function track(row) {
    const { ref } = row
    return { key: ref.packId + '/' + ref.assetId, ref, identity: ref.packId + ':' + ref.kind + ':' + ref.assetId + ':' + row.media, name: row.name, pack: row.pack,
      url: await mediaUrl(row), volume: row.volume, loopStart: row.loopStart, loopEnd: row.loopEnd }
  }

  // Bytes for a card export, read through a host-scoped lease (bounded chunks, publication fence).
  async function readMedia(packId, hash) {
    const lease = await library.leaseMedia({ packId, hash, origin: STAGE_LEASE_ORIGIN, scope: STAGE_READ_SCOPE })
    try {
      const response = await library.respondLease({ ticket: lease.ticket, resource: 'media', request: new Request(STAGE_LEASE_ORIGIN + lease.url) })
      if (!response.ok) throw coded('Media unavailable', 'ASSET_UNAVAILABLE')
      return Buffer.from(await response.arrayBuffer())
    } finally { library.releaseLease(lease.ticket) }
  }
  async function exportMaterial(cardPath, cardName) {
    const items = []
    for (const { pack, asset } of await entries(cardPath, cardName)) {
      // A card file has places for backgrounds and music only; items, sound effects and ambience stay in the library.
      if (['props', 'sfx', 'ambience'].includes(asset.kind)) continue
      const blob = pack.manifest.blobs[asset.media]
      items.push({ kind: asset.kind, type: KINDS[asset.kind].type, name: asset.name, ext: blob.ext, file: asset.media.slice(0, 32) + '.' + blob.ext, bytes: await readMedia(pack.manifest.id, asset.media) })
    }
    return items
  }

  // ---------- The editor (舞台素材, 舞台设置 › 素材包): every write is one CAS publication of the store ----------
  async function packOf(packId) {
    const pack = await library.getPackSnapshot({ packId })
    if (!pack) throw coded('Pack missing', 'ASSET_UNAVAILABLE')
    return pack
  }
  const kindOf = kind => { if (!Object.hasOwn(KINDS, kind)) throw coded('Unknown entry kind', 'INVALID_INPUT'); return kind }
  // Audio is not trimmed with its last entry by the store (images are): drop it here when nothing else plays it.
  function dropUnused(pack, assets, hash) {
    const blob = pack.manifest.blobs[hash]
    if (!blob || blob.mime.startsWith('image/') || assets.some(asset => asset.media === hash)) return { blobs: pack.manifest.blobs, files: new Map() }
    const blobs = { ...pack.manifest.blobs }
    delete blobs[hash]
    return { blobs, files: new Map([['media/' + hash + '.' + blob.ext, null]]) }
  }
  // Files a player adds to a pack: one entry per file, named after the file, 蓝灯 like a card import's.
  // The same bytes are the same entry; a file the library cannot hold is reported, the others still go in.
  const addFiles = (packId, kind, items) => serial('pack:' + packId, async () => {
    kindOf(kind)
    let pack = await packOf(packId)
    const added = [], rejected = []
    for (const [index, item] of items.entries()) {
      const bytes = Buffer.from(item.bytes), ext = KINDS[kind].media(bytes)
      if (!ext) { rejected.push({ name: item.name, reason: 'INVALID_INPUT' }); continue }
      const hash = sha256(bytes), same = pack.manifest.assets.find(asset => asset.kind === kind && asset.media === hash)
      if (same) { added.push(same.id); continue }
      try {
        const placed = await place(pack, kind, item, index, bytes, ext, hash)
        pack = placed.pack
        added.push(placed.id)
      } catch (error) {
        if (error?.code === 'REVISION_CONFLICT') throw error
        rejected.push({ name: item.name, reason: error?.code || 'INVALID_INPUT' })
      }
    }
    return { pack, added, rejected }
  })
  // 替换媒体…: the entry keeps its name, lamp, words and notes; only its picture or audio changes.
  const replaceMedia = (packId, expectedRevision, kind, id, input) => serial('pack:' + packId, async () => {
    kindOf(kind)
    const pack = await packOf(packId), bytes = Buffer.from(input), ext = KINDS[kind].media(bytes)
    if (!ext) throw coded('Unsupported media', 'INVALID_INPUT')
    const entry = pack.manifest.assets.find(asset => asset.kind === kind && asset.id === id)
    if (!entry) throw coded('Entry missing', 'ASSET_UNAVAILABLE')
    const hash = sha256(bytes)
    if (hash === entry.media) return { pack }
    const assets = pack.manifest.assets.map(asset => asset === entry ? { ...asset, media: hash } : asset)
    const old = dropUnused(pack, assets, entry.media), files = old.files
    if (!pack.manifest.blobs[hash]) files.set('media/' + hash + '.' + ext, bytes)
    const { snapshot } = await library.patchPack({ packId, expectedRevision, fileUpdates: files,
      patch: { assets, blobs: { ...old.blobs, [hash]: pack.manifest.blobs[hash] || { ext, mime: BLOB_MIME_TYPES[ext], size: bytes.length } } } })
    return { pack: snapshot }
  })
  // A skin (舞台皮肤) arrives as its folder: skin.json and the files it declares, by their paths relative to it. A skin with the
  // same id is replaced as a whole (its old files go); a new one owns the bundle skin-<id>. The store checks the document and
  // every file once, here; a skin is checked nowhere else.
  const addSkin = (packId, documentBytes, items) => serial('pack:' + packId, async () => {
    let document
    try { document = validateStageSkin(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(documentBytes))) }
    catch (error) { throw coded(error?.message || 'Invalid skin', error?.code === 'SKIN_CONTRAST' ? 'SKIN_CONTRAST' : 'INVALID_SKIN') }
    const given = new Map(items.map(item => [item.path, Buffer.from(item.bytes)]))
    const missing = stageSkinFiles(document).filter(file => !given.has(file))
    if (missing.length) throw coded('皮肤缺少文件：' + missing.slice(0, 3).join('、'), 'MISSING_DEPENDENCY')
    const pack = await packOf(packId), existing = pack.manifest.assets.find(asset => asset.kind === 'skins' && asset.id === document.id)
    const bundleKey = existing ? existing.bundleKey : 'skin-' + document.id, entry = existing ? existing.entry : 'skin.json'
    const base = 'bundles/' + bundleKey + '/', dir = entry.includes('/') ? entry.replace(/[^/]*$/, '') : ''
    const files = new Map(pack.manifest.files.filter(file => file.path.startsWith(base)).map(file => [file.path, null]))
    files.set(base + entry, Buffer.from(documentBytes))
    for (const file of stageSkinFiles(document)) files.set(base + dir + file, given.get(file))
    const asset = existing || { kind: 'skins', id: document.id, name: [...document.label].slice(0, 256).join(''), recall: { mode: 'constant', keywords: [] }, directorNote: '', bundleKey, entry }
    const { snapshot } = await library.patchPack({ packId, expectedRevision: pack.revision, fileUpdates: files,
      patch: { assets: existing ? pack.manifest.assets : [...pack.manifest.assets, asset], bundles: { ...pack.manifest.bundles, [bundleKey]: { kind: 'skin', entry, contentHash: '0'.repeat(64) } } } })
    return { pack: snapshot, id: document.id }
  })
  // 入场演出 arrives as its dsh.entrance/1 file and is checked once, here (and by the store's manifest check). The same
  // document again is the same entry; a new one is on (蓝灯), named after its label or the file.
  const addEntrance = (packId, fileName, bytes) => serial('pack:' + packId, async () => {
    let document
    try { document = validateStageEntrance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) }
    catch (error) { throw coded(error?.message || 'Invalid entrance', 'INVALID_ENTRANCE') }
    const pack = await packOf(packId), own = pack.manifest.assets.filter(asset => asset.kind === 'entrances')
    const same = own.find(asset => isDeepStrictEqual(asset.entrance, document))
    if (same) return { pack, id: same.id }
    let id = 'entrance', n = 1
    while (own.some(asset => asset.id === id)) id = 'entrance-' + ++n
    const name = [...(document.label || String(fileName).replace(/\.json$/i, '').trim() || '入场演出')].slice(0, 256).join('')
    const asset = { kind: 'entrances', id, name, enabled: true, recall: { mode: 'constant', keywords: [] }, directorNote: '', entrance: document }
    const { snapshot } = await library.patchPack({ packId, expectedRevision: pack.revision, patch: { assets: [...pack.manifest.assets, asset] } })
    return { pack: snapshot, id }
  })
  // The 入场演出 this card's stage opens with: only the card's own packs count (a global pack never opens every card's
  // stage), in binding order, then pack order; the first entrance that is on. Never part of the director's catalog.
  async function entrance(cardPath) {
    for (const packId of await boundIds(cardPath)) {
      const pack = await snapshotOf(packId), asset = pack?.manifest.assets.find(row => row.kind === 'entrances' && row.enabled === true)
      if (asset) return { ref: { packId, kind: 'entrances', assetId: asset.id }, name: asset.name, document: asset.entrance }
    }
    return null
  }
  // The pack's default stage skin (manifest.stageSkin), or none.
  async function setPackSkin(packId, expectedRevision, id) {
    const pack = await packOf(packId)
    if (id !== null && !pack.manifest.assets.some(asset => asset.kind === 'skins' && asset.id === id)) throw coded('Skin missing', 'ASSET_UNAVAILABLE')
    const { snapshot } = await library.patchPack({ packId, expectedRevision, patch: { stageSkin: id === null ? undefined : id } })
    return { pack: snapshot }
  }
  // A skin's files for the page: one reused lease per bundle content; `base` + a path in the skin is that file's URL.
  async function skinBase(packId, bundleKey, contentHash) {
    const key = packId + '\u0000bundle\u0000' + bundleKey + '\u0000' + contentHash
    const url = await mediaUrl({ ref: { packId }, media: contentHash }, key, () => library.leaseBundle({ packId, bundleKey, origin: STAGE_LEASE_ORIGIN, scope: STAGE_MEDIA_SCOPE }))
    return url ? url.replace(/[^/]*$/, '') : ''
  }
  async function removeEntry(packId, expectedRevision, kind, id) {
    if (kind === 'skins') {
      // A skin goes with its bundle; a pack default or card choice naming it simply stops applying (stage-skin-choice.js).
      const pack = await packOf(packId), entry = pack.manifest.assets.find(asset => asset.kind === 'skins' && asset.id === id)
      if (!entry) throw coded('Entry missing', 'ASSET_UNAVAILABLE')
      const bundles = { ...pack.manifest.bundles }
      delete bundles[entry.bundleKey]
      const files = new Map(pack.manifest.files.filter(file => file.path.startsWith('bundles/' + entry.bundleKey + '/')).map(file => [file.path, null]))
      const { snapshot } = await library.patchPack({ packId, expectedRevision, patch: { assets: pack.manifest.assets.filter(asset => asset !== entry), bundles }, fileUpdates: files })
      return { pack: snapshot }
    }
    if (kind === 'entrances') {
      // An entrance has no files: the entry is all there is.
      const pack = await packOf(packId), entry = pack.manifest.assets.find(asset => asset.kind === 'entrances' && asset.id === id)
      if (!entry) throw coded('Entry missing', 'ASSET_UNAVAILABLE')
      const { snapshot } = await library.patchPack({ packId, expectedRevision, patch: { assets: pack.manifest.assets.filter(asset => asset !== entry) } })
      return { pack: snapshot }
    }
    const pack = await packOf(packId), entry = pack.manifest.assets.find(asset => asset.kind === kindOf(kind) && asset.id === id)
    if (!entry) throw coded('Entry missing', 'ASSET_UNAVAILABLE')
    const assets = pack.manifest.assets.filter(asset => asset !== entry), { blobs, files } = dropUnused(pack, assets, entry.media)
    const { snapshot } = await library.patchPack({ packId, expectedRevision, patch: { assets, blobs }, fileUpdates: files })
    return { pack: snapshot }
  }

  return Object.freeze({
    addFiles,
    replaceMedia,
    removeEntry,
    addSkin,
    addEntrance,
    entrance,
    setPackSkin,
    skinBase,
    // A pack's picture or audio for the editor's previews: the same reused lease the stage plays.
    previewUrl: (packId, hash) => mediaUrl({ ref: { packId }, media: hash }),
    ready,
    catalog,
    mediaUrl,
    track,
    exportMaterial,
    hasMaterial: async (cardPath, cardName) => (await entries(cardPath, cardName)).length > 0,
    // Material a card file carried: { kind: 'backgrounds' | 'music', name, ext, bytes }[].
    importMaterial: (cardPath, cardName, items) => serial(cardPath, () => add(cardPath, cardName, items)),
    dispose() { stop(); leases.clear() }
  })
}
