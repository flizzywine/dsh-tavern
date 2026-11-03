import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readCardArchive } from '../tavern-plugin/lib/domain/card-archive.js'
import { openZipFile } from '../tavern-plugin/lib/domain/zip-file.js'
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

// An export is a spool file; read its entries and remove it.
async function exportedEntries(exported) {
  try { return readZipEntries(await readFile(exported.file)) } finally { await exported.dispose() }
}

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
  const entries = await exportedEntries(await files.exportCardFile(card.path))
  assert.equal(JSON.parse(entries.get('dsh.json')).plugins[0].name, 'encrypted-game')
  assert.equal(entries.get('plugins/game/assets/data.bin').toString(), 'fixture bytes')
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
  assert.equal(JSON.parse((await exportedEntries(exported)).get('card.json').toString()).data.description, '一条鱼')
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
  assert.equal((await readFile(exported.file)).readUInt32LE(0), 0x04034b50)
  const entries = await exportedEntries(exported)
  assert.equal(JSON.parse(entries.get('dsh.json')).format, 'dshcard')
  assert.deepEqual(entries.get('assets/icon/images/main.png'), cover)
})


// A DSH card with a pack and a plugin imports and goes back out whole; a figure left out of the export leaves with the
// media only it uses, from the exported copy only.
test('v1 card, bound pack and plugin round trip; PNG imports and exclusion only changes the exported copy', async t => {
  const {root, files, fileResources} = await library(t)
  const id = '11111111-1111-4111-8111-111111111111', omitted = '22222222-2222-4222-8222-222222222222', kept = '33333333-3333-4333-8333-333333333333'
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=', 'base64')
  const hash = 'a'.repeat(64), media = 'media/' + hash + '.png'
  const manifest = {format:'dsh-asset-pack', schemaVersion:2, id, name:'Fixture pack', contentHash:'b'.repeat(64), figures:[omitted, kept], sprites:{}, bundles:{}, assets:[], blobs:{[hash]:{ext:'png', mime:'image/png', size:png.length}}, files:[]}
  const figure = (id, name, avatar) => ({id, name, aliases:[], outfits:[], ...(avatar ? {avatar} : {})})
  const ref = figureId => ({packId:id, figureId})
  const card = {spec:'chara_card_v3', spec_version:'3.0', data:{name:'Roundtrip', description:'Authored story', character_book:{entries:[{keys:['Removed'],comment:'speaker roster',content:omitted+' Removed\n'+kept+' Retained',enabled:true}]},
    assets:[{type:'icon',name:'main',ext:'png',uri:'embeded://assets/icon/images/main.png'}],
    extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[id]},speakers:[{name:'Removed',ref:ref(omitted)},{name:'Retained',ref:ref(kept)}],
      openings:{lead:ref(omitted),scenes:{primary:{greeting:'a'.repeat(16),background:null,timeOfDay:null,music:null,cast:[{figure:ref(omitted),outfitKey:null,emotion:'平静'},{figure:ref(kept),outfitKey:null,emotion:'平静'}]}}}}}}}
  const entries = [
    ['card.json',JSON.stringify(card)], ['dsh.json',JSON.stringify({format:'dshcard',formatVersion:1,packs:[{id,path:'assets/'+id+'/',format:'dsh-asset-pack',contentHash:manifest.contentHash}],plugins:[{name:'fixture-plugin',path:'plugins/fixture/'}],defaults:{stage:true,settings:{statusBarPlacement:'sidebar'}}})],
    ['assets/icon/images/main.png',png], ['assets/'+id+'/manifest.json',JSON.stringify(manifest)], ['assets/'+id+'/'+media,png],
    ['assets/'+id+'/figures/'+omitted+'.json',JSON.stringify(figure(omitted,'Removed',hash))], ['assets/'+id+'/figures/'+kept+'.json',JSON.stringify(figure(kept,'Retained'))],
    ['plugins/fixture/package.json',JSON.stringify({name:'fixture-plugin',version:'1.0.0',main:'./index.mjs'})], ['plugins/fixture/index.mjs','export function apply() {}']
  ]
  manifest.files = entries.filter(([name]) => name.startsWith('assets/'+id+'/') && !name.endsWith('/manifest.json')).map(([name, content]) => ({path:name.slice(('assets/'+id+'/').length), size:Buffer.byteLength(content), sha256:createHash('sha256').update(content).digest('hex')}))
  entries.find(([name]) => name === 'assets/'+id+'/manifest.json')[1] = JSON.stringify(manifest)
  const source = join(root,'source.dshcard')
  await writeFile(source,writeZipEntries(entries.map(([path,content])=>({path,content}))))
  const imported = await files.importCardArchiveFile(source,'source.dshcard')
  const before = await fileResources.readText(imported.path)
  {
    const exported = await files.exportCardFile(imported.path,{excludeFigures:[omitted]})
    try {
      const zip = await openZipFile(exported.file)
      try {
        const archive = await readCardArchive(zip)
        assert.equal(archive.kind,'dshcard')
        assert.equal(archive.plugins[0].name,'fixture-plugin')
        assert.equal(JSON.parse(await zip.readBuffer(zip.entries.get('dsh.json'))).defaults.stage,true)
        assert.equal(archive.card.data.extensions.dsh_tavern.stage.enabled,true)
        assert.equal(archive.defaults.settings.statusBarPlacement,'sidebar')
        assert.equal(JSON.stringify(archive.card).includes(omitted),false)
        assert.equal(zip.entries.has('assets/'+id+'/'+media),false)
        assert.equal(zip.entries.has('assets/'+id+'/figures/'+omitted+'.json'),false)
        assert.ok(zip.entries.has('assets/'+id+'/figures/'+kept+'.json'))
        assert.equal(archive.card.data.extensions.dsh_tavern.openings.scenes.primary.cast.length,1)
      } finally { await zip.close() }
      const target = await files.importCardArchiveFile(exported.file,'copy.dshcard')
      assert.equal(target.plugins[0].enabled,true)
      assert.equal(target.packs.length,1)
    } finally { await exported.dispose() }
  }
  await assert.rejects(files.exportCardFile(imported.path,{packIds:['44444444-4444-4444-8444-444444444444']}), error => error.code === 'TAVERN_EXPORT_INVALID')
  await assert.rejects(files.exportCardFile(imported.path,{packIds:'all'}), error => error.code === 'TAVERN_EXPORT_INVALID')
  assert.equal(await fileResources.readText(imported.path),before)
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
