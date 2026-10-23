import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomFillSync, randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { mkdtemp, rm, readdir, mkdir, writeFile, rename, utimes, lstat } from 'node:fs/promises'
import { createAssetPackService, PACK_LEASE_PATH } from '../tavern-plugin/lib/asset-library/pack-v2/service.js'
import { createPackLeases, PACK_LEASE_CHUNK } from '../tavern-plugin/lib/asset-library/pack-v2/leases.js'
import { checkedPath } from '../tavern-plugin/lib/asset-library/pack-v2/storage.js'
import { jsonBytes } from '../tavern-plugin/lib/asset-library/pack-v2/validation.js'

// Synthetic profiles and media only: no real pictures, music, profiles or network.
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function png(color) {
  const crc = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0) } return (n ^ 0xffffffff) >>> 0 }
  const chunk = (type, bytes) => { const body = Buffer.concat([Buffer.from(type), bytes]), header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([header, body, tail]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 6
  const pixels = Buffer.alloc(8 * 33)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.set([...color, 255], y * 33 + 1 + x * 4)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
function wav(samples = 8) {
  const data = samples * 2, bytes = Buffer.alloc(44 + data)
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + data, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(data, 40)
  return bytes
}
// MPEG-1 Layer III, 128 kbit/s, 44.1 kHz: 417-byte frames, structurally checked by the built-in validator.
function mp3(frames = 4) { const frame = Buffer.alloc(417); frame.writeUInt32BE(0xfffb9000); return Buffer.concat(Array.from({length:frames}, () => frame)) }
const media = (bytes, ext, mime) => ({hash:digest(bytes), descriptor:{ext, mime, size:bytes.length}, bytes})
const entry = (kind, id, hash, extra = {}) => ({kind, id, name:id, enabled:true, recall:{mode:'keyword', keywords:[id + '-a', id + '-b']}, directorNote:'', media:hash, ...extra})

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asset-pack-service-')), assetRoot = path.join(root, 'assets')
  const service = createAssetPackService({assetRoot, authorizeLease:async () => true, ...options})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true, force:true}) })
  return {service, root, assetRoot}
}
// One pack holding a background and a music entry, written the way an editor writes: entries with their bytes, one publication.
async function stocked(service) {
  const created = await service.createPack({name:'Synthetic', expectedRevision:null})
  const packId = created.snapshot.manifest.id, image = media(png([160, 200, 240]), 'png', 'image/png'), audio = media(wav(), 'wav', 'audio/wav')
  const saved = await service.patchPack({packId, expectedRevision:created.snapshot.revision,
    patch:{assets:[entry('backgrounds', 'classroom', image.hash), entry('music', 'theme', audio.hash, {loopStart:0.5, loopEnd:0.9})], blobs:{[image.hash]:image.descriptor, [audio.hash]:audio.descriptor}},
    fileUpdates:new Map([[`media/${image.hash}.png`, image.bytes], [`media/${audio.hash}.wav`, audio.bytes]])})
  return {packId, image, audio, saved, current:saved.snapshot}
}
const rejected = code => error => { assert.equal(error.code, code); return true }

test('a pack is created, filled with a background and music, and read back with its exact media', async t => {
  const {service, root} = await fixture(t), {packId, image, audio, current, saved} = await stocked(service)
  assert.equal(saved.status, 'updated')
  assert.deepEqual(current.manifest.assets.map(a => a.kind + '/' + a.id), ['backgrounds/classroom', 'music/theme'])
  assert.deepEqual(current.manifest.files.map(f => f.path).sort(), [`media/${audio.hash}.wav`, `media/${image.hash}.png`].sort())
  assert.equal(JSON.stringify(current).includes(root), false)
  assert.deepEqual(await service.getPackSnapshot({packId}), current)
  assert.deepEqual((await service.listPacks()).map(p => p.manifest.id), [packId])
  const lease = await service.leaseMedia({packId, hash:image.hash, origin:'http://localhost', scope:'session'})
  const response = await service.respondLease({ticket:lease.ticket, resource:'media', request:new Request('http://localhost' + lease.url)})
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image.bytes)
  assert.ok(lease.url.startsWith(PACK_LEASE_PATH))
})

test('every write is a compare-and-swap on the pack revision; a stale or missing token loses', async t => {
  const {service, assetRoot} = await fixture(t), {packId, current} = await stocked(service)
  const second = createAssetPackService({assetRoot}); t.after(() => second.dispose())
  const results = await Promise.allSettled([service, second].map((s, i) => s.patchPack({packId, expectedRevision:current.revision, patch:{name:'edit ' + i}})))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const failure = results.find(r => r.status === 'rejected').reason
  assert.equal(failure.code, 'REVISION_CONFLICT'); assert.ok(failure.revision); assert.ok(failure.diff)
  await assert.rejects(service.patchPack({packId, patch:{name:'no token'}}), rejected('REVISION_CONFLICT'))
  await assert.rejects(service.createPack({name:'no token'}), rejected('REVISION_CONFLICT'))
  const latest = await service.getPackSnapshot({packId})
  const same = await service.patchPack({packId, expectedRevision:latest.revision, patch:{name:latest.manifest.name}})
  assert.equal(same.status, 'noop'); assert.equal(same.snapshot.revision, latest.revision)
})

test('lamp, name and notes are metadata publications; loop points and media are validated writes', async t => {
  const {service} = await fixture(t), {packId, current} = await stocked(service)
  const assets = structuredClone(current.manifest.assets)
  assets[0].enabled = false; assets[1].recall = {mode:'constant', keywords:[]}; assets[1].name = 'Main theme'
  const lamps = await service.patchPack({packId, expectedRevision:current.revision, patch:{assets}})
  assert.equal(lamps.status, 'updated')
  const resolved = await service.resolveAssets({refs:[{packId, kind:'backgrounds', assetId:'classroom'}, {packId, kind:'music', assetId:'theme'}, {packId:randomUUID(), kind:'music', assetId:'theme'}]})
  assert.deepEqual(resolved.map(r => r.diagnostics), [['asset-disabled'], [], ['asset-missing']])
  assert.equal(resolved[1].value.recall.mode, 'constant'); assert.equal(resolved[1].revision, lamps.snapshot.revision)
  const loop = structuredClone(lamps.snapshot.manifest.assets); loop[1].loopEnd = 0.2; loop[1].loopStart = 0.4
  await assert.rejects(service.patchPack({packId, expectedRevision:lamps.snapshot.revision, patch:{assets:loop}}), rejected('INVALID_ASSET_PACK'))
  const unknown = structuredClone(lamps.snapshot.manifest.assets); unknown[0].stageTheme = {}
  await assert.rejects(service.patchPack({packId, expectedRevision:lamps.snapshot.revision, patch:{assets:unknown}}), rejected('UNKNOWN_FIELD'))
  await assert.rejects(service.patchPack({packId, expectedRevision:lamps.snapshot.revision, patch:{assets:[...unknown.slice(1), {...unknown[0], kind:'cg'}]}}), rejected('INVALID_ASSET_PACK'))
  await assert.rejects(service.patchPack({packId, expectedRevision:lamps.snapshot.revision, patch:{figures:[randomUUID()]}}), rejected('UNKNOWN_FIELD'))
  await assert.rejects(service.patchPack({packId, expectedRevision:lamps.snapshot.revision, patch:{contentHash:'0'.repeat(64)}}), rejected('INVALID_ASSET_PACK'))
  assert.deepEqual(await service.getPackSnapshot({packId}), lamps.snapshot)
})

test('removing an entry retires its image and identity in one publication; removing the pack keeps a tombstone', async t => {
  const {service, assetRoot} = await fixture(t), events = [], off = service.subscribe(event => events.push(event))
  const {packId, image, current} = await stocked(service)
  const lease = await service.leaseMedia({packId, hash:image.hash, origin:'http://localhost', scope:'session'})
  const removed = await service.patchPack({packId, expectedRevision:current.revision, patch:{assets:current.manifest.assets.filter(a => a.kind !== 'backgrounds')}})
  assert.equal(removed.snapshot.manifest.blobs[image.hash], undefined)
  assert.equal(removed.snapshot.manifest.files.some(f => f.path.includes(image.hash)), false)
  await assert.rejects(service.respondLease({ticket:lease.ticket, resource:'media', request:new Request('http://localhost' + lease.url)}), rejected('REVISION_CONFLICT'))
  // A retired entry id never names new content in this pack.
  const again = media(png([1, 2, 3]), 'png', 'image/png')
  await assert.rejects(service.patchPack({packId, expectedRevision:removed.snapshot.revision, patch:{assets:[...removed.snapshot.manifest.assets, entry('backgrounds', 'classroom', again.hash)], blobs:{...removed.snapshot.manifest.blobs, [again.hash]:again.descriptor}},
    fileUpdates:new Map([[`media/${again.hash}.png`, again.bytes]])}), rejected('DUPLICATE_ID'))
  assert.deepEqual(await service.removePack({packId, expectedRevision:removed.snapshot.revision}), {status:'removed', packId})
  assert.equal(await service.getPackSnapshot({packId}), null)
  assert.deepEqual(await service.listPacks(), [])
  await assert.rejects(service.removePack({packId, expectedRevision:removed.snapshot.revision}), rejected('REVISION_CONFLICT'))
  assert.ok((await lstat(path.join(assetRoot, 'local', packId + '.json'))).isFile())
  assert.deepEqual(await readdir(path.join(assetRoot, 'staging')), [])
  assert.deepEqual(events.map(e => [e.packId, e.revision === null]), [[packId, false], [packId, false], [packId, false], [packId, true]])
  off()
})

test('removing a pack and an entry succeeds while a lease is streaming', async t => {
  const {service} = await fixture(t), created = await service.createPack({name:'Streaming', expectedRevision:null}), packId = created.snapshot.manifest.id
  const audio = media(mp3(Math.ceil(3 * PACK_LEASE_CHUNK / 417)), 'mp3', 'audio/mpeg')
  const saved = await service.patchPack({packId, expectedRevision:created.snapshot.revision, patch:{assets:[entry('music', 'long', audio.hash)], blobs:{[audio.hash]:audio.descriptor}}, fileUpdates:new Map([[`media/${audio.hash}.mp3`, audio.bytes]])})
  const lease = await service.leaseMedia({packId, hash:audio.hash, origin:'http://localhost', scope:'session'})
  const reader = (await service.respondLease({ticket:lease.ticket, resource:'media', request:new Request('http://localhost' + lease.url)})).body.getReader()
  assert.deepEqual(Buffer.from((await reader.read()).value), audio.bytes.subarray(0, PACK_LEASE_CHUNK))
  // Audio stays in the pack until its blob is removed; the open stream keeps reading it meanwhile.
  const emptied = await service.patchPack({packId, expectedRevision:saved.snapshot.revision, patch:{assets:[]}})
  assert.deepEqual(emptied.snapshot.manifest.assets, [])
  assert.deepEqual(Buffer.from((await reader.read()).value), audio.bytes.subarray(PACK_LEASE_CHUNK, 2 * PACK_LEASE_CHUNK))
  const dropped = await service.removeBlob({packId, expectedRevision:emptied.snapshot.revision, hash:audio.hash})
  await assert.rejects(reader.read(), rejected('REVISION_CONFLICT'))
  await service.removePack({packId, expectedRevision:dropped.snapshot.revision})
  assert.equal(await service.getPackSnapshot({packId}), null)
})

test('the blob store keys by actual hash, rejects MIME lies, standalone images and referenced removals', async t => {
  const {service} = await fixture(t), {packId, image, audio, current} = await stocked(service)
  assert.throws(() => service.putBlob({packId, expectedRevision:current.revision, bytes:image.bytes, descriptor:image.descriptor}), rejected('INVALID_ASSET_PACK'))
  const same = await service.putBlob({packId, expectedRevision:current.revision, bytes:audio.bytes, descriptor:audio.descriptor})
  assert.equal(same.status, 'noop'); assert.equal(same.hash, audio.hash); assert.equal(same.snapshot.revision, current.revision)
  await assert.rejects(service.putBlob({packId, expectedRevision:current.revision, bytes:audio.bytes, descriptor:{...audio.descriptor, ext:'mp3', mime:'audio/mpeg'}}))
  await assert.rejects(service.removeBlob({packId, expectedRevision:current.revision, hash:audio.hash}), rejected('MISSING_DEPENDENCY'))
  const unused = media(wav(16), 'wav', 'audio/wav'), put = await service.putBlob({packId, expectedRevision:current.revision, bytes:unused.bytes, descriptor:unused.descriptor})
  assert.equal(put.status, 'updated')
  const dropped = await service.removeBlob({packId, expectedRevision:put.snapshot.revision, hash:unused.hash})
  assert.equal(dropped.snapshot.manifest.blobs[unused.hash], undefined)
  // An unreferenced image never enters a pack; corrupt media never publishes.
  const stray = media(png([9, 9, 9]), 'png', 'image/png'), latest = dropped.snapshot
  const trimmed = await service.patchPack({packId, expectedRevision:latest.revision, patch:{blobs:{...latest.manifest.blobs, [stray.hash]:stray.descriptor}}, fileUpdates:new Map([[`media/${stray.hash}.png`, stray.bytes]])})
  assert.equal(trimmed.status, 'noop'); assert.equal(trimmed.snapshot.manifest.blobs[stray.hash], undefined)
  const broken = Buffer.from(png([5, 5, 5])); broken[40] ^= 1
  const bad = media(broken, 'png', 'image/png'), assets = [...latest.manifest.assets, entry('backgrounds', 'hall', bad.hash)]
  await assert.rejects(service.patchPack({packId, expectedRevision:latest.revision, patch:{assets, blobs:{...latest.manifest.blobs, [bad.hash]:bad.descriptor}}, fileUpdates:new Map([[`media/${bad.hash}.png`, bad.bytes]])}), /PNG/)
  assert.deepEqual(await service.getPackSnapshot({packId}), latest)
})

for (const point of ['prepared', 'backed-up', 'pack-published', 'local-published']) test('publication failure at ' + point + ' rolls back byte-for-byte without half packs', async t => {
  let failing = false
  const {service, assetRoot} = await fixture(t, {fault:async stage => { if (failing && stage === point) throw new Error('injected ' + point) }})
  const {packId, current} = await stocked(service); failing = true
  await assert.rejects(service.patchPack({packId, expectedRevision:current.revision, patch:{name:'Failed'}}), /injected/)
  await assert.rejects(service.patchPack({packId, expectedRevision:current.revision, patch:{assets:[]}}), /injected/)
  await assert.rejects(service.removePack({packId, expectedRevision:current.revision}), /injected/)
  assert.deepEqual(await service.getPackSnapshot({packId}), current)
  assert.deepEqual(await readdir(path.join(assetRoot, 'staging')), [])
  await assert.rejects(service.createPack({name:'Failed new', expectedRevision:null}), /injected/)
  assert.equal((await service.listPacks()).length, 1)
})

test('the next entry recovers a crash after pack publication before local publication', async t => {
  const {service, assetRoot} = await fixture(t), {packId, current} = await stocked(service)
  const tx = path.join(assetRoot, 'staging', randomUUID())
  await mkdir(tx, {recursive:true})
  await writeFile(path.join(tx, 'journal.json'), jsonBytes({version:1, id:packId, hadPack:true, hadLocal:true}))
  await rename(path.join(assetRoot, 'packs', packId), path.join(tx, 'old-pack'))
  await rename(path.join(assetRoot, 'local', packId + '.json'), path.join(tx, 'old-local.json'))
  await mkdir(path.join(assetRoot, 'packs', packId))
  await writeFile(path.join(assetRoot, 'packs', packId, 'manifest.json'), Buffer.from('{}'))
  // An ownerless staging tree is recovered only after the grace period.
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await utimes(tx, stale, stale)
  assert.deepEqual(await service.getPackSnapshot({packId}), current)
  assert.deepEqual(await readdir(path.join(assetRoot, 'staging')), [])
})

test('an unrecoverable journal closes the publication gate with RECOVERY_REQUIRED', async t => {
  const {service, assetRoot} = await fixture(t), tx = path.join(assetRoot, 'staging', randomUUID())
  await mkdir(tx, {recursive:true}); await writeFile(path.join(tx, 'journal.json'), Buffer.from('{}'))
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await utimes(tx, stale, stale)
  await assert.rejects(service.listPacks(), rejected('RECOVERY_REQUIRED'))
  await assert.rejects(service.createPack({name:'Blocked', expectedRevision:null}), rejected('RECOVERY_REQUIRED'))
  await rm(tx, {recursive:true})
  assert.deepEqual(await service.listPacks(), [])
})

test('leases enforce origin, authenticated scope, exact resource, Range/ETag/HEAD, expiry and revocation', async t => {
  let clock = 0, permitted = true
  const {service} = await fixture(t, {now:() => clock, leaseTtlMs:100, authorizeLease:async ({scope}) => permitted && scope === 'session'})
  const {packId, image} = await stocked(service)
  const lease = await service.leaseMedia({packId, hash:image.hash, origin:'http://localhost', scope:'session'})
  const req = (options = {}) => new Request('http://localhost' + lease.url, options)
  const response = options => service.respondLease({ticket:lease.ticket, resource:'media', request:req(options)})
  const full = await response(); assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'image/png')
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff'); assert.equal(full.headers.get('cross-origin-resource-policy'), 'same-origin')
  const range = await response({headers:{range:'bytes=0-3'}}); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), image.bytes.subarray(0, 4))
  const head = await response({method:'HEAD'}); assert.equal(head.body, null); assert.equal(head.headers.get('content-length'), String(image.bytes.length))
  assert.equal((await response({headers:{'if-none-match':full.headers.get('etag')}})).status, 304)
  assert.equal((await response({method:'POST'})).status, 405)
  await assert.rejects(response({headers:{origin:'https://evil.invalid'}}))
  await assert.rejects(response({headers:{'sec-fetch-site':'cross-site'}}))
  await assert.rejects(service.respondLease({ticket:lease.ticket, resource:'../media', request:req()}))
  await assert.rejects(service.leaseMedia({packId, hash:image.hash, origin:'http://localhost', scope:'other'}), rejected('ASSET_UNAVAILABLE'))
  permitted = false; await assert.rejects(response()); permitted = true
  clock = 101; await assert.rejects(response(), rejected('ASSET_UNAVAILABLE'))
  const next = await service.leaseMedia({packId, hash:image.hash, origin:'http://localhost', scope:'session'})
  assert.equal(service.releaseLease(next.ticket), true)
  await assert.rejects(service.respondLease({ticket:next.ticket, resource:'media', request:new Request('http://localhost' + next.url)}))
})

test('leased media survives lamp edits by any publisher; disposal and a missing authorizer fail closed', async t => {
  const {service, assetRoot} = await fixture(t), {packId, image, current} = await stocked(service)
  const input = {packId, hash:image.hash, origin:'http://localhost', scope:'session'}
  const lease = await service.leaseMedia(input)
  await service.patchPack({packId, expectedRevision:current.revision, patch:{name:'Changed'}})
  assert.equal((await service.respondLease({ticket:lease.ticket, resource:'media', request:new Request('http://localhost' + lease.url)})).status, 200)
  const writer = createAssetPackService({assetRoot}); t.after(() => writer.dispose())
  const latest = await writer.getPackSnapshot({packId})
  await writer.patchPack({packId, expectedRevision:latest.revision, patch:{name:'Another publisher'}})
  assert.equal((await service.respondLease({ticket:lease.ticket, resource:'media', request:new Request('http://localhost' + lease.url)})).status, 200)
  await assert.rejects(writer.leaseMedia(input), rejected('ASSET_UNAVAILABLE'))
  await service.dispose(); await assert.rejects(service.leaseMedia(input), rejected('ASSET_UNAVAILABLE'))
})

test('a leased body is read by bounded ranges: 304/HEAD/416 read nothing, bodies are byte-exact', async () => {
  const size = 32 * 1024 ** 2, stored = randomFillSync(Buffer.allocUnsafe(size))
  let bytesRead = 0, largestRead = 0, revoked = false
  const leases = createPackLeases({authorize:async () => true,
    inspect:async () => { if (revoked) throw Object.assign(Error('revision changed'), {code:'REVISION_CONFLICT'}); return {size} },
    readRange:async (_entry, _name, position, length) => {
      if (revoked) throw Object.assign(Error('revision changed'), {code:'REVISION_CONFLICT'})
      bytesRead += length; largestRead = Math.max(largestRead, length)
      return Buffer.from(stored.subarray(position, position + length))
    }})
  const lease = await leases.issue({packId:randomUUID(), revision:'v', kind:'media', scope:'s', origin:'http://localhost', entry:'media', resources:[{name:'media', path:'media/x.mp3', mime:'audio/mpeg', hash:'audio'}]})
  const response = options => leases.response({ticket:lease.ticket, resource:'media', request:new Request('http://localhost' + lease.url, options)})
  const body = async res => Buffer.from(await res.arrayBuffer())
  const measured = async action => { bytesRead = 0; largestRead = 0; const result = await action(); return {result, bytesRead} }
  assert.deepEqual(await measured(async () => (await response({headers:{'if-none-match':'"audio"'}})).status), {result:304, bytesRead:0})
  const head = await measured(() => response({method:'HEAD'}))
  assert.deepEqual([head.result.body, head.result.headers.get('content-length'), head.bytesRead], [null, String(size), 0])
  assert.deepEqual(await measured(async () => (await response({headers:{range:`bytes=${size}-`}})).status), {result:416, bytesRead:0})
  const tail = await measured(async () => { const res = await response({headers:{range:`bytes=${size - 8}-${size - 1}`}}); return [res.status, res.headers.get('content-range'), await body(res)] })
  assert.deepEqual(tail, {result:[206, `bytes ${size - 8}-${size - 1}/${size}`, stored.subarray(size - 8)], bytesRead:8})
  assert.deepEqual(await body(await response({headers:{range:'bytes=1000000-3500000'}})), stored.subarray(1000000, 3500001))
  assert.deepEqual(await body(await response({headers:{range:'bytes=-5'}})), stored.subarray(size - 5))
  // A media element opens with bytes=0-: nothing is read before the consumer pulls, then one bounded chunk at a time.
  bytesRead = 0
  const open = await response({headers:{range:'bytes=0-'}})
  assert.deepEqual([open.status, open.headers.get('content-length'), bytesRead], [206, String(size), 0])
  const reader = open.body.getReader(), first = await reader.read()
  assert.deepEqual(Buffer.from(first.value), stored.subarray(0, PACK_LEASE_CHUNK))
  await reader.cancel()
  assert.equal(bytesRead, PACK_LEASE_CHUNK)
  const full = await measured(async () => body(await response()))
  assert.ok(full.result.equals(stored)); assert.equal(full.bytesRead, size); assert.equal(largestRead, PACK_LEASE_CHUNK)
  // The revision fence holds for revalidation and for every chunk of an open stream.
  const streaming = (await response()).body.getReader()
  await streaming.read(); revoked = true
  await assert.rejects(streaming.read(), {code:'REVISION_CONFLICT'})
  await assert.rejects(response({headers:{'if-none-match':'"audio"'}}), {code:'REVISION_CONFLICT'})
  leases.dispose()
})

test('compressed media passes the built-in structural validator; inconsistent media is rejected', async t => {
  const {service} = await fixture(t), created = await service.createPack({name:'Codecs', expectedRevision:null}), packId = created.snapshot.manifest.id
  // A real tiny WebP bitstream and MPEG frames; this checks structure, not playback.
  const webp = media(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'), 'webp', 'image/webp'), song = media(mp3(), 'mp3', 'audio/mpeg')
  const saved = await service.patchPack({packId, expectedRevision:created.snapshot.revision,
    patch:{assets:[entry('backgrounds', 'dot', webp.hash), entry('music', 'song', song.hash)], blobs:{[webp.hash]:webp.descriptor, [song.hash]:song.descriptor}},
    fileUpdates:new Map([[`media/${webp.hash}.webp`, webp.bytes], [`media/${song.hash}.mp3`, song.bytes]])})
  assert.equal(saved.status, 'updated')
  const truncated = media(mp3().subarray(0, 600), 'mp3', 'audio/mpeg')
  await assert.rejects(service.putBlob({packId, expectedRevision:saved.snapshot.revision, bytes:truncated.bytes, descriptor:truncated.descriptor}), /MP3/)
  const lie = media(wav(), 'mp3', 'audio/mpeg')
  await assert.rejects(service.putBlob({packId, expectedRevision:saved.snapshot.revision, bytes:lie.bytes, descriptor:lie.descriptor}), /signature/)
})

test('filesystem reparse checks include root ancestors and reject before any read/write', async t => {
  const {assetRoot} = await fixture(t)
  let calls = 0
  await assert.rejects(checkedPath(assetRoot, 'packs/' + randomUUID(), async target => {
    calls++
    if (target === path.dirname(assetRoot)) return {isSymbolicLink:() => true}
    return lstat(target)
  }), rejected('INVALID_PATH'))
  assert.ok(calls > 1)
})

test('two packs share one stored copy of the same bytes; removing one keeps the other readable', async t => {
  const {service, assetRoot} = await fixture(t), first = await stocked(service), second = await stocked(service)
  assert.notEqual(first.packId, second.packId)
  assert.deepEqual((await readdir(path.join(assetRoot, 'blobs', first.image.hash.slice(0, 2)))).filter(name => name === first.image.hash), [first.image.hash])
  await service.removePack({packId:first.packId, expectedRevision:first.current.revision})
  const lease = await service.leaseMedia({packId:second.packId, hash:second.image.hash, origin:'http://localhost', scope:'session'})
  const response = await service.respondLease({ticket:lease.ticket, resource:'media', request:new Request('http://localhost' + lease.url)})
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), second.image.bytes)
})
