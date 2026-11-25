// 更新包: a .dshcard exported on top of an earlier release leaves out the pack files that release already brought.
// Round trip: full v1 → update package → applied with 更新这张卡 → the same packs as a full v2 export. A player without
// v1 is refused before anything is written; an update stopped half way (the program killed) is put back at the next start.
import assert from 'node:assert/strict'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { syntheticFixture } from './helpers/synthetic-link-fixture.mjs'
import { createAssetPacks } from '../tavern-plugin/lib/domain/asset-packs.js'
import { createCardFiles } from '../tavern-plugin/lib/domain/card-files.js'
import { createCardPlugins } from '../tavern-plugin/lib/domain/card-plugins.js'
import { createCardPreparation, projectCardSummary, rawData } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardSummaryCache } from '../tavern-plugin/lib/domain/card-summary-cache.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { readZipEntries, writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createMediaStore } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media-store.js'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { createCardBundleAdapter } from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'

// A frozen service with one method wrapped.
const withMethod = (target, name, method) => ({ ...target, [name]: method })
// One profile as the host builds it: the card library and the asset library share one media store.
// `fault` (optional) is asked before each asset library import is applied and before the card's packs are bound.
function profile(t, name, { root = syntheticFixture(t, 'card-update-' + name + '-'), fault = () => {} } = {}) {
  const profileData = createProfileDataStore({ dataRoot: root }), fileResources = createFileResourceStore({ dataRoot: root })
  let serial = 0
  const cardPreparation = createCardPreparation({ id: () => name + '-card-' + ++serial, now: Date.now })
  const readCardWorkspace = async cardPath => {
    const existing = await fileResources.readCard(cardPath)
    if (existing === undefined || cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(cardPath, (working, payload) => cardPreparation.migrate({ working, payload }))
  }
  const mediaStore = createMediaStore({ root: join(root, 'asset-packs') })
  const options = { assetRoot: join(root, 'library'), mediaStore, cardTransactions: createCardBundleAdapter({ cardPreparation, authorizeTarget: async path => ({ cardId: path }),
    readWorkspace: path => readCardWorkspace(path), writeWorkspace: async () => assert.fail('an export writes no card'), withCardLock: async (_, task) => task() }) }
  const service = createAssetPackService(options)
  t.after(() => service.dispose())
  const library = withMethod(service, 'applyImport', async input => { if (input.decision !== 'cancel') await fault('apply'); return service.applyImport(input) })
  const castAssets = createCastAssets({ store: profileData })
  const files = createCardFiles({
    cardPreparation, fileResources, readCardWorkspace, exportRoot: join(root, 'exports'), mediaStore,
    castAssets: withMethod(castAssets, 'bindPacks', async (...args) => { await fault('bind'); return castAssets.bindPacks(...args) }),
    assetPacks: createAssetPacks({ store: profileData, mediaStore }),
    cardSummaries: createCardSummaryCache({ absolute: cardPath => fileResources.absolute(cardPath), read: async cardPath => projectCardSummary(await readCardWorkspace(cardPath)) }),
    worldBooks: { characterBookForCard: async () => undefined }, cardPlugins: createCardPlugins({ dataRoot: root, pluginsDir: join(root, 'plugins') }),
    presetLibrary: {}, importPreset: () => assert.fail('no start defaults'), pluginApi: () => assert.fail('not a plugin format'), assetLibrary: () => library,
    withCardBackup: async (file, input, consume) => {
      const backup = createAssetPackService({ ...options, privateExportFile: file })
      try { return await backup.withCardExport(input, consume) } finally { await backup.dispose() }
    },
    backupPack: async (file, input) => {
      const backup = createAssetPackService({ ...options, privateExportFile: file })
      try { return await backup.exportPack(input) } finally { await backup.dispose() }
    }
  })
  return { root, files, service, fileResources, readCardWorkspace }
}

// A short mono 16-bit WAV whose samples depend on `seed` (different seeds, different files).
function wav(seed) {
  const samples = 800, data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(8000 * Math.sin(i * (seed + 1) / 10)), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
async function addSounds(service, packId, seeds) {
  let snapshot = await service.getPackSnapshot({ packId })
  const assets = [...snapshot.manifest.assets]
  for (const seed of seeds) {
    const bytes = wav(seed)
    const staged = await service.putBlob({ packId, expectedRevision: snapshot.revision, bytes, descriptor: { ext: 'wav', mime: 'audio/wav', size: bytes.length } })
    assets.push({ kind: 'sfx', id: 'sound-' + seed, name: '声音 ' + seed, enabled: true, recall: { mode: 'keyword', keywords: ['声音' + seed] }, directorNote: '', media: staged.hash })
    snapshot = staged.snapshot
  }
  return (await service.patchPack({ packId, expectedRevision: snapshot.revision, patch: { assets } })).snapshot
}
async function exported(files, cardPath, options, file) {
  const result = await files.exportCardFile(cardPath, options)
  try { await copyFile(result.file, file) } finally { await result.dispose() }
  return { ...result, entries: readZipEntries(await readFile(file)) }
}
const packManifest = (entries, packId) => JSON.parse(entries.get('assets/' + packId + '/manifest.json'))

async function authorRelease(t) {
  const author = profile(t, 'author')
  const packId = (await author.service.createPack({ name: '卡的素材', expectedRevision: null })).snapshot.manifest.id
  await addSounds(author.service, packId, [1, 2, 3])
  const source = join(author.root, 'source.dshcard')
  await writeFile(source, writeZipEntries([
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, packs: [] }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '更新测试卡', description: '第一版', character_version: '1.0',
      extensions: { dsh_tavern: { schemaVersion: 1, assetBindings: { boundPackIds: [packId] } } } } }) }]))
  const cardPath = (await author.files.importCardArchiveFile(source, 'source.dshcard')).path
  const v1 = await exported(author.files, cardPath, {}, join(author.root, 'v1.dshcard'))
  const [release] = (await author.files.listCardReleases(cardPath)).releases
  assert.equal(release.version, '1.0')
  // v1.1: one sound added, one changed; the card is the author's next version.
  const snapshot = await author.service.getPackSnapshot({ packId })
  await author.service.patchPack({ packId, expectedRevision: snapshot.revision, patch: { assets: snapshot.manifest.assets.filter(asset => asset.id !== 'sound-3') } })
  await addSounds(author.service, packId, [4, 5])
  const workspace = await author.readCardWorkspace(cardPath)
  rawData(workspace.raw).character_version = '1.1'
  await author.fileResources.writeWorking(cardPath, JSON.stringify(workspace))
  const update = await exported(author.files, cardPath, { baseRelease: release.id }, join(author.root, 'v1.1-update.dshcard'))
  const v2 = await exported(author.files, cardPath, {}, join(author.root, 'v1.1.dshcard'))
  return { author, packId, cardPath, v1, update, v2, files: { v1: join(author.root, 'v1.dshcard'), update: join(author.root, 'v1.1-update.dshcard'), v2: join(author.root, 'v1.1.dshcard') } }
}

test('an update package carries the card and only the pack files its base release did not have, and applies to the same packs as a full export', async t => {
  const { packId, v1, update, v2, files } = await authorRelease(t)
  const dsh = JSON.parse(update.entries.get('dsh.json'))
  assert.equal(dsh.formatVersion, 2)
  assert.deepEqual(dsh.base, { version: '1.0' })
  assert.equal(JSON.parse(v2.entries.get('dsh.json')).formatVersion, 1, 'a full export stays readable by older versions')
  const before = new Set(packManifest(v1.entries, packId).files.map(file => file.sha256))
  const manifest = packManifest(update.entries, packId)
  assert.deepEqual(manifest, packManifest(v2.entries, packId), 'the update package lists the whole new pack')
  const carried = manifest.files.filter(file => update.entries.has('assets/' + packId + '/' + file.path))
  assert.deepEqual(carried.filter(file => file.path.startsWith('media/')).map(file => file.sha256).sort(),
    manifest.files.filter(file => file.path.startsWith('media/') && !before.has(file.sha256)).map(file => file.sha256).sort())
  assert.equal(carried.filter(file => file.path.startsWith('media/')).length, 2, 'only the two new sounds travel')
  assert.equal(update.update.base, '1.0')
  assert.ok(update.update.omitted >= 2)
  assert.ok(update.size < v2.size)
  assert.equal(JSON.parse(update.entries.get('card.json')).data.character_version, '1.1')

  // The player has v1 and updates the card with the package: the pack is exactly the full v1.1 pack.
  const player = profile(t, 'player')
  const card = await player.files.importCardArchiveFile(files.v1, 'v1.dshcard')
  const updated = await player.files.replaceCard(card.path, { file: files.update, name: 'v1.1-update.dshcard' })
  assert.equal(updated.updated, true)
  const installed = await player.service.getPackSnapshot({ packId })
  assert.equal(installed.manifest.contentHash, JSON.parse(v2.entries.get('dsh.json')).packs[0].contentHash)
  assert.deepEqual(installed.manifest.files, packManifest(v2.entries, packId).files)
  assert.equal(rawData((await player.readCardWorkspace(card.path)).raw).character_version, '1.1')
})

test('an update package without its base release is refused before anything is written', async t => {
  const { files } = await authorRelease(t)
  const stranger = profile(t, 'stranger')
  const before = await stranger.fileResources.list('card')
  const refused = { code: 'TAVERN_CARD_UPDATE_BASE_MISSING', message: /相对 1\.0 的更新包.*「卡的素材」里的 \d+ 个文件.*请先导入 1\.0 的完整包/ }
  await assert.rejects(stranger.files.previewCardArchiveFile(files.update, 'v1.1-update.dshcard'), refused)
  await assert.rejects(stranger.files.importCardArchiveFile(files.update, 'v1.1-update.dshcard'), refused)
  assert.deepEqual(await stranger.fileResources.list('card'), before)
  assert.deepEqual(await stranger.service.listPackSummaries?.() ?? [], [])
  // A card from another release line cannot take it either: the files it needs are not there.
  const other = await stranger.files.importCardArchiveFile(files.v2, 'v1.1.dshcard')
  assert.ok(other.path)
})

test('an update stopped half way (pack replaced, card not) is put back as before at the next start', async t => {
  const { packId, v1, files } = await authorRelease(t)
  let armed = false, crashed = false
  const root = syntheticFixture(t, 'card-update-crash-')
  const first = profile(t, 'crash', { root, fault: step => {
    // the pack has been replaced when the card's binding is written; the program dies there, and nothing can be undone.
    if (step === 'bind' && armed && !crashed) { crashed = true; throw new Error('killed') }
    if (step === 'apply' && crashed) throw new Error('killed')
  } })
  const card = await first.files.importCardArchiveFile(files.v1, 'v1.dshcard')
  const original = JSON.parse(v1.entries.get('dsh.json')).packs[0].contentHash
  armed = true
  await assert.rejects(first.files.replaceCard(card.path, { file: files.update, name: 'v1.1-update.dshcard' }), /自动恢复未完成/)
  assert.notEqual((await first.service.getPackSnapshot({ packId })).manifest.contentHash, original, 'the pack was replaced before the stop')

  // The next start: the update still marked running is put back.
  const next = profile(t, 'crash', { root })
  assert.deepEqual(await next.files.recoverCardUpdates(), [card.path])
  assert.equal((await next.service.getPackSnapshot({ packId })).manifest.contentHash, original)
  assert.equal(rawData((await next.readCardWorkspace(card.path)).raw).character_version, '1.0')
  assert.deepEqual(await next.files.recoverCardUpdates(), [], 'nothing is left to recover')
  // and the card updates normally afterwards.
  assert.equal((await next.files.replaceCard(card.path, { file: files.update, name: 'v1.1-update.dshcard' })).updated, true)
})

test('a release sent before releases were recorded is read back from its file as a base', async t => {
  const { author, cardPath, files, packId } = await authorRelease(t)
  const added = await author.files.addCardReleaseFromFile(cardPath, files.v1, 'v1.dshcard')
  assert.equal(added.source, 'file')
  assert.equal(added.version, '1.0')
  assert.equal((await author.files.listCardReleases(cardPath)).releases[0].id, added.id)
  const estimate = await author.files.estimateCardUpdate(cardPath, added.id, [packId])
  assert.ok(estimate.files >= 2 && estimate.bytes > 0)
  const again = await exported(author.files, cardPath, { baseRelease: added.id }, join(author.root, 'again.dshcard'))
  assert.equal(JSON.parse(again.entries.get('dsh.json')).formatVersion, 2)
})
