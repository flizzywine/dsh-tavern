import test from 'node:test'
import assert from 'node:assert/strict'
import { cardExtension } from './fixtures/asset-packs/pack.mjs'
import { effectiveCardStage } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { defaultAssetEngineSettings, validateAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { cardBubbleConfig } from '../tavern-plugin/lib/card-stage.js'

test('new profiles opt into bubbles and stage explicitly; stage cores stay on', () => {
  const ext = cardExtension()
  assert.equal(effectiveCardStage(ext).stage, false)
  const engine = defaultAssetEngineSettings()
  assert.deepEqual(engine.stageToggles, {dialogue:false,voice:true,stage:false,music:true,sfx:true,ambience:true,items:true,performance:true,entrance:true})
  engine.stageToggles.dialogue = true
  assert.equal(effectiveCardStage(ext,engine).stage, false, 'bubbles alone never enable stage')
  engine.stageToggles.stage = true
  assert.equal(effectiveCardStage(ext,engine).stage, true)
  engine.stageToggles.dialogue = false
  const saved = structuredClone(engine)
  assert.deepEqual(validateAssetEngineSettings(engine), saved)
  assert.equal(effectiveCardStage(ext,engine).stage, false)
  assert.deepEqual(engine, saved, 'dependency projection never rewrites saved switches')
  const config = cardBubbleConfig({extensions:{dsh_tavern:ext}}, engine)
  assert.equal(config.enabled, false)
  assert.equal(config.stage.enabled, false)
})
