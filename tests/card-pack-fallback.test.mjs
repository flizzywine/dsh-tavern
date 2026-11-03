// An external card without packs: its loose material becomes one library pack the card binds (本卡开启), its voice
// fields the figure's voice; a CHARX export writes them back. A .dshcard keeps its own packs.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAssetPacks } from '../tavern-plugin/lib/domain/asset-packs.js'
import { createCardFiles } from '../tavern-plugin/lib/domain/card-files.js'
import { createCardPlugins } from '../tavern-plugin/lib/domain/card-plugins.js'
import { createCardPreparation, projectCardSummary, rawData } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardSummaryCache } from '../tavern-plugin/lib/domain/card-summary-cache.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { readZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createMediaStore } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media-store.js'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { png } from './fixtures/asset-packs/pack.mjs'

function wav(seed) {
  const bytes = Buffer.alloc(60)
  bytes.write('RIFF'); bytes.writeUInt32LE(52, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16, 40)
  bytes.writeUInt32LE(seed, 44)
  return bytes
}

async function setup(t, channels = []) {
  const root = await mkdtemp(join(tmpdir(), 'card-pack-fallback-'))
  const service = createAssetPackService({ assetRoot: join(root, 'library'), voiceChannels: async () => channels })
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) })
  const profileData = createProfileDataStore({ dataRoot: root })
  const store = createFileResourceStore({ dataRoot: root }), failWrites = { on: false }
  const fileResources = ({ ...store, importCard: (...args) => failWrites.on ? Promise.reject(new Error('disk full')) : store.importCard(...args) })
  let serial = 0
  const cardPreparation = createCardPreparation({ id: () => 'card-' + ++serial, now: Date.now })
  const readCardWorkspace = async cardPath => {
    const existing = await fileResources.readCard(cardPath)
    if (existing === undefined || cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(cardPath, (working, payload) => cardPreparation.migrate({ working, payload }))
  }
  const files = createCardFiles({
    cardPreparation, fileResources, castAssets: createCastAssets({ store: profileData }), readCardWorkspace,
    assetPacks: createAssetPacks({ store: profileData, mediaStore: createMediaStore({ root: join(root, 'asset-packs') }) }),
    cardSummaries: createCardSummaryCache({ absolute: cardPath => fileResources.absolute(cardPath), read: async cardPath => projectCardSummary(await readCardWorkspace(cardPath)) }),
    worldBooks: { characterBookForCard: async () => undefined }, cardPlugins: createCardPlugins({ dataRoot: root, pluginsDir: join(root, 'plugins') }),
    presetLibrary: {}, importPreset: () => assert.fail('no start defaults'), pluginApi: () => assert.fail('not a plugin format'), assetLibrary: () => service
  })
  const bindings = async cardPath => rawData((await readCardWorkspace(cardPath)).raw).extensions.dsh_tavern
  return { root, files, service, bindings, failWrites }
}

// The figure is 彩叶 (alias Iroha); the card is named by the alias. Expressions carry the card's own Chinese names.
const images = { joy: png([250, 200, 80]), sadness: png([60, 90, 200]), neutral: png([120, 180, 120]), avatar: png([240, 160, 180]), cover: png([10, 20, 30]) }
const clips = [wav(1), wav(2), wav(3)]
function charx({ description = '日语声音的彩叶', characters } = {}) {
  const uri = name => 'embeded://assets/x/' + name
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Iroha', description,
    assets: [{ type: 'icon', name: 'main', ext: 'png', uri: uri('cover.png') }, ...(characters ? [] : [{ type: 'emotion', name: '微笑', ext: 'png', uri: uri('joy.png') },
      { type: 'emotion', name: '哭泣', ext: 'png', uri: uri('sadness.png') }, { type: 'emotion', name: '默认', ext: 'png', uri: uri('neutral.png') }])],
    extensions: { dsh_tavern: { cast: { version: 1, characters: characters || [{ name: '彩叶', aliases: ['Iroha'], avatar: uri('avatar.png'),
      sprites: { joy: uri('joy.png'), sadness: uri('sadness.png'), neutral: uri('neutral.png') }, voices: {},
      voiceReferences: clips.map((_, index) => ({ audio: uri('voice-' + index + '.wav'), text: '参考の台詞 ' + (index + 1) })),
      voiceSource: { provider: 'fish', clone: true }, voiceLanguage: 'ja' }] } } } } }
  return writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, ...Object.entries(images).map(([name, content]) => ({ path: 'assets/x/' + name + '.png', content })),
    ...clips.map((content, index) => ({ path: 'assets/x/voice-' + index + '.wav', content }))])
}

test('a CHARX without packs becomes one bound library pack with its voice; the same material never makes a second pack', async t => {
  const { root, files, service, bindings } = await setup(t)
  const source = join(root, 'iroha.charx')
  await writeFile(source, charx())
  const first = await files.importCardArchiveFile(source, 'iroha.charx')
  assert.equal(first.libraryPack.status, 'installed')
  assert.deepEqual(first.libraryNotices, ['彩叶的声音来源 fish 没有对应渠道，已忽略'])
  const own = await bindings(first.path)
  assert.deepEqual(own.assetBindings.boundPackIds, [first.libraryPack.id], 'the card binds its pack (本卡开启)')
  assert.equal(own.cast, undefined, 'the cast lives in the pack now')
  assert.deepEqual(own.stage, { enabled: true }, 'the card\'s stage switch is 本卡开启')

  const pack = await service.getPackSnapshot({ packId: first.libraryPack.id })
  assert.equal(pack.manifest.name, 'Iroha')
  const [figure] = Object.values(pack.figures)
  assert.notEqual(figure.id, figure.name)
  assert.equal(figure.name, '彩叶')
  assert.deepEqual(figure.aliases, ['Iroha'])
  assert.deepEqual(figure.emotions.map(row => [row.id, row.label]), [['neutral', '默认'], ['joy', '微笑'], ['sadness', '哭泣']])
  const [outfit] = figure.outfits
  assert.equal(Object.keys(outfit.avatars).length, 1)
  const voice = pack.manifest.voiceLibrary.voices[figure.voice.voice]
  assert.equal(figure.voice.source, null, 'the dropped source chooses nothing; the clips stay')
  assert.equal(voice.language, 'ja')
  assert.deepEqual(voice.sources[voice.defaultSource].references.map(clip => [clip.text, clip.language]), [['参考の台詞 1', 'ja'], ['参考の台詞 2', 'ja'], ['参考の台詞 3', 'ja']])

  assert.equal((await files.importCardArchiveFile(source, 'iroha.charx')).duplicate, true)
  const other = join(root, 'iroha-2.charx')
  await writeFile(other, charx({ description: '同じ素材、別の説明' }))
  const second = await files.importCardArchiveFile(other, 'iroha-2.charx')
  assert.notEqual(second.path, first.path)
  assert.deepEqual([second.libraryPack.id, second.libraryPack.status], [first.libraryPack.id, 'noop'])
  assert.equal((await service.listPacks()).length, 1)

  // the SillyTavern export writes the library figure back, voice included; importing it opens no new pack
  const exported = await files.exportCardFile(first.path)
  assert.equal(exported.extension, 'dshcard')
  const entries = readZipEntries(exported.bytes.subarray(exported.bytes.indexOf(Buffer.from('PK\u0003\u0004'))))
  const card = JSON.parse(entries.get('card.json').toString())
  assert.deepEqual(card.data.assets.filter(asset => asset.type === 'emotion').map(asset => asset.name).sort(), ['哭泣', '微笑', '默认'], 'the card\'s own expression names')
  const [cast] = card.data.extensions.dsh_tavern.cast.characters
  assert.deepEqual([cast.name, cast.aliases, cast.voiceLanguage, cast.voiceSource], ['彩叶', ['Iroha'], 'ja', undefined], 'the dropped source is not written back')
  assert.deepEqual(cast.voiceReferences.map(clip => entries.get(clip.audio.slice('embeded://'.length))), clips)
  assert.deepEqual(entries.get(cast.avatar.slice('embeded://'.length)), images.avatar)
  const back = join(root, 'back.dshcard')
  await writeFile(back, exported.bytes)
  const again = await files.importCardArchiveFile(back, 'back.dshcard')
  assert.deepEqual([again.libraryPack.id, again.libraryPack.status], [first.libraryPack.id, 'noop'])
  assert.equal((await service.listPacks()).length, 1)
})

test('with a matching channel the source is the figure\'s and goes back out on export', async t => {
  const { root, files, service } = await setup(t, ['fish-audio'])
  const source = join(root, 'iroha.charx')
  await writeFile(source, charx())
  const first = await files.importCardArchiveFile(source, 'iroha.charx')
  assert.equal(first.libraryNotices, undefined)
  const [figure] = Object.values((await service.getPackSnapshot({ packId: first.libraryPack.id })).figures)
  assert.deepEqual(figure.voice, { voice: 'cast-1' })
  const exported = await files.exportCardFile(first.path)
  const entries = readZipEntries(exported.bytes.subarray(exported.bytes.indexOf(Buffer.from('PK\u0003\u0004'))))
  const [cast] = JSON.parse(entries.get('card.json').toString()).data.extensions.dsh_tavern.cast.characters
  assert.deepEqual(cast.voiceSource, { provider: 'fish', clone: true })
  const back = join(root, 'back.dshcard')
  await writeFile(back, exported.bytes)
  assert.deepEqual((await files.importCardArchiveFile(back, 'back.dshcard')).libraryPack, { ...first.libraryPack, status: 'noop' })
})

test('a cast with nothing usable makes no pack and the card still imports; a failed card write takes its new pack with it', async t => {
  const { root, files, service, failWrites } = await setup(t)
  for (const [index, voiceSource] of [{}, { provider: '' }, { provider: 'minimax' }].entries()) {
    const source = join(root, 'empty-' + index + '.charx')
    await writeFile(source, charx({ description: 'empty ' + index, characters: [{ name: '空壳', aliases: [], sprites: {}, voices: {}, voiceSource }] }))
    const imported = await files.importCardArchiveFile(source, 'empty-' + index + '.charx')
    assert.equal(imported.libraryPack, undefined)
    assert.deepEqual(imported.libraryNotices, voiceSource.provider ? ['空壳的声音来源 minimax 没有对应渠道，已忽略'] : undefined)
  }
  assert.deepEqual(await service.listPacks(), [])

  const source = join(root, 'iroha.charx')
  await writeFile(source, charx())
  failWrites.on = true
  await assert.rejects(files.importCardArchiveFile(source, 'iroha.charx'), /disk full/)
  assert.deepEqual(await service.listPacks(), [])
})

test('a .dshcard with packs keeps them; its loose material makes no pack of its own', async t => {
  const { root, files, service, bindings } = await setup(t)
  const packId = '55555555-5555-4555-8555-555555555555'
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Packed', description: 'own pack',
    extensions: { dsh_tavern: { schemaVersion: 1, assetBindings: { boundPackIds: [packId] }, cast: { version: 1, characters: [{ name: '彩叶', avatar: 'embeded://avatar.png', sprites: {}, voices: {} }] } } } } }
  const source = join(root, 'packed.dshcard')
  await writeFile(source, writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, { path: 'avatar.png', content: images.avatar },
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, packs: [{ id: packId, path: 'assets/' + packId + '/', format: 'dsh-asset-pack', contentHash: 'b'.repeat(64) }] }) },
    { path: 'assets/' + packId + '/manifest.json', content: JSON.stringify({ format: 'dsh-asset-pack', schemaVersion: 1, id: packId, name: 'Own', contentHash: 'b'.repeat(64), figures: [], sprites: {}, bundles: {}, assets: [], blobs: {}, files: [] }) }]))
  const imported = await files.importCardArchiveFile(source, 'packed.dshcard')
  assert.equal(imported.libraryPack, undefined)
  assert.ok(imported.assets, 'its loose material stays the card\'s character material')
  assert.equal((await bindings(imported.path)).stage, undefined, 'its stage switch is the card\'s own')
  assert.deepEqual((await service.listPacks()).filter(row => row.manifest?.id !== packId), [])
})
