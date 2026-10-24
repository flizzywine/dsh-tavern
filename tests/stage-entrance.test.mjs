import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAssetPackService } from '../tavern-plugin/lib/asset-library/pack-v2/service.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createStageMaterial, STAGE_MEDIA_SCOPE, STAGE_READ_SCOPE } from '../tavern-plugin/lib/domain/stage-material.js'
import { validateStageEntrance, stageEntranceStart, stageEntranceStep, stageEntranceValues, stageEntranceDuration } from '../tavern-plugin/lib/domain/stage-entrance.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createAssetLibraryHandlers } from '../tavern-plugin/lib/rpc/asset-library.js'

// The generic sample that ships with the engine (examples/stage-entrance): a light point, a rush of streams, a white cover.
const sample = JSON.parse(await readFile(new URL('../examples/stage-entrance/light-tunnel.json', import.meta.url), 'utf8'))
const copy = value => structuredClone(value)
// Plays the timeline in 16 ms steps; input(state) gives each step's {ready, skip, revealed}.
function play(doc, input, options, limit = 2000) {
  let state = stageEntranceStart(doc, options), ms = 0
  const events = []
  for (let i = 0; i < limit && !state.done; i++) {
    const result = stageEntranceStep(doc, state, 16, input(state, ms))
    state = result.state; ms += 16
    events.push(...result.events.map(event => event.type === 'phase' ? event.id : event.type))
  }
  return { state, events, ms }
}

test('dsh.entrance/1 is a closed document: the sample passes; unknown layers or fields, a track without its layer, no cover or no fade-out are rejected', () => {
  assert.equal(validateStageEntrance(copy(sample)).label, '光点隧道')
  assert.equal(stageEntranceDuration(sample), 2600, 'every phase but the hold')
  const bad = [
    doc => { doc.layers.plate = { dir: 'x', frames: 1, fps: 1 } },
    doc => { doc.extra = true },
    doc => { delete doc.layers.rings },
    doc => { delete doc.phases[2].cover },
    doc => { doc.phases[3].tracks.fade = [[0, 1], [1, 0.5]] },
    doc => { doc.phases[0].tracks.light = [[0, 1], [1, 2]] },
    doc => { doc.palette.glow = 'blue' },
    doc => { doc.skip.flashMs = 20 },
    doc => { delete doc.layers.flash }
  ]
  for (const change of bad) {
    const doc = copy(sample); change(doc)
    assert.throws(() => validateStageEntrance(doc), error => error.code === 'INVALID_ENTRANCE' && /^\$/.test(error.path))
  }
})

test('the timeline holds while the stage is not ready, plays on to the cover, waits there until the stage is shown, then hands off', () => {
  const waiting = play(sample, () => ({ ready: false }), {}, 300)
  assert.equal(waiting.state.done, false)
  assert.equal(waiting.state.phase, 0, 'the hold phase loops')
  assert.ok(waiting.state.loops >= 2)
  // Ready at 1 s; shown 100 ms after the cover.
  let coveredAt = null
  const run = play(sample, (state, ms) => { if (state.covered && coveredAt === null) coveredAt = ms; return { ready: ms >= 1000, revealed: coveredAt !== null && ms >= coveredAt + 100 } })
  // Phase ids and the cover event: rush, the cover phase, covered, reveal, done.
  assert.deepEqual(run.events, ['rush', 'cover', 'cover', 'reveal', 'done'])
  assert.ok(run.ms > 1000 + 1400 + 500 && run.ms < 1000 + 2600 + 400, 'about the hold so far, the run and the wait for the stage')
  // Not shown: the cover waits (the stage's own timeout ends it, never the timeline alone).
  const unseen = play(sample, () => ({ ready: true }), {}, 400)
  assert.equal(unseen.state.done, false)
  assert.equal(unseen.state.covered, true)
})

test('a skip once the stage is ready jumps to the cover and a short handoff; before it is ready a skip does nothing', () => {
  let asked = false
  const early = play(sample, (state, ms) => ({ ready: ms >= 500, skip: ms === 160, revealed: state.covered }))
  assert.equal(early.state.skipped, false, 'a skip before the stage is ready is ignored')
  const skipped = play(sample, (state, ms) => { const skip = !asked && ms >= 160; if (skip) asked = true; return { ready: true, skip, revealed: state.covered } })
  assert.equal(skipped.state.skipped, true)
  assert.ok(skipped.ms < 160 + sample.skip.flashMs + sample.skip.handoffMs + 100, 'skip: ' + skipped.ms + ' ms')
  assert.ok(skipped.ms < stageEntranceDuration(sample))
})

test('reduced motion shows one still frame (no flash), covers once the stage is ready and fades out once it is shown', () => {
  const run = play(sample, (state, ms) => ({ ready: ms >= 200, revealed: state.covered }), { reduced: true })
  assert.deepEqual(run.events, ['cover', 'done'])
  assert.ok(run.ms >= 200 + sample.reducedMs && run.ms < 200 + sample.reducedMs + 100)
  const start = stageEntranceStart(sample, { reduced: true }), shown = stageEntranceValues(sample, start)
  assert.equal(shown.values.flash, 0)
  assert.ok(shown.values.streams > 0, 'the still is taken inside the rush')
  assert.equal(shown.values.fade, 1)
})

test('光敏保护 is on unless turned off: the cover\'s white reaches at most half', () => {
  const peak = options => { let top = 0; play(sample, state => { top = Math.max(top, stageEntranceValues(sample, state).values.flash); return { ready: true, revealed: state.covered } }, options); return top }
  assert.ok(peak({}) <= 0.5)
  assert.ok(peak({ photosensitive: false }) > 0.9)
})

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stage-entrance-'))
  const store = createProfileDataStore({ dataRoot: path.join(root, 'data') })
  const castAssets = createCastAssets({ store })
  const library = createAssetPackService({ assetRoot: path.join(root, 'asset-packs'), authorizeLease: async ({ scope }) => scope === STAGE_MEDIA_SCOPE || scope === STAGE_READ_SCOPE })
  let settings = {}
  const readTavernSettings = async () => presentTavernSettings(settings, {})
  const updateTavernSettings = async patch => { settings = applyTavernSettingsPatch(settings, patch); return readTavernSettings() }
  const stageMaterial = createStageMaterial({ library, castAssets, globalPackIds: async () => (await readTavernSettings()).globalEnabledPackIds })
  let uploadCount = 0
  const uploads = {
    async put(bytes) { const id = String(++uploadCount); await writeFile(path.join(root, 'up-' + id), bytes); return id },
    async take(id) { return { file: path.join(root, 'up-' + id), remove: async () => rm(path.join(root, 'up-' + id), { force: true }) } }
  }
  const rpc = createAssetLibraryHandlers({ assetLibrary: library, castAssets, stageMaterial, uploads, readTavernSettings, updateTavernSettings, stageSkinOf: async () => ({}),
    cardSummaries: { read: async cardPath => ({ name: path.basename(cardPath, '.json') }) }, fileResources: { list: async () => [] },
    stageMaterialChanged: () => {}, str: value => value === undefined || value === null ? '' : String(value) })
  t.after(async () => { stageMaterial.dispose(); await library.dispose(); await rm(root, { recursive: true, force: true }) })
  const add = async (packId, doc, name = 'entrance.json') => rpc.addAssetPackEntrance({ packId, name, uploadId: await uploads.put(Buffer.isBuffer(doc) ? doc : Buffer.from(JSON.stringify(doc))) })
  return { rpc, library, stageMaterial, add }
}

test('an entrance file becomes one 入场演出 entry (蓝灯, checked once as it is written); the same document is the same entry; a broken one is refused', async t => {
  const f = await fixture(t)
  const { pack: created } = await f.rpc.createAssetPack({ name: '开场' }), packId = created.manifest.id
  const { pack, id } = await f.add(packId, sample)
  const entry = pack.manifest.assets.find(asset => asset.kind === 'entrances')
  assert.deepEqual([id, entry.name, entry.enabled, entry.recall.mode], ['entrance', '光点隧道', true, 'constant'])
  assert.deepEqual(entry.entrance, sample)
  assert.equal((await f.add(packId, sample, 'again.json')).id, 'entrance', 'the same document again')
  const other = copy(sample); delete other.label; other.palette.glow = '#ffd27f'
  const second = await f.add(packId, other, '暖光.json')
  assert.deepEqual([second.id, second.pack.manifest.assets.find(asset => asset.id === second.id).name], ['entrance-2', '暖光'])
  await assert.rejects(f.add(packId, { ...copy(sample), layers: { ...sample.layers, plate: {} } }), error => error.code === 'INVALID_ENTRANCE')
  await assert.rejects(f.add(packId, Buffer.from('{not json')), error => error.code === 'INVALID_ENTRANCE')
  // An entrance has no 绿灯: the store refuses a keyword lamp.
  const current = second.pack
  await assert.rejects(f.rpc.updateAssetPackEntries({ packId, expectedRevision: current.revision,
    assets: current.manifest.assets.map(asset => asset.kind === 'entrances' ? { ...asset, recall: { mode: 'keyword', keywords: [] } } : asset) }))
  const removed = await f.rpc.removeAssetPackEntry({ packId, expectedRevision: current.revision, kind: 'entrances', id: 'entrance' })
  assert.deepEqual(removed.pack.manifest.assets.map(asset => asset.id), ['entrance-2'])
})

test('a card opens with the first entrance that is on in its own packs (binding order); a global pack never; never in the director\'s catalog', async t => {
  const f = await fixture(t), card = 'cards/a.json'
  const { pack: first } = await f.rpc.createAssetPack({ name: '甲' }), { pack: second } = await f.rpc.createAssetPack({ name: '乙' }), { pack: everyone } = await f.rpc.createAssetPack({ name: '全局' })
  await f.add(everyone.manifest.id, { ...copy(sample), label: '全局开场' })
  await f.rpc.setAssetPackState({ path: card, packId: everyone.manifest.id, state: 'global' })
  assert.equal(await f.stageMaterial.entrance(card), null, 'a global pack does not open every card\'s stage')
  const off = (await f.add(first.manifest.id, { ...copy(sample), label: '关着的' })).pack
  await f.rpc.updateAssetPackEntries({ packId: first.manifest.id, expectedRevision: off.revision, assets: off.manifest.assets.map(asset => ({ ...asset, enabled: false })) })
  await f.add(second.manifest.id, { ...copy(sample), label: '乙的开场' })
  await f.rpc.setAssetPackState({ path: card, packId: first.manifest.id, state: 'card' })
  await f.rpc.setAssetPackState({ path: card, packId: second.manifest.id, state: 'card' })
  const chosen = await f.stageMaterial.entrance(card)
  assert.deepEqual([chosen.name, chosen.ref.packId, chosen.ref.kind, chosen.document.label], ['乙的开场', second.manifest.id, 'entrances', '乙的开场'], 'an entry that is off is passed over')
  const catalog = await f.stageMaterial.catalog(card, 'a')
  assert.ok(!JSON.stringify(catalog).includes('entrances'), 'the director is never offered an entrance')
})
