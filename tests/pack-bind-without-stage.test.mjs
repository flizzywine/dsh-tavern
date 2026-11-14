// A card without stage settings still binds packs ("本卡"): bindings are card data, the stage stays off, and the first-run enable keeps them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardEditor } from '../tavern-plugin/lib/domain/card-editor.js'
import { effectiveCardStage } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { createCardAssetBoundary, cardAssetWorkspaceRevision } from '../tavern-plugin/lib/card-asset-bindings.js'
import { PACK_ID } from './fixtures/asset-packs/pack.mjs'
const PATH = 'cards/plain.json'
function plainCard() {
  const prep = createCardPreparation({id:() => 'plain', now:() => 1})
  let card = prep.create({kind:'import', payload:{name:'Plain', extensions:{foreign:{keep:true}}}})
  const readWorkspace = async () => structuredClone(card)
  const updateCard = createCardEditor({cardPreparation:prep, readCardWorkspace:readWorkspace, cardAssetWorkspaceRevision,
    fileResources:{async writeWorking(_p, text) { card = JSON.parse(text) }}, bumpCardProjectionRevision:async () => {}, syncCardName:async () => {}})
  return createCardAssetBoundary({ctx:{get:() => undefined}, getEngine:() => engine, listCards:async () => [{path:PATH}], readWorkspace, updateCard})
}
// the global 对话气泡 / 舞台模式 switches are on: an ordinary card must still not start playing the stage.
const engine = {...defaultAssetEngineSettings(), stageToggles:{...defaultAssetEngineSettings().stageToggles, dialogue:true, stage:true}}
const save = async (boundary, patch) => boundary.update({path:PATH, expectedRevision:(await boundary.snapshot(PATH)).revision, patch})

test('a card with no stage settings binds a pack, reads it back, and keeps the stage off', async () => {
  const boundary = plainCard()
  assert.equal((await boundary.snapshot(PATH)).extension, null)
  const saved = await save(boundary, {assetBindings:{boundPackIds:[PACK_ID]}, stage:{enabled:false}})
  assert.deepEqual(saved.extension.assetBindings.boundPackIds, [PACK_ID])
  assert.equal(saved.effectiveStage.dialogue, false); assert.equal(saved.effectiveStage.stage, false)
  assert.deepEqual((await boundary.inspect({path:PATH, metadataOnly:true})).extension.assetBindings.boundPackIds, [PACK_ID])
})
test('enabling the stage afterwards keeps the bindings, and unbinding leaves the stage declaration alone', async () => {
  const boundary = plainCard()
  await save(boundary, {assetBindings:{boundPackIds:[PACK_ID]}, stage:{enabled:false}})
  const current = (await boundary.snapshot(PATH)).extension
  const enabled = await save(boundary, {assetBindings:current.assetBindings, stage:{enabled:true}})
  assert.deepEqual(enabled.extension.assetBindings.boundPackIds, [PACK_ID])
  assert.equal(effectiveCardStage(enabled.extension, engine).stage, true)
  const unbound = await save(boundary, {assetBindings:{...enabled.extension.assetBindings, boundPackIds:[]}})
  assert.equal(unbound.extension.stage.enabled, true)
})