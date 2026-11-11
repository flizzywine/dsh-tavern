import test from 'node:test'
import assert from 'node:assert/strict'
import { cardAssetRawOperations } from '../tavern-plugin/lib/domain/card-asset-bindings.js'

test('a card whose dsh_tavern holds only mod choices (no schemaVersion) can still declare its stage', () => {
  const raw = {spec:'chara_card_v3', data:{extensions:{dsh_tavern:{modSystem:{version:2,mods:{'dsh.dice':'on'},packs:{},config:{}}}}}}
  const [op] = cardAssetRawOperations(raw, {assetBindings:{boundPackIds:[]}, stage:{enabled:true}})
  assert.equal(op.value.schemaVersion, 1)
  assert.deepEqual(op.value.assetBindings, {boundPackIds:[]})
  assert.equal(op.value.modSystem.mods['dsh.dice'], 'on')
  assert.throws(() => cardAssetRawOperations({extensions:{dsh_tavern:{schemaVersion:2}}}, {stage:{}}), {code:'UNSUPPORTED_SCHEMA_VERSION'})
})
