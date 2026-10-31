import test from 'node:test'
import assert from 'node:assert/strict'
import { cardExtension } from './fixtures/asset-packs/pack.mjs'
import {validateCardStage, effectiveCardStage } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { defaultAssetEngineSettings, validateAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { cardBubbleConfig } from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'

test('对话气泡 and 舞台模式 are the card\'s: an ordinary card has no stage, a declaring card does; stage cores stay on', () => {
  const ext = cardExtension()
  const engine = defaultAssetEngineSettings()
  assert.deepEqual(engine.stageToggles, {voice:true,music:true,sfx:true,ambience:true,items:true,performance:true,entrance:true})
  assert.equal(effectiveCardStage(ext, engine).dialogue, false)
  assert.equal(effectiveCardStage(ext, engine).stage, false)
  assert.equal(effectiveCardStage({...ext, stage:{dialogue:true}}, engine).stage, false, 'bubbles alone never enable stage')
  const declared = {...ext, stage:{dialogue:true, stage:true}}
  assert.equal(effectiveCardStage(declared, engine).stage, true)
  assert.equal(effectiveCardStage({...ext, stage:{stage:true}}, engine).stage, false, 'stage needs the bubbles')
  // Settings saved while these were global switches: the keys are dropped and decide nothing.
  const legacy = {...structuredClone(engine), stageToggles:{...engine.stageToggles, dialogue:true, stage:true}}
  assert.deepEqual(validateAssetEngineSettings(legacy).stageToggles, engine.stageToggles)
  assert.equal(effectiveCardStage(ext, legacy).stage, false)
  assert.equal(cardBubbleConfig({extensions:{dsh_tavern:ext}}, engine).enabled, false)
  assert.equal(cardBubbleConfig({extensions:{dsh_tavern:declared}}, engine).enabled, true)
})


test('single stage declaration owns both modes and takes precedence over legacy flags',()=>{
 for(const enabled of [true,false]){
  const stage={enabled,dialogue:!enabled,stage:!enabled}
  validateCardStage(stage)
  const effective=effectiveCardStage({stage})
  assert.equal(effective.dialogue,enabled);assert.equal(effective.stage,enabled)
 }
 assert.throws(()=>validateCardStage({enabled:'true'}))
 assert.equal(effectiveCardStage({stage:{dialogue:true}}).dialogue,true)
 assert.equal(effectiveCardStage({stage:{dialogue:true}}).stage,false)
 assert.equal(cardBubbleConfig({extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[]},stage:{enabled:true}}}},defaultAssetEngineSettings()).stage.enabled,true)
})
