import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import { createAssetPackService } from '../tavern-plugin/lib/asset-library/pack-v2/service.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createStageMaterial, STAGE_LEASE_ORIGIN, STAGE_MEDIA_SCOPE, STAGE_READ_SCOPE } from '../tavern-plugin/lib/domain/stage-material.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { respondAssetLease } from '../tavern-plugin/lib/http/routes.js'
import { EventEmitter } from 'node:events'

const ORIGIN = STAGE_LEASE_ORIGIN
function png(r, g, b) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0))])
}
function wav(seconds = 1) {
  const bytes = Buffer.alloc(44 + 16000 * seconds)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000 * seconds, 40)
  return bytes
}
const file = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 32)

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stage-material-'))
  const store = createProfileDataStore({ dataRoot: path.join(root, 'data') })
  const castAssets = createCastAssets({ store })
  const scopes = []
  const library = createAssetPackService({ assetRoot: path.join(root, 'asset-packs'), authorizeLease: async ({ scope }) => { scopes.push(scope); return scope === STAGE_MEDIA_SCOPE || scope === STAGE_READ_SCOPE } })
  const material = createStageMaterial({ library, castAssets })
  t.after(async () => { material.dispose(); await library.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, store, castAssets, library, material, scopes }
}
const fetchLease = (library, url, headers = {}) => library.respondLease({ ticket: url.split('/').at(-2), resource: 'media', request: new Request(ORIGIN + url, { headers }) })

test('music keeps its lamps: blue and green tracks are listed with their recall, off ones are not; a track names its exact content', async t => {
  const { library, material, castAssets } = await fixture(t)
  const cardPath = 'cards/m.json'
  await material.importMaterial(cardPath, '丁', ['calm', 'storm', 'gone'].map((name, i) => ({ kind: 'music', name, ext: 'wav', bytes: wav(i + 1) })))
  const [packId] = (await castAssets.read(cardPath)).boundPackIds
  const pack = await library.getPackSnapshot({ packId })
  const assets = pack.manifest.assets.map(asset => asset.name === 'storm' ? { ...asset, recall: { mode: 'keyword', keywords: ['雷雨'] }, volume: 0.6, loopStart: 0.25, loopEnd: 1.5 }
    : asset.name === 'gone' ? { ...asset, enabled: false } : asset)
  await library.patchPack({ packId, expectedRevision: pack.revision, patch: { assets } })
  const { music } = await material.catalog(cardPath, '丁')
  assert.deepEqual(music.map(item => [item.name, item.recall.mode, item.pack]), [['calm', 'constant', '丁 · 本卡素材包'], ['storm', 'keyword', '丁 · 本卡素材包']])
  const track = await material.track(music[1])
  const storm = assets.find(asset => asset.name === 'storm')
  assert.deepEqual({ ...track, url: undefined }, { key: packId + '/' + storm.id, ref: { packId, kind: 'music', assetId: storm.id }, identity: packId + ':music:' + storm.id + ':' + storm.media,
    name: 'storm', pack: '丁 · 本卡素材包', url: undefined, volume: 0.6, loopStart: 0.25, loopEnd: 1.5 })
  assert.equal(track.url, await material.mediaUrl(music[1]), 'the page gets the reused lease of that media')
  assert.equal((await fetchLease(library, track.url)).status, 200)
})

test('the director gets lit backgrounds by name with their recall; off ones are not offered; leases are reused per media', async t => {
  const { library, material, castAssets, scopes } = await fixture(t)
  const cardPath = 'cards/a.json'
  const result = await material.importMaterial(cardPath, '甲', [
    { kind: 'backgrounds', name: 'room', ext: 'png', bytes: png(1, 2, 3) },
    { kind: 'backgrounds', name: 'hall', ext: 'png', bytes: png(4, 5, 6) },
    { kind: 'backgrounds', name: 'yard', ext: 'png', bytes: png(7, 8, 9) },
    { kind: 'music', name: 'theme', ext: 'wav', bytes: wav() },
    { kind: 'music', name: 'not audio', ext: 'mp3', bytes: Buffer.from('plain text, not audio') }])
  assert.deepEqual(result.added.map(item => item.name), ['room', 'hall', 'yard', 'theme'])
  assert.deepEqual(result.rejected.map(item => item.name), ['not audio'])
  const [packId] = (await castAssets.read(cardPath)).boundPackIds
  const pack = await library.getPackSnapshot({ packId })
  const assets = pack.manifest.assets.map(asset => asset.name === 'hall' ? { ...asset, recall: { mode: 'keyword', keywords: ['大厅'] } } : asset.name === 'yard' ? { ...asset, enabled: false } : asset)
  await library.patchPack({ packId, expectedRevision: pack.revision, patch: { assets } })

  const catalog = await material.catalog(cardPath, '甲')
  assert.deepEqual(catalog.background.map(item => [item.name, item.recall.mode]), [['room', 'constant'], ['hall', 'keyword']], 'a green background waits for its recall in the director')
  assert.deepEqual(catalog.music.map(item => item.name), ['theme'])
  assert.equal(JSON.stringify(catalog).includes('/lease/'), false, 'The frozen catalog holds no lease')

  const url = await material.mediaUrl(catalog.background[0])
  assert.equal(await material.mediaUrl(catalog.background[0]), url, 'One URL per media keeps a playing page steady')
  assert.equal(await material.mediaUrl(undefined), '')
  const response = await fetchLease(library, url)
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png(1, 2, 3))
  const ranged = await fetchLease(library, await material.mediaUrl(catalog.music[0]), { range: 'bytes=0-3' })
  assert.equal(ranged.status, 206)
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString(), 'RIFF')
  assert.ok(scopes.every(scope => scope === STAGE_MEDIA_SCOPE))
  await assert.rejects(library.respondLease({ ticket: url.split('/').at(-2), resource: 'media', request: new Request('http://evil.example' + url) }), /Cross-origin/)

  // The same bytes again are the same entry; a second import adds nothing.
  const again = await material.importMaterial(cardPath, '甲', [{ kind: 'backgrounds', name: 'room again', ext: 'png', bytes: png(1, 2, 3) }])
  assert.equal(again.added[0].id, result.added[0].id)
  assert.equal((await library.getPackSnapshot({ packId })).manifest.assets.length, 4)
})

test('a card from before the library moves its backgrounds and music once; unusable files stay kept; renames keep everything', async t => {
  const { store, castAssets, library, material } = await fixture(t)
  const from = 'cards/old.json', to = 'cards/new.json'
  const room = png(10, 20, 30), gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'), theme = wav(), odd = Buffer.from('ID3 but not really an mp3 stream')
  const key = castAssets.keyOf(from), dir = 'cast-assets/' + key
  const legacy = { version: 1, characters: [{ name: '甲', aliases: [], avatar: file(room) + '.png', sprites: {} }],
    backgrounds: [{ name: 'room', file: file(room) + '.png' }, { name: 'old', file: file(gif) + '.gif' }],
    extras: [{ type: 'music', name: 'theme', ext: 'wav', file: file(theme) + '.wav' }, { type: 'music', name: 'odd', ext: 'mp3', file: file(odd) + '.mp3' }, { type: 'x-risu-asset', name: 'bgm', ext: 'mp3', file: file(odd) + '.mp3' }] }
  await store.writeJson(dir + '/cast.json', legacy)
  for (const bytes of [[room, 'png'], [gif, 'gif'], [theme, 'wav'], [odd, 'mp3']]) await store.writeBytes(dir + '/files/' + file(bytes[0]) + '.' + bytes[1], bytes[0])

  // A rename before the move carries every file the manifest names.
  await castAssets.movePath(from, to)
  for (const name of [file(room) + '.png', file(gif) + '.gif', file(theme) + '.wav']) assert.ok(await castAssets.readFile(to, name), name)

  const catalog = await material.catalog(to, '甲')
  assert.deepEqual(catalog.background.map(item => item.name), ['room'])
  assert.deepEqual(catalog.music.map(item => item.name), ['theme'])
  const cast = await castAssets.read(to)
  assert.equal(cast.backgrounds, undefined)
  assert.deepEqual(cast.extras.map(item => [item.type, item.name]), [['music', 'odd'], ['x-risu-asset', 'bgm'], ['background', 'old']])
  assert.equal(cast.characters[0].avatar, file(room) + '.png', 'Character material stays where it was')
  assert.ok(await castAssets.readFile(to, file(room) + '.png'), 'A file still named by the avatar is not deleted')
  assert.equal(await castAssets.readFile(to, file(theme) + '.wav'), undefined, 'Moved music leaves the card files')
  assert.ok(await castAssets.readFile(to, file(gif) + '.gif'))

  // Once moved, a card is never moved again: kept music extras stay kept.
  const packs = await library.listPacks()
  await material.ready(to, '甲')
  assert.deepEqual(await library.listPacks(), packs)
  const exported = await material.exportMaterial(to, '甲')
  assert.deepEqual(exported.map(item => [item.type, item.name, item.bytes.equals(item.kind === 'music' ? theme : room)]), [['background', 'room', true], ['music', 'theme', true]])
})

// A node response stand-in that records what the lease route writes, with backpressure on every write.
function response() {
  const res = new EventEmitter()
  Object.assign(res, { status: 0, headers: {}, chunks: [], destroyed: false,
    writeHead(status, headers = {}) { res.status = status; res.headers = headers },
    write(chunk) { res.chunks.push(Buffer.from(chunk)); setImmediate(() => res.emit('drain')); return false },
    end() { res.ended = true }, destroy() { res.destroyed = true } })
  return res
}
const lease = (library, path, headers = {}, method = 'GET') => {
  const res = response()
  return respondAssetLease(library, { url: path, method, headers: { host: '127.0.0.1:8123', ...headers } }, res).then(() => res)
}

test('the host lease route: Tavern\'s origin check, ranges, HEAD reads no body, bounded chunks', async t => {
  const { library, material } = await fixture(t)
  const song = wav(70)
  await material.importMaterial('cards/c.json', '丙', [{ kind: 'music', name: 'long', ext: 'wav', bytes: song }])
  const url = await material.mediaUrl((await material.catalog('cards/c.json', '丙')).music[0])

  const page = await lease(library, url, { 'sec-fetch-site': 'same-origin' })
  assert.equal(page.status, 200)
  assert.ok(page.ended)
  assert.ok(page.chunks.length >= 2 && page.chunks.every(chunk => chunk.length <= 1024 ** 2), 'At most 1 MiB per chunk')
  assert.ok(Buffer.concat(page.chunks).equals(song))
  const ranged = await lease(library, url, { range: 'bytes=4-7', origin: 'http://127.0.0.1:8123' })
  assert.equal(ranged.status, 206)
  assert.equal(Buffer.concat(ranged.chunks).toString(), song.subarray(4, 8).toString())
  const head = await lease(library, url, {}, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.headers['content-length'], String(song.length))
  assert.equal(head.chunks.length, 0)
  assert.equal((await lease(library, url, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await lease(library, url, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await lease(library, url.replace(/lease\/[^/]+/, 'lease/' + 'x'.repeat(32)))).status, 503)
  assert.equal((await lease(library, '/api/dsh-asset-library/v2/lease/')).status, 404)
  assert.equal((await lease(library, url, {}, 'POST')).status, 405)
})

test('a removed pack drops out of the catalog and the next import makes the card a new one', async t => {
  const { castAssets, library, material } = await fixture(t)
  const cardPath = 'cards/b.json'
  await material.importMaterial(cardPath, '乙', [{ kind: 'backgrounds', name: 'room', ext: 'png', bytes: png(1, 1, 1) }])
  const [packId] = (await castAssets.read(cardPath)).boundPackIds
  const url = await material.mediaUrl((await material.catalog(cardPath, '乙')).background[0])
  await library.removePack({ packId, expectedRevision: (await library.getPackSnapshot({ packId })).revision })
  assert.deepEqual(await material.catalog(cardPath, '乙'), { background: [], music: [] })
  await assert.rejects(fetchLease(library, url), /removed/)
  await material.importMaterial(cardPath, '乙', [{ kind: 'backgrounds', name: 'hall', ext: 'png', bytes: png(2, 2, 2) }])
  const [next] = (await castAssets.read(cardPath)).boundPackIds
  assert.notEqual(next, packId)
  assert.deepEqual((await material.catalog(cardPath, '乙')).background.map(item => item.name), ['hall'])
})
