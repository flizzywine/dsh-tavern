import test from 'node:test'
import assert from 'node:assert/strict'
import { cardExtension } from './fixtures/asset-packs/pack.mjs'
import { effectiveCardStage } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { cardBubbleConfig } from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'

const on = (engine, keys) => ({...engine, stageToggles:{...engine.stageToggles, ...Object.fromEntries(keys.map(key => [key, true]))}})
const mode = (extension, engine) => { const value = effectiveCardStage(extension, engine); return [value.dialogue, value.stage] }

test('使用舞台 is four-state: the card declaration is its card layer, 本卡关闭 > 全局开启 > 本卡开启 > 全局关闭', () => {
  const ext = cardExtension(), off = defaultAssetEngineSettings(), global = on(off, ['dialogue', 'stage'])
  const card = enabled => ({...ext, stage:{enabled}})
  assert.deepEqual(mode(card(true), off), [true, true], '本卡开启 with the global switch off')
  assert.deepEqual(mode(card(false), global), [false, false], '本卡关闭 wins over 全局开启')
  assert.deepEqual(mode(ext, global), [true, true], 'a card that declares nothing follows 全局开启')
  assert.deepEqual(mode(ext, off), [false, false], 'and 全局关闭')
  assert.deepEqual(mode({...ext, stage:{dialogue:true, stage:false}}, global), [true, false], 'an older card\'s stage:false is 本卡关闭 of 舞台模式')
  assert.deepEqual(mode(ext, on(off, ['stage'])), [false, false], '舞台模式 needs 对话气泡')
  // an ordinary card (no dsh_tavern extension) never gets a stage from the global layer.
  assert.deepEqual(mode(null, global), [false, false])
  assert.equal(cardBubbleConfig({extensions:{dsh_tavern:ext}}, global).stage.enabled, true)
  assert.equal(cardBubbleConfig({name:'plain'}, global).enabled, false)
})
