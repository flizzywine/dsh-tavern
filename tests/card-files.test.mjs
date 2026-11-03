import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAssetPacks } from '../tavern-plugin/lib/domain/asset-packs.js'
import { createMediaStore } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media-store.js'
import { createCardFiles } from '../tavern-plugin/lib/domain/card-files.js'
import { createCardPlugins } from '../tavern-plugin/lib/domain/card-plugins.js'
import { createCardPreparation, projectCardSummary } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardSummaryCache } from '../tavern-plugin/lib/domain/card-summary-cache.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { readZipEntries, writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { encryptCardArchiveFile } from '../tavern-plugin/lib/domain/card-encryption.js'
import { pngWithCard } from '../tavern-plugin/lib/domain/card-assets.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

async function library(t, extra = {}) {
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
  const files = createCardFiles({
    cardPreparation, fileResources, castAssets, assetPacks: createAssetPacks({ root, store: profileData, mediaStore: createMediaStore({ root: join(root, 'asset-packs') }) }), cardSummaries, readCardWorkspace,
    worldBooks: { characterBookForCard: async () => undefined },
    cardPlugins: createCardPlugins({ dataRoot: root, pluginsDir: join(root, 'plugins') }), presetLibrary: {}, importPreset: () => assert.fail('no start defaults'), ...extra, pluginApi: () => assert.fail('not a plugin format')
  })
  return { root, files, fileResources, castAssets }
}

test('encrypted DSH imports authenticate before saving cards/plugins, and duplicates still require the password', async t => {
  const { root, files, fileResources, castAssets } = await library(t)
  const plain = join(root, 'plain.dshcard'), encrypted = join(root, 'locked.dshcard')
  await writeFile(plain, writeZipEntries([
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, plugins: [{ name: 'encrypted-game', path: 'plugins/game/' }] }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: '加密测试卡', description: 'opaque fixture' } }) },
    { path: 'plugins/game/package.json', content: JSON.stringify({ name: 'encrypted-game', version: '1.0.0' }) },
    { path: 'plugins/game/index.mjs', content: 'export function apply() {}' },
    { path: 'plugins/game/assets/data.bin', content: 'fixture bytes' },
  ]))
  await encryptCardArchiveFile(plain, encrypted, 'test-only-password')
  await assert.rejects(files.importCardArchiveFile(encrypted, 'locked.dshcard'), { code: 'TAVERN_CARD_PASSWORD_REQUIRED' })
  await assert.rejects(files.importCardArchiveFile(encrypted, 'locked.dshcard', { password: 'wrong' }), { code: 'TAVERN_CARD_PASSWORD_INVALID' })
  assert.deepEqual(await fileResources.list('card'), [])
  const card = await files.importCardArchiveFile(encrypted, 'locked.dshcard', { password: 'test-only-password' })
  assert.equal(card.name, '加密测试卡')
  assert.equal((await castAssets.read(card.path)).plugins[0].enabled, true)
  await assert.rejects(files.importCardArchiveFile(encrypted, 'locked.dshcard'), { code: 'TAVERN_CARD_PASSWORD_REQUIRED' })
  assert.equal((await files.importCardArchiveFile(encrypted, 'locked.dshcard', { password: 'test-only-password' })).duplicate, true)
})

test('a CHARX imports once; the same file again opens the card already imported; a bare card exports as DSH', async t => {
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
  assert.equal(exported.extension, 'dshcard')
  assert.equal(JSON.parse(readZipEntries(exported.bytes).get('card.json').toString()).data.description, '一条鱼')
})

test('an encrypted ST PNG imports its cover into the library and exports a single DSH container', async t => {
  const { root, files, fileResources } = await library(t)
  const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8V8AAAAASUVORK5CYII=', 'base64')
  const input = join(root, 'source.png'), locked = join(root, 'locked.dshcard')
  await writeFile(input, pngWithCard(cover, JSON.stringify({ spec: 'chara_card_v3', data: { name: '封面测试', description: 'private' } })))
  await encryptCardArchiveFile(input, locked, 'test-password', { name: 'source.png' })
  const card = await files.importCardArchiveFile(locked, 'locked.dshcard', { password: 'test-password' })
  assert.ok((await fileResources.readCardImage(card.path)).length >= cover.length)
  const exported = await files.exportCardFile(card.path)
  assert.equal(exported.extension, 'dshcard')
  assert.equal(exported.bytes.readUInt32LE(0), 0x04034b50)
  const entries = readZipEntries(exported.bytes)
  assert.equal(JSON.parse(entries.get('dsh.json')).format, 'dshcard')
  assert.deepEqual(entries.get('assets/icon/image/main.png'), cover)
})


test('invalid card plugin identity fails before persistence; retries stay failures and a corrected archive imports normally', async t => {
  const { root, files, fileResources, castAssets } = await library(t)
  const archive = join(root, 'legacy.dshcard')
  const writeArchive = async pkg => writeFile(archive, writeZipEntries([
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, plugins: [{ name: 'director', path: 'plugins/director/' }] }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: '旧插件卡', description: '回归' } }) },
    { path: 'plugins/director/package.json', content: JSON.stringify(pkg) },
    { path: 'plugins/director/index.mjs', content: 'export function apply() {}' },
  ]))
  await writeArchive({ name: 'director', main: './index.mjs' })
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(files.importCardArchiveFile(archive, 'legacy.dshcard'), error => error.code === 'TAVERN_CARD_ARCHIVE_INVALID' && /version/.test(error.message))
    assert.deepEqual(await fileResources.list('card'), [], 'failed import must not save a card or remembered duplicate')
  }
  await writeArchive({ name: 'director', version: '1.0.0', main: './index.mjs' })
  const imported = await files.importCardArchiveFile(archive, 'legacy.dshcard')
  assert.equal(imported.duplicate, undefined)
  assert.equal(imported.plugins[0].enabled, true)
  assert.equal((await castAssets.read(imported.path)).plugins[0].enabled, true)
  assert.equal((await files.importCardArchiveFile(archive, 'legacy.dshcard')).duplicate, true)
})


// The stage reads packs from the asset library: a card's packs install there too. A new pack is installed, an
// identical one left as it is; a different installed version is not touched but reported. Importing the very same
// file again still makes sure its packs are in the library (cards imported before the library carry none there).
test('DSH 人物卡的素材包装进素材库：新包安装、相同的不动、不同版本只提示；重复导入也补装', async t => {
  const { openZipFile } = await import('../tavern-plugin/lib/domain/zip-file.js')
  const fresh = '55555555-5555-4555-8555-555555555555', changed = '66666666-6666-4666-8666-666666666666'
  const installed = new Map([[changed, 'other-version']]), applied = []
  const assetLibrary = () => ({
    async inspectImportFile({ file }) {
      const zip = await openZipFile(file)
      try {
        const manifest = JSON.parse((await zip.readBuffer(zip.entries.get('manifest.json'), 65536)).toString())
        assert.ok(zip.entries.has('media/a.png'), 'the pack is re-rooted: its own files at the top')
        const choices = !installed.has(manifest.id) ? ['install', 'keep-both', 'cancel'] : installed.get(manifest.id) === manifest.contentHash ? ['noop', 'cancel'] : ['update', 'keep-both', 'cancel']
        return { inspectionId: manifest.id, packId: manifest.id, contentHash: manifest.contentHash, expectedRevision: null, choices, scriptRisk: [] }
      } finally { await zip.close() }
    },
    async applyImport({ inspectionId, decision }) {
      applied.push([inspectionId, decision])
      if (decision === 'install') installed.set(inspectionId, 'v1')
      return { status: decision }
    },
  })
  const { root, files } = await library(t, { assetLibrary })
  const card = join(root, '鱼.dshcard')
  const pack = (id, name) => [[`assets/${name}/manifest.json`, JSON.stringify({ id, contentHash: 'v1' })], [`assets/${name}/media/a.png`, 'png']]
  await writeFile(card, writeZipEntries([
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, packs: [{ id: fresh, path: 'assets/new/', title: '新包' }, { id: changed, path: 'assets/old/', title: '旧包' }] }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: '鱼' } }) },
    ...[...pack(fresh, 'new'), ...pack(changed, 'old')].map(([path, content]) => ({ path, content })),
  ]))
  const first = await files.importCardArchiveFile(card, '鱼.dshcard')
  assert.deepEqual(applied, [[fresh, 'install'], [changed, 'cancel']])
  assert.match(first.libraryNotices.join(''), /旧包.*不同的版本/)
  applied.length = 0
  const again = await files.importCardArchiveFile(card, '鱼.dshcard')
  assert.equal(again.duplicate, true)
  assert.deepEqual(applied, [[fresh, 'noop'], [changed, 'cancel']], 'the same file again checks its packs')
})
