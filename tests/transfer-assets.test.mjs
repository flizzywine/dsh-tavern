import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import test from 'node:test'

import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { createTransferAssets } from '../tavern-plugin/lib/domain/transfer-assets.js'
import { readZipEntries, writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

// 合成素材：一张合法 PNG 与一段合法 WAV，不碰真实素材库或网络。
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
const media = (bytes, ext, mime) => ({ hash: digest(bytes), descriptor: { ext, mime, size: bytes.length }, bytes })
const entry = (kind, id, hash, extra = {}) => ({ kind, id, name: id, enabled: true, recall: { mode: 'keyword', keywords: [id + '-a', id + '-b', id + '-c'] }, directorNote: '', media: hash, ...extra })

async function tempRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'transfer-assets-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

/** 机器 A：一个包 = 一张背景 + 一段音乐，按编辑器写法一次发布。 */
async function stocked(t) {
  const root = await tempRoot(t), assetRoot = path.join(root, 'packs-a')
  const service = createAssetPackService({ assetRoot, authorizeLease: async () => true })
  t.after(() => service.dispose())
  const created = await service.createPack({ name: '秋日教室', expectedRevision: null })
  const packId = created.snapshot.manifest.id
  const image = media(png([160, 200, 240]), 'png', 'image/png')
  const audio = media(wav(), 'wav', 'audio/wav')
  await service.patchPack({ packId, expectedRevision: created.snapshot.revision,
    patch: { description: '合成的舞台素材', assets: [entry('backgrounds', 'classroom', image.hash), entry('music', 'theme', audio.hash, { loopStart: 0.5, loopEnd: 0.9 })], blobs: { [image.hash]: image.descriptor, [audio.hash]: audio.descriptor } },
    fileUpdates: new Map([[`media/${image.hash}.png`, image.bytes], [`media/${audio.hash}.wav`, audio.bytes]]) })
  const transfer = createTransferAssets({ root: assetRoot, library: service })
  return { root, assetRoot, service, transfer, packId, image, audio }
}

test('list 读出包名、条目数与字节，导出 zip 带 pack.json 与全部文件', async t => {
  const { transfer, packId, image, audio } = await stocked(t)
  const rows = await transfer.list()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].key, packId)
  assert.equal(rows[0].title, '秋日教室')
  assert.match(rows[0].meta, /背景 1 · 音乐 1/)
  assert.ok(rows[0].bytes >= image.bytes.length + audio.bytes.length)

  const items = await transfer.collect([packId])
  assert.equal(items.length, 1)
  const entries = readZipEntries(items[0].content, { label: '素材包' })
  const document = JSON.parse(entries.get('pack.json').toString('utf8'))
  assert.equal(document.spec, 'dsh-tavern.transfer.asset-pack')
  assert.equal(document.name, '秋日教室')
  assert.equal(document.description, '合成的舞台素材')
  assert.deepEqual(document.assets.map(asset => asset.kind + '/' + asset.id), ['backgrounds/classroom', 'music/theme'])
  assert.deepEqual(entries.get(`files/media/${image.hash}.png`), image.bytes)
  assert.deepEqual(entries.get(`files/media/${audio.hash}.wav`), audio.bytes)
  assert.equal(items[0].fileName, packId + '.zip')
})

test('导入到另一台机器：发新 id，条目、媒体与描述照原样立起来', async t => {
  const { transfer, packId, image, audio } = await stocked(t)
  const exported = await transfer.collect([packId])
  const otherRoot = path.join(await tempRoot(t), 'packs-b')
  const other = createAssetPackService({ assetRoot: otherRoot, authorizeLease: async () => true })
  t.after(() => other.dispose())
  const importer = createTransferAssets({ root: otherRoot, library: other })

  const imported = await importer.importOne({ key: packId, name: '秋日教室 (2)', content: exported[0].content })
  assert.notEqual(imported.id, packId)
  assert.equal(imported.name, '秋日教室 (2)')

  const snapshot = await other.getPackSnapshot({ packId: imported.id })
  assert.deepEqual(snapshot.manifest.assets.map(asset => asset.kind + '/' + asset.id), ['backgrounds/classroom', 'music/theme'])
  assert.equal(snapshot.manifest.description, '合成的舞台素材')
  assert.deepEqual(Buffer.from(await readFile(path.join(otherRoot, 'packs', imported.id, 'media', image.hash + '.png'))), image.bytes)
  assert.deepEqual(Buffer.from(await readFile(path.join(otherRoot, 'packs', imported.id, 'media', audio.hash + '.wav'))), audio.bytes)
  // 导入的包可以再生出同一份导出（往返稳定）。
  const again = await importer.collect([imported.id])
  const entries = readZipEntries(again[0].content, { label: '素材包' })
  assert.deepEqual(entries.get(`files/media/${image.hash}.png`), image.bytes)
})

test('坏包被拒绝：越界路径、别的 spec、没有文件，且不会留下空壳包', async t => {
  const { transfer, image } = await stocked(t)
  const otherRoot = path.join(await tempRoot(t), 'packs-c')
  const other = createAssetPackService({ assetRoot: otherRoot, authorizeLease: async () => true })
  t.after(() => other.dispose())
  const importer = createTransferAssets({ root: otherRoot, library: other })
  const pack = (extra = {}, files = {}) => writeZipEntries([{ path: 'pack.json', content: JSON.stringify({ spec: 'dsh-tavern.transfer.asset-pack', version: 1, name: '坏包', assets: [], ...extra }) },
    ...Object.entries(files).map(([entryPath, content]) => ({ path: entryPath, content }))])

  // zip 读取会先归一化条目名，越界路径落成普通文件名，再由素材库的命名空间检查拦下。
  await assert.rejects(importer.importOne({ content: pack({}, { 'files/media/../escape.png': image.bytes }) }), /越界路径|非法路径|Undeclared file namespace/)
  await assert.rejects(importer.importOne({ content: pack({ spec: 'other.spec' }) }), /spec 不符/)
  await assert.rejects(importer.importOne({ content: pack() }), /没有文件/)
  // 引用了不存在的媒体：素材库校验失败，新建的包要删掉，列表保持为空。
  await assert.rejects(importer.importOne({ content: pack({ assets: [entry('backgrounds', 'ghost', 'f'.repeat(64))], blobs: { ['f'.repeat(64)]: { ext: 'png', mime: 'image/png', size: image.bytes.length } } }) }))
  assert.deepEqual(await other.listPacks(), [])
})

test('缺文件的包在导出时报出来，而不是产出一份半包', async t => {
  const { transfer, packId, assetRoot, image } = await stocked(t)
  await rm(path.join(assetRoot, 'packs', packId, 'media', image.hash + '.png'))
  await assert.rejects(transfer.collect([packId]), /缺少文件/)
})
