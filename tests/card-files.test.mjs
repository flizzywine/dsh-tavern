import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAssetPacks } from '../tavern-plugin/lib/domain/asset-packs.js'
import { createCardFiles } from '../tavern-plugin/lib/domain/card-files.js'
import { createCardPlugins } from '../tavern-plugin/lib/domain/card-plugins.js'
import { createCardPreparation, projectCardSummary } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardSummaryCache } from '../tavern-plugin/lib/domain/card-summary-cache.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
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
  const files = createCardFiles({
    cardPreparation, fileResources, castAssets, assetPacks: createAssetPacks({ root, store: profileData }), cardSummaries, readCardWorkspace,
    worldBooks: { characterBookForCard: async () => undefined },
    cardPlugins: createCardPlugins({ dataRoot: root, pluginsDir: join(root, 'plugins') }), presetLibrary: {}, importPreset: () => assert.fail('no start defaults'), pluginApi: () => assert.fail('not a plugin format')
  })
  return { root, files, fileResources, castAssets }
}

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
