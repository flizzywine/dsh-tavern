import test from 'node:test'
import assert from 'node:assert/strict'
import { cardExtension } from './fixtures/asset-packs/pack.mjs'
import { CARD_STAGE_SWITCHES, validateCardStage, effectiveCardStage, effectiveAutoChoices, effectiveNarrator, cardEngineSettings } from '../tavern-plugin/lib/domain/card-stage-settings.js'
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

test('the other switches take a card layer in stage.switches, resolved like a mod switch', () => {
  assert.deepEqual(CARD_STAGE_SWITCHES, ['voice','music','sfx','ambience','items','performance','autoChoices','autoCast'])
  const ext = cardExtension(), engine = defaultAssetEngineSettings(), with_ = switches => ({...ext, stage:{switches}})
  for (const globalOn of [false, true]) for (const choice of [undefined, 'on', 'off']) {
    const value = {...engine, stageToggles:{...engine.stageToggles, music:globalOn}}
    assert.equal(effectiveCardStage(with_(choice ? {music:choice} : {}), value).music, choice === 'off' ? false : globalOn || choice === 'on', JSON.stringify({globalOn, choice}))
  }
  // the director and the stage read the card's switches in effect through cardEngineSettings.
  const effective = cardEngineSettings(engine, with_({performance:'off', sfx:'off'}))
  assert.equal(effective.stageToggles.performance, false)
  assert.equal(effective.dimensions.sfx, false)
  assert.equal(effective.stageToggles.entrance, undefined, '入场演出 is no switch')
  // 自动生成选项: the global candidateAutoGenerate with stage.switches.autoChoices.
  assert.equal(effectiveAutoChoices(with_({autoChoices:'on'}), false), true)
  assert.equal(effectiveAutoChoices(with_({autoChoices:'off'}), true), false)
  assert.equal(effectiveAutoChoices(null, true), true)
  assert.equal(effectiveAutoChoices(null, false), false)
  // 旁白配音: the card layer owns only its switch; the voice is the figure named by tts.reading().narrator.
  const narrator = {enabled:true}
  assert.deepEqual(effectiveNarrator({...ext, stage:{narrator:{enabled:false}}}, narrator), {enabled:false})
  assert.deepEqual(effectiveNarrator({...ext, stage:{narrator:{enabled:true}}}, null), {enabled:true})
  assert.equal(effectiveNarrator(ext, narrator).enabled, true)
  // written once: only known keys, only 'on' / 'off'; the declared pair stays on stage.enabled.
  for (const switches of [{dialogue:'on'}, {stage:'on'}, {music:true}, {music:'yes'}, {unknown:'on'}]) assert.throws(() => validateCardStage({switches}), JSON.stringify(switches))
  assert.doesNotThrow(() => validateCardStage({enabled:true, switches:{voice:'on', autoChoices:'off'}}))
})

test('narrator card settings resolve only the switch, not a card or general voice', () => {
  assert.deepEqual(effectiveNarrator({stage:{narrator:{enabled:true}}}, {enabled:false,figure:null}), {enabled:true})
  assert.deepEqual(effectiveNarrator({stage:{narrator:{voice:null}}}, {enabled:true,figure:null}), {enabled:true})
})
