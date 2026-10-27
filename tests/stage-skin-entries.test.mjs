import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import { createAssetPackService } from '../tavern-plugin/lib/asset-library/pack-v2/service.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createStageMaterial, STAGE_MEDIA_SCOPE, STAGE_READ_SCOPE, STAGE_LEASE_ORIGIN } from '../tavern-plugin/lib/domain/stage-material.js'
import { stageSkinChoice, stageSkinPackIds } from '../tavern-plugin/lib/domain/stage-skin-choice.js'
import { BUILTIN_STAGE_SKINS } from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { inspectCardExtensions } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createAssetLibraryHandlers } from '../tavern-plugin/lib/rpc/asset-library.js'

function png(r, g, b) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0))])
}
// An original test skin: dark ink on a pale box, its box drawn from one image.
function skin(id, extra = {}) {
  return { schema: 'dsh.skin/1', id, label: '测试皮肤 ' + id,
    textbox: { paint: { bg: '#f4efe6', fg: '#1d1a22', fgMuted: '#4a4550', accent: '#2a2440', onAccent: '#ffffff', border: '#4a4550' } },
    nameplate: { shape: 'plain', paint: { bg: '#2a2440', fg: '#ffffff' } }, font: {}, textFx: { reveal: 'type' },
    art: { screen: 900, textbox: { images: { plain: 'art/box.png' }, body: [0, 0, 1, 1], bottom: 20, text: [0, 1, 0], font: 28, lines: 3 } }, ...extra }
}
const json = value => Buffer.from(JSON.stringify(value))

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stage-skins-'))
  const store = createProfileDataStore({ dataRoot: path.join(root, 'data') })
  const castAssets = createCastAssets({ store })
  const library = createAssetPackService({ assetRoot: path.join(root, 'asset-packs'), authorizeLease: async ({ scope }) => scope === STAGE_MEDIA_SCOPE || scope === STAGE_READ_SCOPE })
  let settings = {}
  const readTavernSettings = async () => presentTavernSettings(settings, {})
  const updateTavernSettings = async patch => { settings = applyTavernSettingsPatch(settings, patch); return readTavernSettings() }
  const stageMaterial = createStageMaterial({ library, castAssets, globalPackIds: async () => (await readTavernSettings()).globalEnabledPackIds })
  const cardFiles = new Map()
  // The host's stageSkinOf (index.js) over the same parts: cast.json, the card file's extension, the packs and the settings.
  async function stageSkinOf(cardPath) {
    const current = await readTavernSettings(), cast = await castAssets.read(cardPath), boundPackIds = cast.boundPackIds || []
    const packs = await Promise.all(stageSkinPackIds(boundPackIds, current.stageSkin).map(packId => library.getPackSnapshot({ packId }).catch(() => null)))
    const cardDefault = inspectCardExtensions(cardFiles.get(cardPath) || {}).defaultSkin
    return { ...stageSkinChoice({ choice: cast.skinChoice ?? null, cardDefault, boundPackIds, global: current.stageSkin, packs }), choice: cast.skinChoice ?? null, cardDefault }
  }
  let uploadCount = 0
  const uploads = {
    async put(bytes) { const id = String(++uploadCount); await writeFile(path.join(root, 'up-' + id), bytes); return id },
    async take(id) { return { file: path.join(root, 'up-' + id), remove: async () => rm(path.join(root, 'up-' + id), { force: true }) } }
  }
  const rpc = createAssetLibraryHandlers({ assetLibrary: library, castAssets, stageMaterial, uploads, readTavernSettings, updateTavernSettings, stageSkinOf,
    cardSummaries: { read: async cardPath => ({ name: path.basename(cardPath, '.json') }) }, fileResources: { list: async kind => kind === 'card' ? ['cards/a.json'] : [] },
    stageMaterialChanged: () => {}, str: value => value === undefined || value === null ? '' : String(value) })
  t.after(async () => { stageMaterial.dispose(); await library.dispose(); await rm(root, { recursive: true, force: true }) })
  // A skin folder as the page sends it: skin.json, then each file by its path beside it.
  const install = async (packId, document, files = { 'art/box.png': png(240, 230, 220) }) => rpc.addAssetPackSkin({ packId,
    document: await uploads.put(Buffer.isBuffer(document) ? document : json(document)),
    files: await Promise.all(Object.entries(files).map(async ([file, bytes]) => ({ path: file, uploadId: await uploads.put(bytes) }))) })
  return { rpc, library, castAssets, stageMaterial, install, stageSkinOf, cardFiles, settings: () => settings }
}

test('a skin folder becomes one 舞台皮肤 entry: its document and declared files in one sealed bundle, served under one lease', async t => {
  const f = await fixture(t)
  const { pack: created } = await f.rpc.createAssetPack({ name: '皮肤包' })
  const { pack, id } = await f.install(created.manifest.id, skin('paper'), { 'art/box.png': png(240, 230, 220), 'notes.txt': Buffer.from('ignored') })
  const asset = pack.manifest.assets.find(row => row.kind === 'skins')
  assert.deepEqual(asset, { kind: 'skins', id: 'paper', name: '测试皮肤 paper', recall: { mode: 'constant', keywords: [] }, directorNote: '', bundleKey: 'skin-paper', entry: 'skin.json' })
  assert.equal(id, 'paper')
  assert.equal(pack.manifest.bundles['skin-paper'].kind, 'skin')
  assert.deepEqual(pack.manifest.files.map(file => file.path).sort(), ['bundles/skin-paper/art/box.png', 'bundles/skin-paper/skin.json'])
  assert.equal(pack.skins.paper.label, '测试皮肤 paper')
  // The page reads every file of the skin under one lease; its own paths resolve against the base.
  const base = await f.stageMaterial.skinBase(pack.manifest.id, 'skin-paper', pack.manifest.bundles['skin-paper'].contentHash)
  assert.match(base, /\/lease\/[^/]+\/$/)
  const ticket = base.split('/').at(-2)
  const response = await f.library.respondLease({ ticket, resource: 'art/box.png', request: new Request(STAGE_LEASE_ORIGIN + base + 'art/box.png') })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png(240, 230, 220))
  // A skin has no lamp: it is never part of the director's material.
  assert.deepEqual(await f.stageMaterial.catalog('cards/none.json', 'x').then(rows => [...rows.background, ...rows.music]), [])
})

test('a skin is checked once, when it is written: document, identity and every file', async t => {
  const f = await fixture(t)
  const { pack } = await f.rpc.createAssetPack({ name: '皮肤包' }), packId = pack.manifest.id
  await assert.rejects(f.install(packId, skin('paper'), {}), { code: 'MISSING_DEPENDENCY' })
  await assert.rejects(f.install(packId, skin('paper', { nameplate: { shape: 'plain', paint: { bg: '#2a2440', fg: '#2b2541' } } })), { code: 'SKIN_CONTRAST' })
  await assert.rejects(f.install(packId, { ...skin('paper'), script: 'alert(1)' }), { code: 'INVALID_SKIN' })
  await assert.rejects(f.install(packId, Buffer.from('{not json')), { code: 'INVALID_SKIN' })
  // An image must be the image it claims to be; an SVG only inert drawing.
  await assert.rejects(f.install(packId, skin('paper'), { 'art/box.png': Buffer.from('not a png') }))
  const svg = skin('vector', { art: { screen: 900, textbox: { images: { plain: 'art/box.svg' }, body: [0, 0, 1, 1], bottom: 20, text: [0, 1, 0], font: 28, lines: 3 } } })
  const drawn = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>'
  await assert.rejects(f.install(packId, svg, { 'art/box.svg': Buffer.from(drawn.replace('<rect', '<script>x</script><rect')) }), { code: 'INVALID_SKIN' })
  const { pack: vector } = await f.install(packId, svg, { 'art/box.svg': Buffer.from(drawn) })
  assert.equal(vector.skins.vector.id, 'vector')
  // The store refuses a bundle whose files are not exactly the document's (written behind the editor's back).
  const current = await f.library.getPackSnapshot({ packId })
  await assert.rejects(f.library.patchPack({ packId, expectedRevision: current.revision, fileUpdates: new Map([['bundles/skin-vector/extra.png', png(1, 2, 3)]]) }), { code: 'FILE_CLOSURE_MISMATCH' })
  await assert.rejects(f.library.patchPack({ packId, expectedRevision: current.revision, patch: { assets: current.manifest.assets.map(row => ({ ...row, id: 'other' })) } }))
})

test('adding a skin with the same id replaces it whole; deleting it removes its bundle and retires the id', async t => {
  const f = await fixture(t)
  const { pack: created } = await f.rpc.createAssetPack({ name: '皮肤包' }), packId = created.manifest.id
  await f.install(packId, skin('paper', { art: { screen: 900, textbox: { images: { plain: 'old/box.png' }, body: [0, 0, 1, 1], bottom: 20, text: [0, 1, 0], font: 28, lines: 3 } } }), { 'old/box.png': png(1, 1, 1) })
  let { pack } = await f.install(packId, skin('paper', { label: '新版' }))
  assert.deepEqual(pack.manifest.files.map(file => file.path).sort(), ['bundles/skin-paper/art/box.png', 'bundles/skin-paper/skin.json'])
  assert.equal(pack.skins.paper.label, '新版')
  assert.equal(pack.manifest.assets.filter(row => row.kind === 'skins').length, 1)
  ;({ pack } = await f.rpc.setAssetPackStageSkin({ packId, expectedRevision: pack.revision, skin: 'paper' }))
  assert.equal(pack.manifest.stageSkin, 'paper')
  ;({ pack } = await f.rpc.removeAssetPackEntry({ packId, expectedRevision: pack.revision, kind: 'skins', id: 'paper' }))
  assert.deepEqual(pack.manifest.bundles, {})
  assert.deepEqual(pack.manifest.files, [])
  assert.equal(pack.manifest.stageSkin, 'paper', 'a pack default naming a removed skin is kept and simply stops applying')
  await assert.rejects(f.install(packId, skin('paper')), { code: 'DUPLICATE_ID' })
})

test('the stage skin follows 本卡选择 → 卡默认 → 包默认 → 全局默认 → 经典, and a missing skin passes down the order', async t => {
  const f = await fixture(t), card = 'cards/a.json'
  const { pack: own } = await f.rpc.createAssetPack({ name: '本卡' }), { pack: other } = await f.rpc.createAssetPack({ name: '全局' })
  await f.install(own.manifest.id, skin('pack-default')); await f.install(own.manifest.id, skin('card-own')); await f.install(own.manifest.id, skin('mine'))
  await f.install(other.manifest.id, skin('everyone'))
  const ref = (pack, assetId) => ({ packId: pack.manifest.id, kind: 'skins', assetId })
  const drawn = async () => (await f.stageSkinOf(card)).skin
  assert.equal(await drawn(), 'classic')
  // 全局默认: a skin from a global pack, chosen in 舞台设置 › 默认皮肤.
  await f.rpc.setAssetPackState({ path: card, packId: other.manifest.id, state: 'global' })
  const choices = await f.rpc.getStageSkins({ path: card })
  assert.deepEqual(choices.globalChoices.map(choice => choice.value), [...Object.keys(BUILTIN_STAGE_SKINS), ref(other, 'everyone')])
  await f.rpc.setStageSkin({ skin: ref(other, 'everyone') })
  assert.deepEqual(f.settings().stageSkin, ref(other, 'everyone'))
  assert.deepEqual(await drawn(), ref(other, 'everyone'))
  // 包默认: the first bound pack that declares one.
  await f.rpc.setAssetPackState({ path: card, packId: own.manifest.id, state: 'card' })
  const current = await f.library.getPackSnapshot({ packId: own.manifest.id })
  await f.rpc.setAssetPackStageSkin({ packId: own.manifest.id, expectedRevision: current.revision, skin: 'pack-default' })
  assert.deepEqual(await drawn(), ref(own, 'pack-default'))
  // 卡默认: the card file's own extensions.dsh_tavern.stage.defaultSkin.
  f.cardFiles.set(card, { spec: 'chara_card_v3', data: { extensions: { dsh_tavern: { stage: { defaultSkin: ref(own, 'card-own') } } } } })
  assert.deepEqual(await drawn(), ref(own, 'card-own'))
  // 本卡选择: the player's own, from the card's packs; 「跟随默认」 (null) goes back.
  const card_ = (await f.rpc.getStageSkins({ path: card })).card
  assert.deepEqual(card_.choices.map(choice => choice.value), [...Object.keys(BUILTIN_STAGE_SKINS), ref(own, 'pack-default'), ref(own, 'card-own'), ref(own, 'mine')])
  await f.rpc.setCardStageSkin({ path: card, skin: ref(own, 'mine') })
  assert.deepEqual(await f.stageSkinOf(card).then(({ skin, fallback, document }) => ({ skin, fallback, id: document.id })), { skin: ref(own, 'mine'), fallback: ref(own, 'card-own'), id: 'mine' })
  // A missing skin is passed over: each removal drops the stage one step down the order; nothing stored changes.
  const remove = async id => { const pack = await f.library.getPackSnapshot({ packId: own.manifest.id }); await f.rpc.removeAssetPackEntry({ packId: own.manifest.id, expectedRevision: pack.revision, kind: 'skins', id }) }
  await remove('mine'); assert.deepEqual(await drawn(), ref(own, 'card-own'))
  await remove('card-own'); assert.deepEqual(await drawn(), ref(own, 'pack-default'))
  await remove('pack-default'); assert.deepEqual(await drawn(), ref(other, 'everyone'))
  await f.rpc.setAssetPackState({ path: card, packId: other.manifest.id, state: 'off' })
  await f.library.removePack({ packId: other.manifest.id, expectedRevision: (await f.library.getPackSnapshot({ packId: other.manifest.id })).revision })
  assert.equal(await drawn(), 'classic')
  assert.deepEqual((await f.castAssets.read(card)).skinChoice, ref(own, 'mine'))
  assert.deepEqual(f.settings().stageSkin, ref(other, 'everyone'))
  await f.rpc.setCardStageSkin({ path: card, skin: null })
  assert.equal((await f.castAssets.read(card)).skinChoice, undefined)
})

test('a chosen skin is checked when it is chosen', async t => {
  const f = await fixture(t)
  const { pack } = await f.rpc.createAssetPack({ name: '包' })
  await assert.rejects(f.rpc.setStageSkin({ skin: 'missing-skin' }), { code: 'INVALID_INPUT' })
  await assert.rejects(f.rpc.setStageSkin({ skin: { packId: pack.manifest.id, kind: 'skins', assetId: 'nope' } }), { code: 'ASSET_UNAVAILABLE' })
  await assert.rejects(f.rpc.setCardStageSkin({ path: 'cards/a.json', skin: { packId: pack.manifest.id, kind: 'music', assetId: 'x' } }), { code: 'INVALID_INPUT' })
  assert.throws(() => applyTavernSettingsPatch({}, { stageSkin: { packId: 'x' } }), /无效的默认皮肤/)
  assert.equal(presentTavernSettings({}, {}).stageSkin, 'classic')
  await f.rpc.setStageSkin({ skin: 'classic' })
  assert.equal(f.settings().stageSkin, 'classic')
})
