import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceAssetPackScene, applyAssetPackLight, assetPackTimeLighting, assetPackBackgroundVariant } from '../src/asset-pack-stage.js'
import { stageLookLayer } from '../src/stage-light.cjs'
const packId = '11111111-1111-4111-8111-111111111111'
const ref = (kind, assetId) => ({ packId, kind, assetId })
const base = () => ({ format: 'asset-packs-v1', scene: null, music: null, lighting: { time: { mode: 'auto', ref: null }, mood: null }, actors: {}, soundscape: {}, widgets: {} })
const night = { ref: ref('looks', 'night'), layer: 'time', timeOfDay: 'night' }

test('global time does not change the legacy lighting classifier or name pack looks', () => {
  assert.equal(stageLookLayer({ id: 'night' }), 'time')
  const result = reduceAssetPackScene(base(), { background: ref('backgrounds', 'night'), timeOfDay: null }, [night])
  assert.equal(result.state.scene.timeOfDay, null)
  assert.equal(result.state.lighting.time.ref, null)
})

test('scene reducer rejects retired time-look selections and never mutates inputs', () => {
  const state = base(), bytes = JSON.stringify(state)
  assert.throws(() => reduceAssetPackScene(state, { background: ref('backgrounds', 'room'), timeOfDay: null, timeLook: night.ref }, [night]))
  assert.throws(() => reduceAssetPackScene(state, { background: ref('backgrounds', 'room'), timeOfDay: 'day', timeLook: night.ref }, [night]))
  const selected = reduceAssetPackScene(state, { background: ref('backgrounds', 'room'), timeOfDay: 'night' }, [night])
  assert.equal(selected.state.scene.timeOfDay, 'night')
  assert.deepEqual(selected.state.lighting.time, { mode: 'auto', ref: null })
  assert.equal(JSON.stringify(state), bytes)
})

test('global time is independent of pack candidates; semantic replay preserves the selected mood', () => {
  const scene = { background: ref('backgrounds', 'room'), timeOfDay: 'night', timeLook: null }
  const other = { ...night, ref: ref('looks', 'night-2') }
  assert.deepEqual(assetPackTimeLighting(scene, []), { time: { mode: 'auto', ref: null }, diagnostics: [] })
  assert.deepEqual(assetPackTimeLighting(scene, [night, other]), assetPackTimeLighting(scene, []))
  const mood = { ref: ref('looks', 'day'), layer: 'mood' }
  const state = applyAssetPackLight(base(), { mode: 'mood', ref: mood.ref }, [mood]).state
  assert.deepEqual(reduceAssetPackScene(state, null, []).state.lighting.mood, mood.ref)
  assert.throws(() => applyAssetPackLight(state, { mode: 'mood', ref: night.ref }, [night]))
})

test('flat time variants select their content; unmatched time keeps the default media with compensation', () => {
  const scene = { background: ref('backgrounds', 'day'), timeOfDay: 'night', timeLook: null }
  const background = { variants: { default: 'day', entries: [
    { id: 'day', name: 'Day', content: { media: 'base' } },
    { id: 'night', name: 'Night', content: { media: 'variant' } }
  ] } }
  assert.deepEqual(assetPackBackgroundVariant(background, scene), { media: 'variant', variant: 'night', timeMatched: true, compensateBackground: false, diagnostics: [] })
  const missing = assetPackBackgroundVariant({ media: 'night-name' }, scene)
  assert.equal(missing.media, 'night-name'); assert.equal(missing.timeMatched, false)
  assert.equal(missing.compensateBackground, true)
  assert.deepEqual(missing.diagnostics, [])
  assert.equal(assetPackBackgroundVariant(background, { ...scene, variant: 'day' }).media, 'base')
})
