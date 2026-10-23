import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAssetPacks } from '../tavern-plugin/lib/domain/asset-packs.js'
import { createCardFiles } from '../tavern-plugin/lib/domain/card-files.js'
import { createCardPreparation, projectCardSummary } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardSummaryCache } from '../tavern-plugin/lib/domain/card-summary-cache.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { createStageMaterial } from '../tavern-plugin/lib/domain/stage-material.js'
import { createAssetPackService } from '../tavern-plugin/lib/asset-library/pack-v2/service.js'
import { readZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { crc32, deflateSync } from 'node:zlib'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

async function library(t) {
  const root = await mkdtemp(join(tmpdir(), 'card-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profileData = createProfileDataStore({ dataRoot: root })
  const fileResources = createFileResourceStore({ dataRoot: root })
  let serial = 0
  const cardPreparation = createCardPreparation({ id: () => 'card-' + ++serial, now: Date.now })
  const castAssets = createCastAssets({ store: profileData })
  const readCardWorkspace = async cardPath => {
    const existing = await fileResources.readCard(cardPath)
    if (existing === undefined || cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(cardPath, (working, payload) => cardPreparation.migrate({ working, payload }))
  }
  const cardSummaries = createCardSummaryCache({ absolute: cardPath => fileResources.absolute(cardPath), read: async cardPath => projectCardSummary(await readCardWorkspace(cardPath)) })
  const assetLibrary = createAssetPackService({ assetRoot: join(root, 'asset-packs-v2'), authorizeLease: async () => true })
  t.after(() => assetLibrary.dispose())
  const stageMaterial = createStageMaterial({ library: assetLibrary, castAssets })
  const files = createCardFiles({
    cardPreparation, fileResources, castAssets, stageMaterial, assetPacks: createAssetPacks({ root, store: profileData }), cardSummaries, readCardWorkspace,
    worldBooks: { characterBookForCard: async () => undefined },
    cardPlugins: {}, presetLibrary: {}, importPreset: () => assert.fail('no start defaults'), pluginApi: () => assert.fail('not a plugin format')
  })
  return { root, files, castAssets, assetLibrary, stageMaterial }
}

function png(r, g, b) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0))])
}
function wav() {
  const bytes = Buffer.alloc(16044)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40)
  return bytes
}

test('a CHARX card\'s backgrounds and music go into the card\'s own pack; what a pack cannot hold is kept; export writes both back', async t => {
  const { root, files, castAssets, assetLibrary, stageMaterial } = await library(t)
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '舞台', description: 'd', assets: [
    { type: 'background', name: 'main', uri: 'embeded://assets/background/room.png', ext: 'png' },
    { type: 'background', name: 'old', uri: 'embeded://assets/background/old.gif', ext: 'gif' },
    { type: 'music', name: 'theme', uri: 'embeded://assets/music/theme.wav', ext: 'wav' }] } }
  const charx = join(root, 'stage.charx')
  await writeFile(charx, writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, { path: 'assets/background/room.png', content: png(30, 70, 90) },
    { path: 'assets/background/old.gif', content: gif }, { path: 'assets/music/theme.wav', content: wav() }]))
  const imported = await files.importCardArchiveFile(charx, '舞台')
  assert.deepEqual(imported.assets, { sprites: 0, backgrounds: 1, avatars: 0, kept: 1, unmatched: [], skipped: 0 })

  const cast = await castAssets.read(imported.path)
  assert.equal(cast.backgrounds, undefined)
  assert.deepEqual(cast.extras.map(item => [item.type, item.name]), [['background', 'old']], 'GIF is not a stage format: kept for export')
  assert.equal(cast.boundPackIds.length, 1)
  const pack = await assetLibrary.getPackSnapshot({ packId: cast.boundPackIds[0] })
  assert.equal(pack.manifest.name, '舞台 · 本卡素材包')
  assert.deepEqual(pack.manifest.assets.map(asset => [asset.kind, asset.name, asset.enabled, asset.recall.mode]), [['backgrounds', 'main', true, 'constant'], ['music', 'theme', true, 'constant']])
  assert.deepEqual((await stageMaterial.catalog(imported.path, '舞台')).background.map(item => item.name), ['main'])

  const exported = await files.exportCardFile(imported.path)
  assert.equal(exported.extension, 'charx')
  const entries = readZipEntries(exported.bytes)
  const assets = JSON.parse(entries.get('card.json').toString()).data.assets
  assert.deepEqual(assets.map(asset => [asset.type, asset.name]), [['icon', 'main'], ['background', 'main'], ['background', 'old'], ['music', 'theme']])
  const bytesOf = (type, name) => entries.get(assets.find(asset => asset.type === type && asset.name === name).uri.replace('embeded://', ''))
  assert.deepEqual(bytesOf('background', 'main'), png(30, 70, 90))
  assert.deepEqual(bytesOf('music', 'theme'), wav())
  assert.deepEqual(bytesOf('background', 'old'), gif)
})

test('a CHARX imports once; the same file again opens the card already imported; a bare card exports as JSON', async t => {
  const { root, files } = await library(t)
  const charx = join(root, '鱼.charx')
  await writeFile(charx, writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: '鱼', description: '一条鱼' } }) }]))

  const first = await files.importCardArchiveFile(charx, '鱼')
  assert.equal(first.name, '鱼')
  assert.equal(first.format, 'charx')
  assert.equal(first.duplicate, undefined)

  const again = await files.importCardArchiveFile(charx, '鱼')
  assert.deepEqual(again, { path: first.path, name: '鱼', duplicate: true })

  const exported = await files.exportCardFile(first.path)
  assert.equal(exported.extension, 'json')
  assert.equal(JSON.parse(exported.bytes.toString()).data.description, '一条鱼')
})
