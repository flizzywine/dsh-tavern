import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import { lintTriggers, enforceTriggers } from '../tavern-plugin/lib/asset-library/asset-packs/trigger-lint.js'
import { createAssetPackService } from '../tavern-plugin/lib/asset-library/pack-v2/service.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createStageMaterial, STAGE_MEDIA_SCOPE, STAGE_READ_SCOPE } from '../tavern-plugin/lib/domain/stage-material.js'
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
function wav(seconds = 1) {
  const bytes = Buffer.alloc(44 + 16000 * seconds)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000 * seconds, 40)
  return bytes
}

// The handlers on a real store, cast manifests and settings document; uploads are files in a temp folder.
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asset-editor-'))
  const store = createProfileDataStore({ dataRoot: path.join(root, 'data') })
  const castAssets = createCastAssets({ store })
  const library = createAssetPackService({ assetRoot: path.join(root, 'asset-packs'), authorizeLease: async ({ scope }) => scope === STAGE_MEDIA_SCOPE || scope === STAGE_READ_SCOPE })
  let settings = {}
  const readTavernSettings = async () => presentTavernSettings(settings, {})
  const updateTavernSettings = async patch => { settings = applyTavernSettingsPatch(settings, patch); return readTavernSettings() }
  const stageMaterial = createStageMaterial({ library, castAssets, globalPackIds: async () => (await readTavernSettings()).globalEnabledPackIds })
  const cards = ['cards/a.json', 'cards/b.json'], signals = []
  let uploadCount = 0
  const uploads = {
    async put(bytes) { const id = String(++uploadCount); await writeFile(path.join(root, 'up-' + id), bytes); return id },
    async take(id) { return { file: path.join(root, 'up-' + id), remove: async () => rm(path.join(root, 'up-' + id), { force: true }) } }
  }
  const rpc = createAssetLibraryHandlers({ assetLibrary: library, castAssets, stageMaterial, uploads, readTavernSettings, updateTavernSettings,
    cardSummaries: { read: async cardPath => ({ name: path.basename(cardPath, '.json') }) }, fileResources: { list: async kind => kind === 'card' ? cards : [] },
    stageMaterialChanged: cardPath => signals.push(cardPath ?? ''), str: value => value === undefined || value === null ? '' : String(value) })
  t.after(async () => { stageMaterial.dispose(); await library.dispose(); await rm(root, { recursive: true, force: true }) })
  const files = async rows => Promise.all(rows.map(async ([name, bytes]) => ({ name, uploadId: await uploads.put(bytes) })))
  return { rpc, library, castAssets, stageMaterial, uploads, files, signals, settings: () => settings }
}
const entry = (pack, kind, name) => pack.manifest.assets.find(asset => asset.kind === kind && asset.name === name)
const edit = (pack, kind, id, update) => pack.manifest.assets.map(asset => asset.kind === kind && asset.id === id ? update(asset) : asset)

test('trigger words are checked only where an author wrote them: none, or 3–6 short words that tell entries apart', () => {
  const row = (kind, id, keywords, extra = {}) => ({ kind, id, name: id, enabled: true, recall: { mode: 'keyword', keywords }, directorNote: '', ...extra })
  const doc = assets => ({ manifest: { assets } })
  const rules = result => result.issues.map(issue => [issue.entry, issue.rule, issue.trigger])
  assert.equal(lintTriggers(doc([row('backgrounds', 'room', [])])).violations, 0, 'no words: recalled by its name')
  assert.deepEqual(rules(lintTriggers(doc([row('backgrounds', 'room', ['教室'])]))), [['backgrounds/room', 'count', '教室']])
  assert.deepEqual(rules(lintTriggers(doc([row('backgrounds', 'room', ['教室', '黑板', '讲台'])]))), [])
  assert.deepEqual(rules(lintTriggers(doc([row('backgrounds', 'room', ['教室', '黑板', '讲台', '走廊氛围', '学'])]))),
    [['backgrounds/room', 'suffix', '走廊氛围'], ['backgrounds/room', 'short-word', '学']])
  assert.deepEqual(rules(lintTriggers(doc([row('music', 'song', ['离别', '毕业', '放课后茶会乐队'])]))), [['music/song', 'music-unit', '放课后茶会乐队']])
  const generic = Array.from({ length: 5 }, (_, i) => row('music', 's' + i, ['音乐', '曲' + i + '甲', '曲' + i + '乙']))
  assert.equal(rules(lintTriggers(doc(generic))).filter(issue => issue[1] === 'group-generic').length, 5)
  // An installed entry is not re-checked when only its name or lamp changes; a changed word list is.
  const before = doc([row('backgrounds', 'room', ['教室'])])
  assert.equal(lintTriggers(doc([{ ...row('backgrounds', 'room', ['教室']), name: '新名字', recall: { mode: 'constant', keywords: ['教室'] } }]), { before }).violations, 0)
  assert.equal(lintTriggers(doc([row('backgrounds', 'room', ['教室', '黑板'])]), { before }).violations, 1)
  assert.equal(lintTriggers(doc([{ ...row('backgrounds', 'room', ['教室', '黑板']), enabled: false }]), { before }).violations, 0, 'an off entry is not linted')
  const error = (() => { try { enforceTriggers(before, doc([row('backgrounds', 'room', ['教室', '黑板'])])) } catch (err) { return err } })()
  assert.equal(error.code, 'TRIGGER_LINT')
  assert.match(error.message, /触发词「教室、黑板」违反 count：[^。]+。正例：[^。]+。/, 'the client turns this sentence into the field error')
  assert.deepEqual(enforceTriggers(before, doc([row('backgrounds', 'room', ['教室', '黑板'])]), true).map(issue => issue.rule), ['count'], 'force publishes and reports')
})

test('a pack is created, filled from uploaded files (one entry per file, 蓝灯) and edited: lamp, words (linted), notes, volume', async t => {
  const { rpc, files, signals } = await fixture(t)
  await assert.rejects(rpc.createAssetPack({ name: '  ' }), { code: 'INVALID_INPUT' })
  let { pack } = await rpc.createAssetPack({ name: '校园' })
  const packId = pack.manifest.id
  const added = await rpc.addAssetPackFiles({ packId, kind: 'backgrounds', files: await files([['教室', png(1, 2, 3)], ['坏文件', Buffer.from('not an image')], ['走廊', png(4, 5, 6)]]) })
  assert.equal(added.added.length, 2)
  assert.deepEqual(added.rejected, [{ name: '坏文件', reason: 'INVALID_INPUT' }])
  const again = await rpc.addAssetPackFiles({ packId, kind: 'backgrounds', files: await files([['教室副本', png(1, 2, 3)]]) })
  assert.deepEqual(again.added, [added.added[0]], 'the same bytes are the same entry')
  await rpc.addAssetPackFiles({ packId, kind: 'music', files: await files([['离别', wav(1)]]) })
  ;({ pack } = await rpc.getAssetPack({ packId }))
  assert.deepEqual(pack.manifest.assets.map(asset => [asset.kind, asset.name, asset.recall.mode, asset.recall.keywords.length]),
    [['backgrounds', '教室', 'constant', 0], ['backgrounds', '走廊', 'constant', 0], ['music', '离别', 'constant', 0]])
  const room = entry(pack, 'backgrounds', '教室'), song = entry(pack, 'music', '离别')
  // One word is refused by the lint with the store's sentence; the pack keeps its revision.
  await assert.rejects(rpc.updateAssetPackEntries({ packId, expectedRevision: pack.revision, assets: edit(pack, 'backgrounds', room.id, asset => ({ ...asset, recall: { ...asset.recall, keywords: ['教室'] } })) }),
    error => error.code === 'TRIGGER_LINT' && /触发词「教室」违反 count/.test(error.message))
  ;({ pack } = await rpc.updateAssetPackEntries({ packId, expectedRevision: pack.revision, assets: edit(pack, 'backgrounds', room.id, asset => ({ ...asset, name: '三年二班', directorNote: '上课、自习时用', remark: '自己拍的',
    recall: { mode: 'keyword', keywords: ['教室', '黑板', '讲台'] } })) }))
  ;({ pack } = await rpc.updateAssetPackEntries({ packId, expectedRevision: pack.revision, assets: edit(pack, 'music', song.id, asset => ({ ...asset, enabled: false, volume: 0.4 })) }))
  assert.deepEqual([entry(pack, 'backgrounds', '三年二班').recall, entry(pack, 'backgrounds', '三年二班').directorNote, entry(pack, 'backgrounds', '三年二班').remark],
    [{ mode: 'keyword', keywords: ['教室', '黑板', '讲台'] }, '上课、自习时用', '自己拍的'])
  assert.deepEqual([entry(pack, 'music', '离别').enabled, entry(pack, 'music', '离别').volume], [false, 0.4])
  // A stale revision loses; a too-long director note is the store's own refusal.
  await assert.rejects(rpc.updateAssetPackEntries({ packId, expectedRevision: 'stale', assets: pack.manifest.assets }), { code: 'REVISION_CONFLICT' })
  await assert.rejects(rpc.updateAssetPackEntries({ packId, expectedRevision: pack.revision, assets: edit(pack, 'music', song.id, asset => ({ ...asset, directorNote: '长'.repeat(301) })) }))
  assert.match((await rpc.previewAssetPackMedia({ packId, hash: room.media })).url, /^\/api\//)
  assert.ok(signals.length >= 5, 'every write wakes the games that may use the pack')
})

test('替换媒体 keeps the entry; deleting an entry drops audio nothing else plays', async t => {
  const { rpc, files, library } = await fixture(t)
  const packId = (await rpc.createAssetPack({ name: '曲集' })).pack.manifest.id
  await rpc.addAssetPackFiles({ packId, kind: 'music', files: await files([['甲', wav(1)], ['乙', wav(2)]]) })
  let { pack } = await rpc.getAssetPack({ packId })
  const first = entry(pack, 'music', '甲'), old = first.media
  ;({ pack } = await rpc.updateAssetPackEntries({ packId, expectedRevision: pack.revision, assets: edit(pack, 'music', first.id, asset => ({ ...asset, directorNote: '开场', recall: { mode: 'keyword', keywords: ['离别', '毕业', '远行'] } })) }))
  const [upload] = await files([['', wav(3)]])
  ;({ pack } = await rpc.replaceAssetPackMedia({ packId, expectedRevision: pack.revision, kind: 'music', id: first.id, uploadId: upload.uploadId }))
  const replaced = entry(pack, 'music', '甲')
  assert.notEqual(replaced.media, old)
  assert.deepEqual([replaced.id, replaced.directorNote, replaced.recall.keywords], [first.id, '开场', ['离别', '毕业', '远行']])
  assert.equal(pack.manifest.blobs[old], undefined, 'the old audio went with its last entry')
  const [bad] = await files([['', Buffer.from('nope')]])
  await assert.rejects(rpc.replaceAssetPackMedia({ packId, expectedRevision: pack.revision, kind: 'music', id: first.id, uploadId: bad.uploadId }), { code: 'INVALID_INPUT' })
  const second = entry(pack, 'music', '乙')
  ;({ pack } = await rpc.removeAssetPackEntry({ packId, expectedRevision: pack.revision, kind: 'music', id: second.id }))
  assert.deepEqual(pack.manifest.assets.map(asset => asset.name), ['甲'])
  assert.equal(pack.manifest.blobs[second.media], undefined)
  assert.equal((await library.getPackSnapshot({ packId })).manifest.files.some(file => file.path.includes(second.media)), false)
  await assert.rejects(rpc.removeAssetPackEntry({ packId, expectedRevision: pack.revision, kind: 'music', id: second.id }), { code: 'ASSET_UNAVAILABLE' })
})

test('全局 / 本卡 / 关闭: a pack bound to a card or to every card reaches the director; deleting it unbinds it everywhere', async t => {
  const { rpc, files, castAssets, stageMaterial, settings, signals } = await fixture(t)
  const packId = (await rpc.createAssetPack({ name: '共享背景' })).pack.manifest.id
  await rpc.addAssetPackFiles({ packId, kind: 'backgrounds', files: await files([['操场', png(7, 8, 9)]]) })
  assert.deepEqual(await rpc.getCardAssetPacks({ path: 'cards/a.json' }), { boundPackIds: [], globalEnabledPackIds: [] })
  await assert.rejects(rpc.setAssetPackState({ path: '', packId, state: 'card' }), { code: 'INVALID_INPUT' }, '本卡 needs a card')
  signals.length = 0
  assert.deepEqual(await rpc.setAssetPackState({ path: 'cards/a.json', packId, state: 'card' }), { boundPackIds: [packId], globalEnabledPackIds: [] })
  assert.deepEqual(signals, ['cards/a.json'], 'a card\'s own change wakes that card\'s games')
  assert.deepEqual((await stageMaterial.catalog('cards/a.json', 'a')).background.map(row => row.name), ['操场'])
  assert.deepEqual((await stageMaterial.catalog('cards/b.json', 'b')).background, [])
  // 全局 replaces 本卡 (one state per pack and card) and reaches every card.
  assert.deepEqual(await rpc.setAssetPackState({ path: 'cards/a.json', packId, state: 'global' }), { boundPackIds: [packId], globalEnabledPackIds: [packId] })
  assert.deepEqual(settings().globalEnabledPackIds, [packId])
  assert.deepEqual((await stageMaterial.catalog('cards/b.json', 'b')).background.map(row => row.name), ['操场'])
  assert.deepEqual(await rpc.setAssetPackState({ path: '', packId, state: 'off' }), { boundPackIds: [], globalEnabledPackIds: [] })
  assert.equal(Object.hasOwn(settings(), 'globalEnabledPackIds'), false, 'an empty list is not stored')
  await rpc.setAssetPackState({ path: 'cards/a.json', packId, state: 'off' })
  assert.deepEqual((await castAssets.read('cards/a.json')).boundPackIds, [])
  // Deleting the pack takes it out of every card that binds it and out of 全局, so no card points at a deleted pack.
  await rpc.setAssetPackState({ path: 'cards/a.json', packId, state: 'card' })
  await rpc.setAssetPackState({ path: 'cards/b.json', packId, state: 'card' })
  await rpc.setAssetPackState({ path: '', packId, state: 'global' })
  const { pack } = await rpc.getAssetPack({ packId })
  await rpc.removeAssetPack({ packId, expectedRevision: pack.revision })
  assert.deepEqual([(await castAssets.read('cards/a.json')).boundPackIds, (await castAssets.read('cards/b.json')).boundPackIds, settings().globalEnabledPackIds], [[], [], undefined])
  assert.deepEqual((await rpc.listAssetPacks()).packs, [])
  await assert.rejects(rpc.setAssetPackState({ path: 'cards/a.json', packId, state: 'card' }), { code: 'ASSET_UNAVAILABLE' })
})

test('the 全局 setting holds valid pack ids only, one change at a time', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e', other = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
  let doc = applyTavernSettingsPatch({}, { globalPack: { packId: id, enabled: true } })
  doc = applyTavernSettingsPatch(doc, { globalPack: { packId: other, enabled: true } })
  doc = applyTavernSettingsPatch(doc, { globalPack: { packId: id, enabled: true } })
  assert.deepEqual(presentTavernSettings(doc, {}).globalEnabledPackIds, [other, id])
  assert.deepEqual(presentTavernSettings({ globalEnabledPackIds: [id, 'x', 3] }, {}).globalEnabledPackIds, [id])
  assert.throws(() => applyTavernSettingsPatch({}, { globalPack: { packId: 'nope', enabled: true } }), /无效的素材包设置/)
  assert.throws(() => applyTavernSettingsPatch({}, { globalPack: { packId: id } }), /无效的素材包设置/)
})
