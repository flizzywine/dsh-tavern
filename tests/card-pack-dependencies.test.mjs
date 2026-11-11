// A .dshcard exported with only some of its bound packs keeps its bindings to the others: dsh.json `dependencies` lists
// them, the importer keeps the binding, names a missing pack in a Chinese notice, and the binding works as soon as that
// pack is installed — no re-import.
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAssetPacks } from '../tavern-plugin/lib/domain/asset-packs.js'
import { createCardFiles } from '../tavern-plugin/lib/domain/card-files.js'
import { createCardPlugins } from '../tavern-plugin/lib/domain/card-plugins.js'
import { createCardPreparation, projectCardSummary, rawData } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardSummaryCache } from '../tavern-plugin/lib/domain/card-summary-cache.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { listEffectiveAssets } from '../tavern-plugin/lib/domain/effective-assets.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { readZipEntries, writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createMediaStore } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media-store.js'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { createCardBundleAdapter } from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'

async function profile(t, name) {
  const root = await mkdtemp(join(tmpdir(), 'card-deps-' + name + '-'))
  const profileData = createProfileDataStore({ dataRoot: root }), fileResources = createFileResourceStore({ dataRoot: root })
  let serial = 0
  const cardPreparation = createCardPreparation({ id: () => name + '-card-' + ++serial, now: Date.now })
  const readCardWorkspace = async cardPath => {
    const existing = await fileResources.readCard(cardPath)
    if (existing === undefined || cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(cardPath, (working, payload) => cardPreparation.migrate({ working, payload }))
  }
  const cards = createCardBundleAdapter({ cardPreparation, authorizeTarget: async path => ({ cardId: path }), readWorkspace: path => readCardWorkspace(path),
    writeWorkspace: async () => assert.fail('an export writes no card'), withCardLock: async (_, task) => task() })
  let archiveSerial = 0
  const service = createAssetPackService({ assetRoot: join(root, 'library'), cardTransactions: cards,
    exportArchive: async file => { const output = join(root, 'pack-' + ++archiveSerial + '.zip'); await copyFile(file, output); return { output } } })
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) })
  const files = createCardFiles({
    cardPreparation, fileResources, castAssets: createCastAssets({ store: profileData }), readCardWorkspace, exportRoot: join(root, 'exports'),
    assetPacks: createAssetPacks({ store: profileData, mediaStore: createMediaStore({ root: join(root, 'asset-packs') }) }),
    cardSummaries: createCardSummaryCache({ absolute: cardPath => fileResources.absolute(cardPath), read: async cardPath => projectCardSummary(await readCardWorkspace(cardPath)) }),
    worldBooks: { characterBookForCard: async () => undefined }, cardPlugins: createCardPlugins({ dataRoot: root, pluginsDir: join(root, 'plugins') }),
    presetLibrary: {}, importPreset: () => assert.fail('no start defaults'), pluginApi: () => assert.fail('not a plugin format'), assetLibrary: () => service
  })
  const boundPackIds = async cardPath => rawData((await readCardWorkspace(cardPath)).raw).extensions.dsh_tavern.assetBindings.boundPackIds
  // What the stage runtime sees (asset-runtime.js): snapshots of the bound packs that exist, then the effective entries.
  const effectivePacks = async cardPath => {
    const ids = await boundPackIds(cardPath)
    const snapshots = (await Promise.all(ids.map(packId => service.getPackSnapshot({ packId })))).filter(Boolean)
    return [...new Set(listEffectiveAssets({ snapshots, boundPackIds: ids }).map(row => row.ref.packId))].sort()
  }
  const install = async file => {
    const preview = await service.inspectImportFile({ file })
    await service.applyImport({ inspectionId: preview.inspectionId, decision: 'install', expectedRevision: preview.expectedRevision })
  }
  return { root, files, service, boundPackIds, effectivePacks, install }
}

async function pack(service, name) {
  const made = await service.createPack({ name, expectedRevision: null }), packId = made.snapshot.manifest.id
  await service.createFigure({ packId, expectedRevision: made.snapshot.revision, figure: { schemaVersion: 1, name: name + ' 人物', enabled: true, appearance: 'sprite',
    recall: { mode: 'keyword' }, outfits: [{ key: 'default', label: '默认', enabled: true, recall: { mode: 'keyword', keywords: ['私服'] } }] } })
  return { packId, revision: (await service.getPackSnapshot({ packId })).revision }
}

test('a card exported without one of its packs keeps that binding and it works once the pack is installed', async t => {
  const source = await profile(t, 'source')
  const p1 = await pack(source.service, '素材包 A'), p2 = await pack(source.service, '通用背景')
  const p2Hash = (await source.service.getPackSnapshot({ packId: p2.packId })).manifest.contentHash
  const authored = join(source.root, 'authored.dshcard')
  await writeFile(authored, writeZipEntries([
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, packs: [] }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '依赖测试卡', description: 'fixture',
      extensions: { dsh_tavern: { schemaVersion: 1, assetBindings: { boundPackIds: [p1.packId, p2.packId] } } } } }) }]))
  const card = (await source.files.importCardArchiveFile(authored, 'authored.dshcard')).path
  assert.deepEqual(await source.effectivePacks(card), [p1.packId, p2.packId].sort())

  // Export embeds only P1; P2 stays bound and is declared as a dependency.
  const exported = await source.files.exportCardFile(card, { packIds: [p1.packId] })
  const cardFile = join(source.root, 'only-p1.dshcard')
  try { await copyFile(exported.file, cardFile) } finally { await exported.dispose() }
  const entries = readZipEntries(await readFile(cardFile))
  const manifest = JSON.parse(entries.get('dsh.json'))
  assert.deepEqual(manifest.packs.map(row => row.id), [p1.packId])
  assert.deepEqual(manifest.dependencies, [{ id: p2.packId, title: '通用背景', contentHash: p2Hash }])
  assert.deepEqual(JSON.parse(entries.get('card.json')).data.extensions.dsh_tavern.assetBindings.boundPackIds, [p1.packId, p2.packId])
  assert.ok(![...entries.keys()].some(name => name.startsWith('assets/' + p2.packId + '/')), 'P2 is not embedded')
  const p2Archive = (await source.service.exportPack({ packId: p2.packId, expectedRevision: p2.revision })).output

  // A library that already has P2: both bindings active, nothing to tell the player.
  const ready = await profile(t, 'ready')
  await ready.install(p2Archive)
  const withP2 = await ready.files.importCardArchiveFile(cardFile, 'only-p1.dshcard')
  assert.equal(withP2.libraryNotices, undefined)
  assert.deepEqual(await ready.boundPackIds(withP2.path), [p1.packId, p2.packId])
  assert.deepEqual(await ready.effectivePacks(withP2.path), [p1.packId, p2.packId].sort())

  // A library without P2: the import succeeds, the binding is kept but inert, and the notice names the pack.
  const fresh = await profile(t, 'fresh')
  const withoutP2 = await fresh.files.importCardArchiveFile(cardFile, 'only-p1.dshcard')
  assert.deepEqual(withoutP2.libraryNotices, ['这张卡还需要素材包「通用背景」：请先导入该包（素材库 → 导入），装好后绑定自动生效'])
  assert.deepEqual(await fresh.boundPackIds(withoutP2.path), [p1.packId, p2.packId])
  assert.deepEqual(await fresh.effectivePacks(withoutP2.path), [p1.packId])
  // Installing P2 later makes the kept binding effective without importing the card again.
  await fresh.install(p2Archive)
  assert.deepEqual(await fresh.effectivePacks(withoutP2.path), [p1.packId, p2.packId].sort())
  assert.deepEqual(await fresh.boundPackIds(withoutP2.path), [p1.packId, p2.packId])

  // A release scope that does not declare P2: the exported card leaves that binding out, so no import asks for it.
  const scoped = await source.files.exportCardFile(card, { packIds: [p1.packId], dependencyPackIds: [] })
  const scopedEntries = readZipEntries(await readFile(scoped.file))
  await scoped.dispose()
  assert.equal(JSON.parse(scopedEntries.get('dsh.json')).dependencies, undefined)
  assert.deepEqual(JSON.parse(scopedEntries.get('card.json')).data.extensions.dsh_tavern.assetBindings.boundPackIds, [p1.packId])
  assert.deepEqual(await source.boundPackIds(card), [p1.packId, p2.packId], 'the source card keeps its bindings')
})
