import test from 'node:test'
import assert from 'node:assert/strict'
import { cardExtension } from './fixtures/asset-packs/pack.mjs'
import { CARD_STAGE_SWITCHES, validateCardStage, effectiveCardStage, effectiveAutoChoices, effectiveNarrator, cardEngineSettings, cardStageSkin } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { withoutPlayerChoices } from '../tavern-plugin/lib/domain/card-export-settings.js'
import { defaultAssetEngineSettings, validateAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { cardBubbleConfig } from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'

const on = (engine, keys) => ({...engine, stageToggles:{...engine.stageToggles, ...Object.fromEntries(keys.map(key => [key, true]))}})
const mode = (extension, engine) => { const value = effectiveCardStage(extension, engine); return [value.dialogue, value.stage] }

test('对话气泡 and 舞台模式 default off globally: an ordinary card has no stage, a declaring card does; stage cores stay on', () => {
  const ext = cardExtension()
  const engine = defaultAssetEngineSettings()
  assert.deepEqual(engine.stageToggles, {dialogue:false,voice:true,stage:false,music:true,sfx:true,ambience:true,items:true,performance:true})
  assert.deepEqual(mode(ext, engine), [false, false])
  assert.equal(effectiveCardStage({...ext, stage:{dialogue:true}}, engine).stage, false, 'bubbles alone never enable stage')
  const declared = {...ext, stage:{dialogue:true, stage:true}}
  assert.equal(effectiveCardStage(declared, engine).stage, true)
  assert.equal(effectiveCardStage({...ext, stage:{stage:true}}, engine).stage, false, 'stage needs the bubbles')
  // Settings saved before the global layer existed read as 全局关闭; saved switches round-trip unchanged.
  const { dialogue: _dialogue, stage: _stage, ...older } = engine.stageToggles
  assert.deepEqual(validateAssetEngineSettings({...structuredClone(engine), stageToggles:older}).stageToggles, engine.stageToggles)
  const saved = on(engine, ['dialogue', 'stage'])
  assert.deepEqual(validateAssetEngineSettings(structuredClone(saved)).stageToggles, saved.stageToggles)
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

test('removed built-in skins (gothic, magical): saved selections still load and are drawn as classic',()=>{
 const engine=defaultAssetEngineSettings(),preset={format:'dsh-dialogue-theme',schemaVersion:1,id:'night',name:'夜',style:{theme:'magical'}}
 const saved=validateAssetEngineSettings({...structuredClone(engine),dialogueTheme:'gothic',dialogueThemes:[preset]})
 assert.equal(saved.dialogueTheme,'classic');assert.equal(saved.dialogueThemes[0].style.theme,'classic')
 assert.doesNotThrow(()=>validateCardStage({defaultSkin:'gothic',skinChoice:'magical'}))
 assert.deepEqual(cardStageSkin({stage:{defaultSkin:'gothic',skinChoice:'magical'}},engine),{skin:'classic',fallback:'classic'})
 assert.throws(()=>validateCardStage({defaultSkin:'nope'}))
})

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
  assert.deepEqual(CARD_STAGE_SWITCHES, ['voice','music','sfx','ambience','items','performance','autoChoices'])
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
  // 旁白配音: the card layer's enabled is 本卡开启 / 本卡关闭; its voice still overrides key by key.
  const narrator = {enabled:true, voice:{browser:'a'}}
  assert.deepEqual(effectiveNarrator({...ext, stage:{narrator:{enabled:false}}}, narrator), {enabled:false, voice:{browser:'a'}})
  assert.deepEqual(effectiveNarrator({...ext, stage:{narrator:{enabled:true}}}, null), {enabled:true, voice:null})
  assert.equal(effectiveNarrator(ext, narrator).enabled, true)
  // written once: only known keys, only 'on' / 'off'; the declared pair stays on stage.enabled.
  for (const switches of [{dialogue:'on'}, {stage:'on'}, {music:true}, {music:'yes'}, {unknown:'on'}]) assert.throws(() => validateCardStage({switches}), JSON.stringify(switches))
  assert.doesNotThrow(() => validateCardStage({enabled:true, switches:{voice:'on', autoChoices:'off'}}))
})

test('the card layer is the player\'s: it never leaves or arrives with a card', () => {
  const raw = {spec:'chara_card_v3', data:{extensions:{dsh_tavern:{...cardExtension(), stage:{enabled:true, switches:{music:'off'}, skinChoice:'crt'}}}}}
  assert.deepEqual(withoutPlayerChoices(raw).data.extensions.dsh_tavern.stage, {enabled:true})
})

test('retired reading switches are dropped before strict validation', () => {
  const engine = defaultAssetEngineSettings()
  engine.stageToggles.fullReading = true
  assert.equal(Object.hasOwn(validateAssetEngineSettings(engine).stageToggles, 'fullReading'), false)
  assert.deepEqual(validateCardStage({switches:{fullReading:'on',music:'off'}}).switches, {music:'off'})
  assert.throws(() => validateCardStage({narrator:{voice:{silent:true}}}))
})

for (const voice of [{browser:'Kyoko'}, {serviceId:'mm',voice:'female-shaonv'}]) test('narrator falls back to general voice: ' + JSON.stringify(voice), () => {
  assert.deepEqual(effectiveNarrator({stage:{narrator:{enabled:true}}}, {enabled:false,voice:null}, voice), {enabled:true,voice})
  assert.deepEqual(effectiveNarrator({stage:{narrator:{voice:null}}}, {enabled:true,voice}, {browser:'other'}), {enabled:true,voice})
})
