import test from 'node:test'
import assert from 'node:assert/strict'
import { cardExtension } from './fixtures/asset-packs/pack.mjs'
import { effectiveCardStage } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { readCardAssetExtension, cardAssetRawOperations } from '../tavern-plugin/lib/domain/card-asset-bindings.js'

// Validation happens once, when the stage is written or imported; a card from another version must still load.
test('a stored card stage with a field this version does not know still reads, and keeps the field', () => {
  const ext = {...cardExtension(), stage:{widgets:true, laterOption:{danmaku:true}}}
  const raw = {spec:'chara_card_v3', data:{name:'旧卡', extensions:{dsh_tavern:ext}}}
  assert.deepEqual(readCardAssetExtension(raw).stage.laterOption, {danmaku:true})
  assert.equal(effectiveCardStage(ext).widgets, true)
  assert.throws(() => cardAssetRawOperations(raw, {stage:{widgets:true, laterOption:{}}}), {code:'UNKNOWN_FIELD'}, 'a write is still checked')
})