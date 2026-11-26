import { png as fixturePng, syntheticPack } from './fixtures/asset-packs/pack.mjs'
import { createAssetPackService, openPackZip, StoredFile } from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { syntheticFixture } from './helpers/synthetic-link-fixture.mjs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { setTimeout as wait } from 'node:timers/promises'
import { createCardHandlers } from '../tavern-plugin/lib/rpc/cards.js'
import { createTransferExportStore } from '../tavern-plugin/lib/domain/transfer-store.js'
import { createCardBundleAdapter } from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import { sealPack } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import { exportDshCardSnapshot } from '../tavern-plugin/lib/domain/dsh-card-export.js'
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
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

// An export is a spool file; read its entries and remove it.
async function exportedEntries(exported) {
  try { return readZipEntries(await readFile(exported.file)) } finally { await exported.dispose() }
}

async function library(t, extra = {}, { onLegacyBlobWrite, withAssetLibrary = false } = {}) {
  let service
  t.after(() => service?.dispose())
  const root = syntheticFixture(t, 'card-files-')
  const profileData = createProfileDataStore({ dataRoot: root })
  const fileResources = createFileResourceStore({ dataRoot: root })
  let serial = 0
  const cardPreparation = createCardPreparation({ id: () => 'card-' + ++serial, now: Date.now })
  const castAssets = createCastAssets({ store: profileData })
  const mediaStore = createMediaStore({ root: join(root, 'asset-packs') })
  const legacyMedia = onLegacyBlobWrite ? { ...mediaStore, put(...args) { onLegacyBlobWrite(); return mediaStore.put(...args) } } : mediaStore
  const assetPacks = createAssetPacks({ store: profileData, mediaStore: legacyMedia })
  const readCardWorkspace = async cardPath => {
    const existing = await fileResources.readCard(cardPath)
    if (existing === undefined || cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(cardPath, (working, payload) => cardPreparation.migrate({ working, payload }))
  }
  const cardSummaries = createCardSummaryCache({ absolute: cardPath => fileResources.absolute(cardPath), read: async cardPath => projectCardSummary(await readCardWorkspace(cardPath)) })
  if (withAssetLibrary) {
    const cardTransactions = createCardBundleAdapter({cardPreparation, authorizeTarget:async path => ({cardId:path}),
      readWorkspace:readCardWorkspace, withCardLock:async (_path, task) => task()})
    service = createAssetPackService({assetRoot:join(root, 'library'), cardTransactions})
  }
  const files = createCardFiles({
    ...(service ? {assetLibrary:() => service} : {}),
    exportRoot: join(root, "exports"),
    cardPreparation, fileResources, castAssets, assetPacks, cardSummaries, readCardWorkspace,
    worldBooks: { characterBookForCard: async () => undefined },
    cardPlugins: createCardPlugins({ dataRoot: root, pluginsDir: join(root, 'plugins') }), presetLibrary: {}, importPreset: () => assert.fail('no start defaults'), ...extra, pluginApi: () => assert.fail('not a plugin format'),
    syncBubbles: async cardPath => { bubbleSyncs.push(cardPath) }
  })
  const bubbleSyncs = []
  return { root, files, fileResources, castAssets, bubbleSyncs, cardPreparation, readCardWorkspace, mediaStore, assetPacks }
}

// An on-disk 280 MiB asset pack. Ancillary PNG chunks make it cheap to build and remain ZIP-stored.
async function largeExportFixture(root) {
  const id = randomUUID(), files = new Map(), hashed = new Map(), blobs = {}, assets = []
  const sample = fixturePng([36, 72, 104]), chunk = Buffer.alloc(7 * 1024 ** 2 + 12, 65)
  chunk.writeUInt32BE(chunk.length - 12); chunk.write('tEXt', 4); chunk.write('fixture\0', 8)
  for (let i = 0; i < 40; i++) {
    chunk[16] = 65 + i
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
    const bytes = Buffer.concat([sample.subarray(0, -12), chunk, sample.subarray(-12)])
    const hash = createHash('sha256').update(bytes).digest('hex'), file = join(root, hash + '.png')
    await writeFile(file, bytes)
    blobs[hash] = {ext:'png', mime:'image/png', size:bytes.length}
    const member = 'media/' + hash + '.png'
    files.set(member, new StoredFile(bytes.length, file))
    hashed.set(member, hash)
    assets.push({kind:'backgrounds', id:'bg-' + i, name:'Background ' + i, enabled:true, recall:{mode:'keyword', keywords:['fixture']}, directorNote:'', media:hash})
  }
  const manifest = {format:'dsh-asset-pack', schemaVersion:1, id, name:'Large fixture', description:'', credits:[], contentHash:'0'.repeat(64), assets, figures:[], sprites:{}, bundles:{}, blobs, files:[]}
  await sealPack(manifest, files, undefined, hashed)
  const file = join(root, 'fixture.dshcard')
  await exportDshCardSnapshot({file, card:{data:{name:'Large round trip', tags:['dsh-agent-test'], extensions:{dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:[id]}}}}}, packs:[{manifest, files}]})
  return {file, id}
}

async function exportInventory(file) {
  const zip = await openZipFile(file, {allowEncrypted:true})
  try { return [...zip.entries.values()].map(({path, size}) => [path,size]).sort() } finally { await zip.close() }
}

test('a 280 MiB card takes the same files through direct, plain GUI and encrypted GUI export and native re-import', {timeout:150_000}, async t => {
  const source = await library(t, {}, {withAssetLibrary:true})
  const seed = await largeExportFixture(source.root)
  const card = await source.files.importCardArchiveFile(seed.file, 'fixture.dshcard')
  assert.equal(card.libraryNotices, undefined)
  const transfer = createTransferExportStore({root:join(source.root,'transfer')})
  try {
    const handlers = createCardHandlers({...source.files, str:String, transferExports:transfer})
    assert.deepEqual((await handlers.listCardExportPacks({path:card.path})).packs.map(pack => pack.id), [seed.id])
    const direct = await source.files.exportCardFile(card.path)
    const inventory = await exportInventory(direct.file)
    assert.ok(direct.size > 256 * 1024 ** 2)
    await direct.dispose()
    for (const [progressId,password] of [['plain-large',undefined], ['locked-large','round-trip-test']]) {
      await handlers.exportLibraryCard({path:card.path, progressId, password})
      let progress
      do {
        await wait(50, undefined, {signal:t.signal})
        progress = handlers.cardExportProgress({progressId}).progress
      } while (!['done','failed'].includes(progress.stage))
      assert.equal(progress.stage,'done',progress.error?.message)
      const token = new URL(progress.result.downloadUrl, 'http://fixture').searchParams.get('token')
      const artifact = await transfer.take(token)
      assert.ok(artifact.bytes > 256 * 1024 ** 2)
      assert.deepEqual(await exportInventory(artifact.file), inventory)
      const target = await library(t, {}, {withAssetLibrary:true})
      await target.files.previewCardArchiveFile(artifact.file, progress.result.filename, {password})
      const restored = await target.files.importCardArchiveFile(artifact.file, progress.result.filename, {password, previewed:true})
      assert.equal(restored.name, card.name)
      assert.equal(restored.libraryNotices, undefined)
      assert.deepEqual(restored.packs.map(({id, contentHash, files}) => [id,contentHash,files]), card.packs.map(({id,contentHash,files}) => [id,contentHash,files]))
      const roundTrip = await target.files.exportCardFile(restored.path)
      try { assert.deepEqual(await exportInventory(roundTrip.file), inventory) } finally { await roundTrip.dispose() }
      await transfer.remove(token)
    }
  } finally { transfer.close() }
})

test('a world book mislabeled as card.json is rejected before attached packs are written', async t => {
  const {root, files, fileResources} = await library(t, {
    assetLibrary: () => ({ inspectImportFile: () => assert.fail('invalid card must not inspect packs') }),
    assetPacks: { importFromZip: () => assert.fail('invalid card must not publish packs') }
  })
  const file = join(root, 'bad-card.dshcard')
  await writeFile(file, writeZipEntries([
    {path:'card.json', content:'{"entries":{}}'},
    {path:'dsh.json', content:JSON.stringify({format:'dshcard', formatVersion:1, packs:[{id:randomUUID(), path:'assets/test/'}]})}
  ]))
  await assert.rejects(files.importCardArchiveFile(file, 'bad-card.dshcard'), /检测到世界书/)
  assert.deepEqual(await fileResources.list('card'), [])
})

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
  const exported = await files.exportCardFile(card.path)
  const roundTrip = join(root, 'round-trip.dshcard')
  await encryptCardArchiveFile(exported.file, roundTrip, 'test-only-password')
  const fresh = await library(t)
  await assert.rejects(fresh.files.previewCardArchiveFile(roundTrip, 'round-trip.dshcard'), { code: 'TAVERN_CARD_PASSWORD_REQUIRED' })
  const preview = await fresh.files.previewCardArchiveFile(roundTrip, 'round-trip.dshcard', { password: 'test-only-password' })
  assert.equal(preview.card.name, card.name)
  const restored = await fresh.files.importCardArchiveFile(roundTrip, 'round-trip.dshcard', { password: 'test-only-password', previewed: true })
  assert.equal(restored.name, card.name)
  assert.equal((await fresh.castAssets.read(restored.path)).plugins[0].enabled, true)
  const entries = await exportedEntries(exported)
  assert.equal(JSON.parse(entries.get('dsh.json')).plugins[0].name, 'encrypted-game')
  assert.equal(entries.get('plugins/game/assets/data.bin').toString(), 'fixture bytes')

  const truncated = join(root, 'truncated.dshcard')
  await writeFile(truncated, (await readFile(roundTrip)).subarray(0, -22))
  await assert.rejects(fresh.files.previewCardArchiveFile(truncated, 'truncated.dshcard'), { code: 'TAVERN_ZIP_INCOMPLETE' })
  await assert.rejects(openPackZip(truncated), { code: 'TAVERN_ZIP_INCOMPLETE' })
  await assert.rejects(openPackZip(roundTrip), { code: 'TAVERN_ZIP_ENCRYPTED' })
  assert.equal((await fresh.fileResources.list('card')).length, 1)
})


// A DSH card with a pack and a plugin imports and goes back out whole; a figure left out of the export leaves with the
// media only it uses, from the exported copy only.
test('v1 card, bound pack and plugin round trip; PNG imports and exclusion only changes the exported copy', async t => {
  const {root, files, fileResources, bubbleSyncs} = await library(t)
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
  assert.deepEqual(bubbleSyncs,[imported.path],'the import derives its own bubble format entry')
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
  {
    // the byte progress the 导出 sheet shows: every input byte counted once, the pack named while its files are written.
    const seen = []
    const exported = await files.exportCardFile(imported.path,{onProgress:progress => seen.push(progress)})
    try {
      const last = seen.at(-1)
      assert.ok(last.total > 0 && last.done === last.total, 'ends at the total')
      assert.ok(seen.every((p, i) => p.total === last.total && (i === 0 || p.done >= seen[i - 1].done)), 'one total, never going back')
      assert.ok(seen.some(p => p.pack === 'Fixture pack'), 'names the pack being written')
    } finally { await exported.dispose() }
    // a throw from the listener (the sheet's 取消) stops the export and leaves no spool behind.
    await assert.rejects(files.exportCardFile(imported.path,{onProgress:progress => { if (progress.done > 0) throw Object.assign(new Error('cancelled'), { code: 'TAVERN_EXPORT_CANCELLED' }) }}), { code: 'TAVERN_EXPORT_CANCELLED' })
    assert.deepEqual(await readdir(join(root, 'exports')), [])
  }
  await assert.rejects(files.exportCardFile(imported.path,{packIds:['44444444-4444-4444-8444-444444444444']}), error => error.code === 'TAVERN_EXPORT_INVALID')
  await assert.rejects(files.exportCardFile(imported.path,{packIds:'all'}), error => error.code === 'TAVERN_EXPORT_INVALID')
  assert.equal(await fileResources.readText(imported.path),before)
})


// The 世界书 ticks: the chosen bound books reach the world book library; none chosen leaves the exported card without its book.
test('an export carries only the chosen world books, in every format', async t => {
  const asked = []
  const { root, files } = await library(t, { worldBooks: { characterBookForCard: async (cardPath, books) => { asked.push(books); return books?.length ? { entries: [{ keys: ['k'], content: 'chosen', enabled: true }] } : null } } })
  const source = join(root, 'book.dshcard')
  await writeFile(source, writeZipEntries([{ path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1 }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Book card', description: 'd', character_book: { entries: [{ keys: ['own'], content: 'own book', enabled: true }] } } }) }]))
  const card = await files.importCardArchiveFile(source, 'book.dshcard')
  asked.length = 0
  const book = { kind: 'standalone', path: 'worldbooks/a.json' }
  const chosen = JSON.parse((await exportedEntries(await files.exportCardFile(card.path, { books: [book] }))).get('card.json'))
  assert.equal(chosen.data.character_book.entries[0].content, 'chosen')
  const none = JSON.parse((await exportedEntries(await files.exportCardFile(card.path, { books: [] }))).get('card.json'))
  assert.equal(none.data.character_book, undefined, 'no book chosen: the card\'s own book stays home too')
  const json = await files.exportCardFile(card.path, { format: 'json', books: [book] })
  assert.equal(JSON.parse(json.bytes).data.character_book.entries[0].content, 'chosen')
  assert.deepEqual(asked, [[book], [], [book]])
  await assert.rejects(files.exportCardFile(card.path, { books: 'all' }), { code: 'TAVERN_EXPORT_INVALID' })
})

// A fake asset library: installed pack id → {hash, data}; a pack with a different hash previews `conflict` choices.
// backupPack writes the installed data to the file, so a restore can be checked.
function fakeLibrary(installed, { conflict = ['update', 'keep-both', 'cancel'], removed } = {}) {
  const applied = [], previews = new Map()
  const service = {
    async getPackSnapshot({ packId }) { return installed.has(packId) ? { manifest: { contentHash: installed.get(packId).hash } } : null },
    async inspectImportFile({ file }) {
      const zip = await openZipFile(file)
      try {
        const manifest = JSON.parse((await zip.readBuffer(zip.entries.get('manifest.json'), 65536)).toString())
        assert.ok(zip.entries.has('media/a.png'), 'the pack is re-rooted: its own files at the top')
        const data = (await zip.readBuffer(zip.entries.get('media/a.png'), 65536)).toString()
        const before = installed.get(manifest.id), inspectionId = 'inspection-' + (previews.size + 1)
        const choices = !before ? ['install', 'keep-both', 'cancel'] : before.hash === manifest.contentHash ? ['noop', 'cancel'] : conflict
        previews.set(inspectionId, { id: manifest.id, hash: manifest.contentHash, data })
        return { inspectionId, packId: manifest.id, contentHash: manifest.contentHash, incoming: { manifest: { name: manifest.name } }, expectedRevision: before ? 'r-' + before.hash : null, choices, scriptRisk: [], ...(removed && choices === conflict ? { removed } : {}) }
      } finally { await zip.close() }
    },
    async applyImport({ inspectionId, decision }) {
      const { id, hash, data } = previews.get(inspectionId)
      applied.push([id, decision])
      if (['install', 'update', 'merge'].includes(decision)) installed.set(id, { hash, data })
      return { status: decision }
    },
  }
  const backupPack = async (file, { packId, expectedRevision }) => {
    const before = installed.get(packId)
    assert.equal(expectedRevision, 'r-' + before.hash, 'the backup is of the revision the preview saw')
    await writeFile(file, writeZipEntries([{ path: 'manifest.json', content: JSON.stringify({ id: packId, contentHash: before.hash }) }, { path: 'media/a.png', content: before.data }]))
  }
  return { assetLibrary: () => service, backupPack, applied }
}
const sha = text => createHash('sha256').update(text).digest('hex')
const packEntries = (id, name, hash = 'v1', data = 'png') => [{ path: `assets/${name}/manifest.json`, content: JSON.stringify({ id, contentHash: sha(hash) }) }, { path: `assets/${name}/media/a.png`, content: data }]
const dshCard = (name, packs, version = '') => [
  { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, packs: packs.map(([id, folder, title, hash = 'v1']) => ({ id, path: `assets/${folder}/`, title, contentHash: sha(hash) })) }) },
  { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name, character_version: version } }) },
]

test('the preview lists only the packs to decide about; merge is applied as chosen', async t => {
  const fresh = '55555555-5555-4555-8555-555555555555', same = '77777777-7777-4777-8777-777777777777', changed = '66666666-6666-4666-8666-666666666666'
  const installed = new Map([[changed, { hash: 'other-version', data: 'old' }], [same, { hash: sha('v1'), data: 'png' }]])
  const removed = [{ kind: 'figures', id: 'f1', name: '旧角色' }]
  const { assetLibrary, applied } = fakeLibrary(installed, { conflict: ['update', 'merge', 'keep-both', 'cancel'], removed })
  const { root, files } = await library(t, { assetLibrary })
  const card = join(root, 'merge.dshcard')
  await writeFile(card, writeZipEntries([...dshCard('示例卡', [[fresh, 'new', '新包'], [same, 'same', '同包'], [changed, 'old', '旧包']], '11-17'), ...packEntries(fresh, 'new'), ...packEntries(same, 'same'), ...packEntries(changed, 'old')]))
  const preview = await files.previewCardArchiveFile(card, 'merge.dshcard')
  assert.deepEqual(preview, { card: { name: '示例卡', version: '11-17' }, packs: [{ packId: changed, title: '旧包', choices: ['update', 'merge', 'keep-both', 'cancel'], removed }] })
  assert.deepEqual(applied, [], 'preview changes nothing and retains inspections for commit')
  applied.length = 0
  await files.importCardArchiveFile(card, 'merge.dshcard', { packDecisions: { [changed]: 'merge' } })
  assert.deepEqual(applied, [[fresh, 'install'], [same, 'noop'], [changed, 'merge']])
})

test('a damaged audio file rejects the whole attached pack and requires consent before importing the card', async t => {
  let service
  const { root, files, fileResources } = await library(t, { assetLibrary: () => service })
  service = createAssetPackService({ assetRoot: join(root, 'library') })
  t.after(() => service.dispose())
  const { manifest, files: media } = await syntheticPack()
  const bell = manifest.assets.find(asset => asset.kind === 'sfx')
  const missing = `media/${bell.media}.${manifest.blobs[bell.media].ext}`
  media.set(missing, Buffer.alloc(media.get(missing).length, 42))
  const file = join(root, 'ambience.dshcard'), title = '通用环境音'
  const entries = dshCard('环境音卡', [[manifest.id, 'ambience', title]])
  entries.push({ path: 'assets/ambience/manifest.json', content: JSON.stringify(manifest) },
    ...[...media].map(([path, content]) => ({ path: 'assets/ambience/' + path, content })))
  await writeFile(file, writeZipEntries(entries))
  const stage = await files.previewCardArchiveFile(file, 'ambience.dshcard')
  assert.match(stage.packNotices[0], /通用环境音.*文件内容与清单不符.*请重新获取卡包/);
  assert.ok(stage.packNotices[0].includes(missing), stage.packNotices[0])
  await files.discardCardArchivePreview(file)
  assert.deepEqual(await fileResources.list('card'), [])
  assert.equal(await service.getPackSnapshot({ packId: manifest.id, readOnly: true }), null)
  await files.previewCardArchiveFile(file, 'ambience.dshcard')
  const result = await files.importCardArchiveFile(file, 'ambience.dshcard', { previewed: true, acceptMissingPacks: true })
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.libraryNotices, stage.packNotices)
  const duplicate = await files.importCardArchiveFile(file, 'ambience.dshcard')
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.status, 'partial')
  assert.deepEqual(duplicate.libraryNotices, stage.packNotices)
})

test('embedded pack inspection reads entries directly and import reuses the verified media', async t => {
  let service, legacyWrites = 0
  const { root, files, mediaStore, assetPacks } = await library(t, { assetLibrary: () => service }, { onLegacyBlobWrite: () => legacyWrites++ })
  const libraryService = createAssetPackService({ assetRoot: join(root, 'library'), mediaStore })
  t.after(() => libraryService.dispose())
  service = { ...libraryService, inspectImportFile: () => assert.fail('an embedded pack should not be repacked') }
  const { manifest, files: media } = await syntheticPack()
  const card = join(root, 'direct.dshcard'), name = 'direct.dshcard'
  const entries = dshCard('直接导入', [[manifest.id, 'pack', '素材包']])
  await writeFile(card, writeZipEntries([...entries, {path:'assets/pack/manifest.json', content:JSON.stringify(manifest)},
    ...[...media].map(([path, content]) => ({path:'assets/pack/' + path, content}))]))

  assert.equal((await files.previewCardArchiveFile(card, name)).packNotices, undefined)
  assert.equal(await service.getPackSnapshot({ packId: manifest.id, readOnly: true }), null)
  const result = await files.importCardArchiveFile(card, name, { previewed: true })
  assert.equal(result.status, undefined)
  assert.ok(await service.getPackSnapshot({ packId: manifest.id, readOnly: true }))
  const legacy = await assetPacks.readPack(manifest.id, result.packs[0].contentHash)
  assert.equal(legacyWrites, 1 + [...media.keys()].filter(key => !key.startsWith('media/')).length)
  for (const row of manifest.files) assert.deepEqual(legacy.files[row.path], {sha256:row.sha256, size:row.size})
})

// A pack ZIP picked from the phone's download folder: read where it is, applied without asking only when nothing is lost.
test('a pack ZIP installs a new pack, leaves an identical one, and hands a clashing or scripted one to the player', async t => {
  const fresh = '55555555-5555-4555-8555-555555555555', same = '77777777-7777-4777-8777-777777777777', changed = '66666666-6666-4666-8666-666666666666', scripted = '88888888-8888-4888-8888-888888888888'
  const installed = new Map([[changed, { hash: 'other-version', data: 'old' }], [same, { hash: sha('v1'), data: 'png' }]])
  const { assetLibrary, applied } = fakeLibrary(installed)
  const risky = () => ({ ...assetLibrary(), inspectImportFile: async input => ({ ...(await assetLibrary().inspectImportFile(input)), scriptRisk: [{ packId: scripted }] }) })
  const { root, files } = await library(t, { assetLibrary })
  const zip = async (id, name, hash = 'v1') => {
    const file = join(root, name + '.zip')
    await writeFile(file, writeZipEntries([{ path: 'manifest.json', content: JSON.stringify({ id, name, contentHash: sha(hash) }) }, { path: 'media/a.png', content: 'png' }]))
    return file
  }
  assert.deepEqual(await files.importPackArchiveFile(await zip(fresh, '新包')), { packs: [{ id: fresh, title: '新包', status: 'installed' }] })
  assert.deepEqual(await files.importPackArchiveFile(await zip(same, '同包')), { packs: [{ id: same, title: '同包', status: 'existing' }] })
  const clash = await files.importPackArchiveFile(await zip(changed, '旧包', 'v2'))
  assert.deepEqual(clash.packs, [])
  assert.match(clash.notices[0], /旧包.*冲突.*素材库里处理/)
  assert.deepEqual(applied, [[fresh, 'install'], [same, 'noop'], [changed, 'cancel']], 'the clashing pack is cancelled, never replaced')
  assert.deepEqual(installed.get(changed), { hash: 'other-version', data: 'old' })
  const scriptedFile = await zip(scripted, '脚本包')
  const { files: withScripts } = await library(t, { assetLibrary: risky })
  const blocked = await withScripts.importPackArchiveFile(scriptedFile)
  assert.match(blocked.notices[0], /脚本包.*带脚本/)
  assert.equal(applied.at(-1)[1], 'cancel')
  await assert.rejects(files.importPackArchiveFile(join(root, 'missing.zip')), /ENOENT|no such file/)
  const notPack = () => ({ ...assetLibrary(), inspectImportFile: async () => { throw Object.assign(new Error('Missing pack manifest'), { code: 'FILE_CLOSURE_MISMATCH' }) } })
  await assert.rejects((await library(t, { assetLibrary: notPack })).files.importPackArchiveFile(scriptedFile), /不是素材包.*导入卡 ZIP/)
  const full = () => ({ ...assetLibrary(), inspectImportFile: async () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }) } })
  const { files: onFullDisk } = await library(t, { assetLibrary: full })
  await assert.rejects(onFullDisk.importPackArchiveFile(scriptedFile), /磁盘空间不够.*没有留下半个文件/)
})
// A pack collection whose second pack fails to install: the first stays installed and is named, the rest are cancelled.
test('a pack collection that fails part way names what was installed and cancels the previews left', async t => {
  const calls = []
  const pack = (n, name) => ({ inspectionId: 'p' + n, packId: 'id-' + n, choices: ['install', 'cancel'], scriptRisk: [], incoming: { manifest: { name } }, expectedRevision: null })
  const set = { kind: 'pack-set', inspectionId: 'set', packs: [pack(1, '甲'), pack(2, '乙'), pack(3, '丙')] }
  const assetLibrary = () => ({
    async inspectImportFile() { return set },
    async applyImport({ inspectionId, decision }) {
      calls.push([inspectionId, decision])
      if (inspectionId === 'p2' && decision === 'install') throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
      return { status: decision }
    },
  })
  const { files } = await library(t, { assetLibrary })
  await assert.rejects(files.importPackArchiveFile('unused.zip'), error => /「乙」没有装入：磁盘空间不够.*已装入：「甲」.*其余 1 个包没有处理/.test(error.message))
  assert.deepEqual(calls, [['p1', 'install'], ['p2', 'install'], ['p2', 'cancel'], ['p3', 'cancel']])
})
test('撤回 puts the card and the packs it replaced back; only the latest update can be taken back', async t => {
  const packId = '66666666-6666-4666-8666-666666666666'
  const installed = new Map()
  const { assetLibrary, backupPack } = fakeLibrary(installed)
  const { root, files, fileResources } = await library(t, { assetLibrary, backupPack, withCardBackup: (file, selection, write) => write() })
  const archive = join(root, 'card.dshcard')
  await writeFile(archive, writeZipEntries([...dshCard('示例卡', [[packId, 'sample', '示例包']], '11-15'), ...packEntries(packId, 'sample', 'v1', 'old art')]))
  const old = await files.importCardArchiveFile(archive, 'card.dshcard')
  await writeFile(archive, writeZipEntries([...dshCard('示例卡', [[packId, 'sample', '示例包', 'v2']], '11-17'), ...packEntries(packId, 'sample', 'v2', 'new art')]))
  const updated = await files.replaceCard(old.path, { file: archive, name: 'card.dshcard' })
  assert.deepEqual(installed.get(packId), { hash: sha('v2'), data: 'new art' })
  assert.equal((await fileResources.readCard(old.path)).raw.data.character_version, '11-17')
  assert.deepEqual(await files.revertCardUpdate(updated.updateId), { path: old.path, reverted: true })
  assert.deepEqual(installed.get(packId), { hash: sha('v1'), data: 'old art' })
  assert.equal((await fileResources.readCard(old.path)).raw.data.character_version, '11-15')
  await assert.rejects(files.revertCardUpdate(updated.updateId), /不能撤回/)
  await assert.rejects(files.revertCardUpdate('../' + updated.updateId), /不能撤回/)
  const first = await files.replaceCard(old.path, { file: archive, name: 'card.dshcard' })
  const second = await files.replaceCard(old.path, { file: archive, name: 'card.dshcard' })
  await assert.rejects(files.revertCardUpdate(first.updateId), /不能撤回/, 'a newer update drops the earlier record')
  await files.revertCardUpdate(second.updateId)
  assert.ok(await readFile(first.backupPath), 'earlier card backups stay')
})



test('card replacement backs up bindings without embedding packs, even with legacy metadata', async t => {
  const {createAssetPackService} = await import('../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js')
  const {createCardBundleAdapter} = await import('../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js')
  const {syntheticPack, PACK_ID} = await import('./fixtures/asset-packs/pack.mjs')
  const {sealPack} = await import('../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js')
  let normal, options
  const {root, files, fileResources} = await library(t, {
    assetLibrary: () => normal,
    withCardBackup: async (file, input, consume) => {
      const service = createAssetPackService({...options, privateExportFile:file})
      assert.deepEqual(input.packIds, [], 'replacement must not request bound pack bundles')
      try { return await service.withCardExport(input, consume) } finally { await service.dispose() }
    }
  })
  const assetRoot = join(root, 'library'), pack = await syntheticPack()
  const performance = {schema:'dsh.performance/1', id:'show', label:'Fixture', license:{privateUse:true}, packs:{}, levels:{default:2,1:{},2:{},3:{}}, timeline:{entry:{events:[]},exit:{events:[]}}}
  pack.manifest.assets.push({kind:'performances',id:'show',name:'Fixture',enabled:false,recall:{mode:'keyword',keywords:[]},directorNote:'',bundleKey:'show',entry:'performance.json'})
  pack.manifest.bundles.show = {kind:'performance',entry:'performance.json',contentHash:'0'.repeat(64)}
  pack.files.set('bundles/show/performance.json', Buffer.from(JSON.stringify(performance)))
  await sealPack(pack.manifest, pack.files)
  for (const [name, bytes] of new Map([['manifest.json',Buffer.from(JSON.stringify(pack.manifest))], ...pack.files])) {
    const file = join(assetRoot, 'packs', PACK_ID, name)
    await mkdir(dirname(file), {recursive:true}); await writeFile(file, bytes)
  }
  await mkdir(join(assetRoot, 'local'), {recursive:true})
  await writeFile(join(assetRoot, 'local', PACK_ID + '.json'), JSON.stringify({revision:'fixture-revision',retired:[],installedAt:1,updatedAt:1}))
  const card = {name:'Private original',extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID]},modConfigPackId:PACK_ID}}}
  const original = await files.importCard({kind:'text',name:'private.json',text:JSON.stringify(card)})
  options = {assetRoot,cardTransactions:createCardBundleAdapter({cardPreparation:createCardPreparation(),authorizeTarget:async () => ({cardId:'fixture'}),readWorkspace:fileResources.readCard,withCardLock:async (_, task) => task()})}
  normal = createAssetPackService(options)
  t.after(() => normal.dispose())
  assert.ok(await files.exportCardFile(original.path))
  const updated = await files.replaceCard(original.path, {payload:{kind:'text',name:'updated.json',text:JSON.stringify({...card,name:'Private updated'})}})
  assert.equal(updated.path, original.path)
  assert.equal((await fileResources.readCard(original.path)).raw.name, 'Private updated')
  const zip = await openZipFile(updated.backupPath)
  try {
    const backup = await readCardArchive(zip)
    assert.equal(backup.card.data.name, 'Private original')
    assert.deepEqual(backup.card.data.extensions.dsh_tavern.assetBindings.boundPackIds, [PACK_ID])
    assert.equal(backup.packs.length, 0)
  } finally { await zip.close() }
  assert.ok(await files.exportCardFile(original.path))
})
