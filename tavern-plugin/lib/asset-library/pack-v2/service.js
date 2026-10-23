import { randomUUID } from 'node:crypto'
import { channel } from 'node:diagnostics_channel'
import { resolveAssetSnapshot } from '../shared/asset-pack-refs.js'
import { validatePackDocuments, computeContentHash, sha256 } from '../asset-packs/index.js'
import { check, validateUuid, validateHash, validateAssetRef, canonicalJson } from '../asset-packs/common.js'
import { trimAuthoringImages } from './image-closure.js'
import { isMetadataEdit } from './metadata-edit.js'
import { decodeMedia } from './media.js'
import { createPackStorage } from './storage.js'
import { PACK_LIMITS, jsonBytes, sealPack, StoredFile, verifyBytes, packDiff } from './validation.js'
import { createPackLeases } from './leases.js'
export { PACK_LEASE_PATH } from './leases.js'

const readTiming = channel('dsh.asset.read')
const copy = value => structuredClone(value)
// Stored author JSON already crossed strict ingress validation; reads only decode it.
const storedDocument = bytes => {
  const started = performance.now()
  const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes)
  try { return JSON.parse(text) } catch (error) { throw Object.assign(error, {code:'INVALID_JSON'}) }
  finally { if (readTiming.hasSubscribers) readTiming.publish({name:'pack.json.parse', bytes:bytes.length, durationMs:performance.now() - started}) }
}
// Identities a pack has used; a removed entry's key is retired and never names new content.
const keys = pack => new Set(pack.manifest.assets.map(a => 'asset/' + a.kind + '/' + a.id))
const snapshot = pack => pack && copy({manifest:pack.manifest, revision:pack.local.revision, installedAt:pack.local.installedAt, updatedAt:pack.local.updatedAt})
function cas(current, expectedRevision, proposed) {
  const revision = current?.local?.revision ?? null
  if (expectedRevision === undefined || expectedRevision !== revision) throw Object.assign(new Error('Pack revision changed'), {code:'REVISION_CONFLICT', revision, diff:packDiff(proposed, current?.manifest)})
}
function cloneFilesWithDeletes(files) { return new Map([...files].map(([key,value]) => [key,value === null ? null : Buffer.from(value)])) }

/**
 * The asset library: packs of stage entries (backgrounds, music) and their media, under one explicit
 * profile-owned assetRoot. Every write is a compare-and-swap on the pack revision and one journaled
 * publication; reads and lease bytes pass the same publication fence. See docs/design/asset-library.md.
 */
export function createAssetPackService(options) {
  const limits = {...PACK_LIMITS, ...options.limits}, now = options.now || Date.now
  for (const [key, value] of Object.entries(limits)) check(Number.isSafeInteger(value) && value > 0, '$.limits.' + key)
  const storage = createPackStorage({...options, limits}), listeners = new Set()
  const blankManifest = (id, name, description) => ({format:'dsh-asset-pack', schemaVersion:1, id, name, ...(description === undefined ? {} : {description}), contentHash:'0'.repeat(64), assets:[], figures:[], sprites:{}, bundles:{}, blobs:{}, files:[]})
  const verify = (manifest, files, previous) => verifyBytes(manifest, files, {limits, decodeMedia:options.decodeMedia || decodeMedia, previous})
  // Installation times travel with the same atomic revision write.
  function nextLocal(prior, retired = prior?.retired || []) {
    const updatedAt = now()
    return {revision:randomUUID(), retired, installedAt:prior?.installedAt ?? updatedAt, updatedAt}
  }
  let disposed = false
  const pendingSnapshots = new Map()
  function alive() { check(!disposed, '$', 'Asset service disposed', 'ASSET_UNAVAILABLE') }
  const run = (ids, task, readOnly = false) => storage.run(ids, async () => { alive(); return task() }, readOnly)
  const readRun = (ids, task, readOnly = false) => storage.readRun(ids, async () => { alive(); return task() }, readOnly)
  const metadataCache = new Map()
  let metadataBytes = 0
  function evictMetadata(id) {
    const old = metadataCache.get(id)
    if (old) { metadataBytes -= old.size; metadataCache.delete(id) }
  }
  async function metadata(id) {
    const signature = await storage.stamp(id), cached = metadataCache.get(id)
    if (cached?.signature === signature) {
      metadataCache.delete(id); metadataCache.set(id, cached)
      return cached.pack
    }
    evictMetadata(id)
    if (signature === null) return null
    // Stored bytes were validated on ingress. Reads parse author documents only.
    const manifestBytes = await storage.read(`packs/${id}/manifest.json`, limits.entrySize)
    const manifest = storedDocument(manifestBytes)
    check(manifest.id === id, id, 'Incomplete pack publication', 'RECOVERY_REQUIRED')
    let total = manifestBytes.length
    check(total <= limits.totalSize, '$.manifest', 'Pack budget exceeded', 'LIMIT_EXCEEDED')
    check(manifest.files.length + 1 <= limits.entries, '$.files', 'File count budget exceeded', 'LIMIT_EXCEEDED')
    for (const file of manifest.files) {
      total += file.size
      check(file.size <= limits.entrySize && total <= limits.totalSize, file.path, 'Pack budget exceeded', 'LIMIT_EXCEEDED')
    }
    const local = await storage.local(id)
    check(typeof local?.revision === 'string' && Array.isArray(local.retired), id, 'Invalid local state', 'RECOVERY_REQUIRED')
    check(signature === await storage.stamp(id), '$.packId', 'Pack changed during validation', 'REVISION_CONFLICT')
    const pack = {manifest, local}, size = Buffer.byteLength(signature) + Buffer.byteLength(JSON.stringify(pack))
    if (size <= 32 * 1024 ** 2) {
      metadataCache.set(id, {signature, pack, size}); metadataBytes += size
      while (metadataBytes > 32 * 1024 ** 2 || metadataCache.size > 128) evictMetadata(metadataCache.keys().next().value)
    }
    return pack
  }
  function emit(pack, before) {
    const event = {packId:pack?.manifest.id || before.manifest.id, revision:pack?.local.revision ?? null, kinds:[...new Set([...(before?.manifest.assets || []), ...(pack?.manifest.assets || [])].map(a => a.kind))]}
    for (const listener of storage.subscribers) { try { listener(copy(event)) } catch { /* Observers cannot roll back a committed write. */ } }
  }
  async function install(pack, before) {
    const prior = before?.local || await storage.local(pack.manifest.id)
    const retired = new Set(prior?.retired || [])
    const nextKeys = keys(pack), oldKeys = before ? keys(before) : []
    for (const key of nextKeys) check(!retired.has(key), '$.identity', 'Retired identity cannot be reused: ' + key, 'DUPLICATE_ID')
    for (const key of oldKeys) if (!nextKeys.has(key)) retired.add(key)
    if (before?.manifest.contentHash === pack.manifest.contentHash) return {status:'noop', snapshot:snapshot(before)}
    const local = nextLocal(prior, [...retired].sort())
    alive()
    await storage.publish(pack.manifest.id, pack, local, before)
    const saved = {...pack, local}; emit(saved, before)
    return {status:before ? 'updated' : 'installed', snapshot:snapshot(saved)}
  }
  async function edit(input, mutate, tryMetadata = false) {
    validateUuid(input.packId)
    return run([input.packId], async () => {
      if (tryMetadata) {
        const before = await metadata(input.packId); cas(before, input.expectedRevision)
        check(before, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
        const manifest = copy(before.manifest)
        await mutate(manifest, new Map(), before)
        if (isMetadataEdit(before, manifest)) {
          validatePackDocuments({manifest})
          manifest.contentHash = await computeContentHash(manifest)
          if (manifest.contentHash === before.manifest.contentHash) return {status:'noop', snapshot:snapshot(before)}
          const local = nextLocal(before.local)
          await storage.publishMetadata(input.packId, manifest, new Map(), local)
          const saved = {...before, manifest, local}
          evictMetadata(input.packId); emit(saved, before)
          return {status:'updated', snapshot:snapshot(saved)}
        }
      }
      const authored = await metadata(input.packId); cas(authored, input.expectedRevision)
      check(authored, '$.packId', 'Pack missing', 'ASSET_UNAVAILABLE')
      // Keep untouched resources as stored identities, not a full in-memory copy of the pack.
      const before = {...authored, files:new Map(authored.manifest.files.map(file => [file.path, new StoredFile(file.size)]))}
      // `hashed` carries CAS names this edit just computed, so sealing does not hash those bytes again.
      const manifest = copy(before.manifest), files = new Map(before.files), hashed = new Map()
      const extra = await mutate(manifest, files, before, hashed)
      await sealPack(manifest, files, before, hashed)
      const verified = await verify(manifest, files, before)
      const result = await install(verified, before)
      return {...result, ...extra}
    })
  }
  // One revision fence for every lease read: a size, or one byte range.
  const leaseAccess = (entry, name, action) => readRun([entry.packId], async () => {
    const pack = await metadata(entry.packId)
    check(pack, '$.packId', 'Leased pack removed', 'ASSET_UNAVAILABLE')
    // Inert bytes follow content identity; a label or lamp publication must not break playing media.
    check(!!pack.manifest.blobs[entry.hash], '$.revision', 'Lease content changed', 'REVISION_CONFLICT')
    const file = pack.manifest.files.find(file => file.path === name)
    check(file, name, 'Lease resource outside manifest', 'ASSET_UNAVAILABLE')
    const result = await action(file)
    alive()
    return result
  })
  const leases = createPackLeases({now, ttlMs:options.leaseTtlMs, maxLeases:options.maxLeases,
    authorize:options.authorizeLease,
    inspect:(entry, name) => leaseAccess(entry, name, file => ({size:file.size})),
    readRange:(entry, name, position, length) => leaseAccess(entry, name, () => storage.readRange(`packs/${entry.packId}/${name}`, position, length))
  })
  const service = {
    apiVersion:2,
    capabilities:Object.freeze(['packs', 'blobs', 'leases']),
    listPacks:() => readRun([], async () => {
      const entries = []
      // Listing tolerates a broken pack; mutation/identity checks stay strict.
      for (const packId of await storage.listIds()) {
        try { const pack = await metadata(packId); if (pack) entries.push(snapshot(pack)) }
        catch (error) { entries.push({packId, error:{code:error.code || 'ASSET_UNAVAILABLE', message:error.message || String(error)}}) }
      }
      return entries
    }),
    getPackSnapshot({packId, readOnly = false}) {
      validateUuid(packId)
      const key = `${packId}:${Boolean(readOnly)}`
      let loading = pendingSnapshots.get(key)
      // Concurrent consumers share one gated publication read, never a retained snapshot.
      if (!loading) {
        loading = readRun([packId], async () => snapshot(await metadata(packId)), readOnly)
        pendingSnapshots.set(key, loading)
      }
      return loading.then(value => { alive(); return copy(value) }).finally(() => {
        if (pendingSnapshots.get(key) === loading) pendingSnapshots.delete(key)
      })
    },
    createPack(input) {
      const id = randomUUID()
      return run([id], async () => {
        cas(null, input.expectedRevision)
        const manifest = blankManifest(id, input.name, input.description)
        manifest.contentHash = await computeContentHash(manifest)
        return install(await verify(manifest, new Map()), null)
      })
    },
    patchPack(input) {
      // Full author-field replacement patch, plus exact byte updates. Never a revision/hash patch.
      const patch = copy(input.patch || {}), updates = input.fileUpdates ? cloneFilesWithDeletes(input.fileUpdates) : new Map()
      return edit(input, async (manifest, files) => {
        for (const key of Object.keys(patch)) check(!['id','format','schemaVersion','contentHash','files'].includes(key), '$.patch.' + key, 'Identity/hash fields cannot be patched')
        Object.assign(manifest, copy(patch))
        // An optional author field patched to undefined is removed.
        for (const [key, value] of Object.entries(patch)) if (value === undefined) delete manifest[key]
        for (const [name, bytes] of updates) {
          if (bytes === null) files.delete(name)
          else files.set(name, bytes)
        }
        trimAuthoringImages(manifest, files)
      }, !updates.size)
    },
    removePack(input) {
      validateUuid(input.packId)
      return run([input.packId], async () => {
        const before = await metadata(input.packId); cas(before, input.expectedRevision)
        check(before, '$', 'Pack missing', 'ASSET_UNAVAILABLE')
        // Removal is not retirement: the local tombstone keeps retired keys and the revision chain.
        await storage.publish(input.packId, null, nextLocal(before.local))
        evictMetadata(input.packId); emit(null, before)
        return {status:'removed', packId:input.packId}
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
    removeBlob(input) {
      validateHash(input.hash)
      return edit(input, async (manifest, files) => {
        const descriptor = manifest.blobs[input.hash]; check(descriptor, '$.hash', 'Blob missing', 'ASSET_UNAVAILABLE')
        delete manifest.blobs[input.hash]; files.delete(`media/${input.hash}.${descriptor.ext}`)
      })
    },
    resolveAssets:({refs}) => readRun(refs.map(ref => { validateAssetRef(ref); return ref.packId }), async () => {
      const result = [], packs = new Map(), ids = [...new Set(refs.map(ref => ref.packId))]
      let next = 0
      // Independent packs share the publication gate; drain reads before releasing it.
      const reads = await Promise.allSettled(Array.from({length:Math.min(8, ids.length)}, async () => {
        while (next < ids.length) {
          const id = ids[next++]
          packs.set(id, await metadata(id))
        }
      }))
      const failed = reads.find(read => read.status === 'rejected')
      if (failed) throw failed.reason
      for (const ref of refs) {
        const pack = packs.get(ref.packId)
        result.push(resolveAssetSnapshot(pack && {...pack, revision:pack.local.revision}, ref))
      }
      return result
    }),
    leaseMedia(input) {
      validateUuid(input.packId); validateHash(input.hash)
      return readRun([input.packId], async () => {
        const pack = await metadata(input.packId), descriptor = pack?.manifest.blobs[input.hash]
        check(descriptor, '$.hash', 'Blob missing', 'ASSET_UNAVAILABLE')
        return leases.issue({...input, revision:pack.local.revision, resources:[{name:'media', path:`media/${input.hash}.${descriptor.ext}`, mime:descriptor.mime, hash:input.hash}], entry:'media', kind:'media'})
      })
    },
    respondLease:(input) => leases.response(input),
    releaseLease:(ticket) => leases.release(ticket),
    subscribe(listener) { alive(); check(typeof listener === 'function', '$.listener'); storage.subscribers.add(listener); listeners.add(listener); return () => { storage.subscribers.delete(listener); listeners.delete(listener) } },
    async dispose() { disposed = true; leases.dispose(); metadataCache.clear(); metadataBytes = 0; for (const fn of listeners) storage.subscribers.delete(fn); listeners.clear(); await storage.run([], async () => {}) }
  }
  return service
}
