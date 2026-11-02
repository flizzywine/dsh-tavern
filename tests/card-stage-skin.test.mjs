// One place decides a card's skin when the director is not changing it: the card's 「使用皮肤」 (stage.defaultSkin)
// > the global 默认皮肤 (engine dialogueTheme: built-in, custom theme or pack skin) > 经典. The stage's 本卡皮肤 writes the
// same value, and any failure falls back without rewriting it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cardAssetRawOperations, readCardAssetExtension } from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import { cardStageSkin, cardStageSkinPackIds, cardContentPackIds, validateCardStage, effectiveCardStage } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { defaultAssetEngineSettings, validateAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { validatePackManifest } from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'

const PACK = '257096b2-0532-4dfa-8495-029dbdded764', SKINS = '4c1f0b7e-5a2d-4c36-9e1b-7f2a8d3c6b50'
const paper = { packId: PACK, kind: 'skins', assetId: 'paper' }, pop = { packId: SKINS, kind: 'skins', assetId: 'pop' }
const engine = patch => ({ ...defaultAssetEngineSettings(), ...patch })
const story = { id: PACK, assets: [{ kind: 'skins', id: 'paper' }] }, skins = { id: SKINS, assets: [{ kind: 'skins', id: 'pop' }] }

test('the skin order: the card\'s 使用皮肤 > the global 默认皮肤 > classic; the fallback is what the card shows without its value', () => {
  assert.deepEqual(cardStageSkin(null, engine()), { skin: 'classic', fallback: 'classic' })
  assert.deepEqual(cardStageSkin({ stage: {} }, engine({ dialogueTheme: 'crt' })), { skin: 'crt', fallback: 'crt' })
  assert.deepEqual(cardStageSkin({ stage: {} }, engine({ dialogueTheme: paper }), [story]), { skin: paper, fallback: paper })
  const custom = { format: 'dsh-dialogue-theme', schemaVersion: 1, id: 'night', name: '夜', style: { theme: 'crt' } }
  assert.equal(cardStageSkin({ stage: {} }, engine({ dialogueTheme: 'night', dialogueThemes: [custom] })).skin, 'crt', 'a custom theme reads as its built-in theme')
  assert.deepEqual(cardStageSkin({ stage: { defaultSkin: paper } }, engine({ dialogueTheme: 'crt' }), [story]), { skin: paper, fallback: 'crt' })
  assert.deepEqual(cardStageSkin({ stage: { defaultSkin: 'aero' } }, engine({ dialogueTheme: paper }), [story]), { skin: 'aero', fallback: paper })
  assert.equal(Object.hasOwn(effectiveCardStage({ stage: {} }, engine()), 'defaultSkin'), false, 'no classic default written into the card stage')
})

// Every failure of the card's value goes to the global default when that is usable, else classic; the stored value stays and
// applies again once its skin is back (§17.5).
test('every failure falls back through the global default to classic and never rewrites the value', () => {
  const ext = { assetBindings: { boundPackIds: [PACK] }, stage: { defaultSkin: pop } }, stored = structuredClone(ext)
  const failures = {
    'its pack is off (not read)': manifests => manifests.filter(manifest => manifest.id !== SKINS),
    'the skin was removed from its pack': manifests => manifests.map(manifest => manifest.id === SKINS ? { ...manifest, assets: [] } : manifest),
  }
  for (const [label, fail] of Object.entries(failures)) {
    assert.deepEqual(cardStageSkin(ext, engine({ dialogueTheme: 'crt' }), fail([story, skins])), { skin: 'crt', fallback: 'crt' }, label + ': the global default')
    assert.deepEqual(cardStageSkin(ext, engine({ dialogueTheme: paper }), fail([story, skins])), { skin: paper, fallback: paper }, label + ': a global pack skin')
    assert.deepEqual(cardStageSkin(ext, engine({ dialogueTheme: paper }), fail([story, skins]).filter(manifest => manifest.id !== PACK)), { skin: 'classic', fallback: 'classic' }, label + ': global unusable too: classic')
  }
  assert.deepEqual(cardStageSkin({ stage: { defaultSkin: 'magical' } }, engine({ dialogueTheme: 'gothic' })), { skin: 'classic', fallback: 'classic' }, 'removed built-in ids: classic')
  assert.deepEqual(cardStageSkin({ stage: {} }, engine({ dialogueTheme: 'night', dialogueThemes: [] })), { skin: 'classic', fallback: 'classic' }, 'a deleted custom theme: classic')
  assert.deepEqual(cardStageSkin(ext, engine({ dialogueTheme: 'crt' }), [story, skins]).skin, pop, 'back: the value applies again')
  assert.deepEqual(ext, stored, 'the stored value is never rewritten')
})

test('the retired per-player choice and pack default are never read', () => {
  const pack = { ...story, stageSkin: 'paper' }
  assert.deepEqual(cardStageSkin({ assetBindings: { boundPackIds: [PACK] }, stage: { skinChoice: 'aero' } }, engine({ dialogueTheme: 'crt' }), [pack]), { skin: 'crt', fallback: 'crt' })
  assert.doesNotThrow(() => validateCardStage({ defaultSkin: 'crt', skinChoice: 'aero' }), 'an older card still loads')
  const manifest = { format: 'dsh-asset-pack', schemaVersion: 2, id: PACK, name: 'p', contentHash: '0'.repeat(64), assets: [], figures: [], sprites: {}, bundles: {}, blobs: {}, files: [] }
  assert.doesNotThrow(() => validatePackManifest({ ...manifest, stageSkin: 'paper' }), 'an older pack still loads')
})

// A pack skin is usable only while its pack is on for this card: bound, or globally enabled with its lamp.
test('the skin packs read for a card are those of its value and the global default, only while on for it', () => {
  const ext = { assetBindings: { boundPackIds: [PACK] }, stage: { defaultSkin: pop } }
  assert.deepEqual(cardStageSkinPackIds(ext, engine({ dialogueTheme: paper }), [SKINS]), [SKINS, PACK])
  assert.deepEqual(cardStageSkinPackIds(ext, engine({ dialogueTheme: paper }), []), [PACK], 'switched off: not read, the card falls back')
  assert.deepEqual(cardStageSkinPackIds({ assetBindings: { boundPackIds: [] }, stage: {} }, engine({ dialogueTheme: paper }), []), [], 'a global skin whose pack is off: classic')
  assert.deepEqual(cardStageSkinPackIds({ assetBindings: { boundPackIds: [PACK] }, stage: {} }, engine()), [], 'a bound pack carries no skin of its own choosing')
  assert.deepEqual(cardContentPackIds({ assetBindings: { boundPackIds: [SKINS, PACK] }, modConfigPackId: SKINS }), [PACK])
})

test('the card value validates as a skin selection', () => {
  for (const defaultSkin of ['aero', paper]) assert.doesNotThrow(() => validateCardStage({ defaultSkin }))
  for (const defaultSkin of ['nope', { ...paper, kind: 'backgrounds' }, 3]) assert.throws(() => validateCardStage({ defaultSkin }), JSON.stringify(defaultSkin))
  assert.doesNotThrow(() => validateAssetEngineSettings(engine({ dialogueTheme: paper })))
  assert.throws(() => validateAssetEngineSettings(engine({ dialogueTheme: { ...paper, kind: 'performances' } })))
})

// CONFIG 本卡皮肤 writes the card's one value through saveCardAssetBindings (cardAssetRawOperations): any skin it offers - a
// bound pack's, a globally enabled pack's or a built-in - and the value then survives its pack being switched off.
test('the stage\'s 本卡皮肤 writes the same card value, including a globally enabled pack\'s skin', () => {
  const raw = { name: 'c', extensions: { dsh_tavern: { schemaVersion: 1, assetBindings: { boundPackIds: [PACK] }, stage: { widgets: true, defaultSkin: paper } } } }
  const [operation] = cardAssetRawOperations(raw, { stage: { widgets: true, defaultSkin: pop } })
  assert.deepEqual(operation.value.stage, { widgets: true, defaultSkin: pop })
  const chosen = { name: 'c', extensions: { dsh_tavern: operation.value } }
  assert.deepEqual(cardStageSkin(readCardAssetExtension(chosen), engine(), [story, skins]).skin, pop)
  assert.deepEqual(cardStageSkin(readCardAssetExtension(chosen), engine(), [story]), { skin: 'classic', fallback: 'classic' }, 'its pack switched off later')
  const [cleared] = cardAssetRawOperations(chosen, { stage: { widgets: true } })
  assert.equal(Object.hasOwn(cleared.value.stage, 'defaultSkin'), false, '↺ clears the value: the global default applies')
})
