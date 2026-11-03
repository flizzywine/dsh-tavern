import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import protocol from '../tavern-plugin/packages/dsh-presentation-protocol/src/card-stage-mode.cjs'

// The 基础设置 helpers of the card page, with the mods' own modSwitchOn (mod-manager.js) and the shared stageMissing
// (asset-pack-widgets.js, the core's).
async function helpers() {
  const read = name => readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/' + name, import.meta.url), 'utf8')
  const [source, mods, widgets] = await Promise.all([read('asset-pack-card-ui.js'), read('mod-manager.js'),
    readFile(new URL('../tavern-plugin/src/client/asset-pack-widgets.js', import.meta.url), 'utf8')])
  const sandbox = {cardStageMode:protocol.cardStageMode}
  vm.createContext(sandbox)
  vm.runInContext(widgets.slice(widgets.indexOf('const STAGE_REQUIRES='), widgets.indexOf('// Section with')), sandbox)
  vm.runInContext(mods.match(/^const modSwitchOn = .*$/m)[0], sandbox)
  vm.runInContext(source.slice(source.indexOf('const STAGE_SWITCH_DEFAULTS='), source.indexOf('// cards select packs')) +
    ';this.api={stageSwitchLayers,stagePrefs,stageActive,stageSwitchPatch,stageEnable};', sandbox)
  // 配音 › 方式 (StageVoicePage): the narrator's card layer and the mode helpers.
  vm.runInContext(source.slice(source.indexOf('const NARRATOR_DEFAULT='), source.indexOf('// 通用声音 (tts.reading.dialogueVoice')) +
    ';Object.assign(this.api,{cardVoiceMode,voiceModePatch,voiceModeWrite,VOICE_MODE_RESET});', sandbox)
  return sandbox.api
}
const plain = value => JSON.parse(JSON.stringify(value))

test('基础设置 reads each switch as the global layer with the card layer, like a mod switch', async () => {
  const {stageSwitchLayers, stagePrefs, stageActive} = await helpers()
  const engine = {values:{stageToggles:{dialogue:false, stage:false, voice:true, music:true}}}
  const ext = {stage:{enabled:true, switches:{music:'off', voice:'on'}}}
  assert.deepEqual(plain(stageSwitchLayers(ext, engine).card), {music:'off', voice:'on', dialogue:'on', stage:'on'})
  const prefs = stagePrefs(ext, engine)
  assert.deepEqual([prefs.dialogue, prefs.stage, prefs.music, prefs.voice, prefs.sfx], [true, true, false, true, true])
  // a card that declares nothing follows the global 对话气泡 / 舞台模式; 本卡关闭 wins over 全局开启.
  const global = {values:{stageToggles:{dialogue:true, stage:true}}}
  assert.equal(stageActive(stagePrefs({stage:{}}, global)).stage, true)
  assert.equal(stageActive(stagePrefs({stage:{enabled:false}}, global)).stage, false)
  assert.equal(stageActive(stagePrefs({stage:{}}, engine)).stage, false)
})

test('a card choice writes stage.switches or the declaration, and a 全局 choice clears it', async () => {
  const {stageSwitchPatch, stageEnable, stagePrefs, stageActive} = await helpers()
  const ext = {stage:{dialogue:true, stage:true, defaultSkin:'classic', switches:{music:'off'}}}
  assert.deepEqual(plain(stageSwitchPatch(ext, {stage:'off'}).stage), {defaultSkin:'classic', switches:{music:'off'}, dialogue:true, stage:false})
  assert.deepEqual(plain(stageSwitchPatch(ext, {dialogue:'off'}).stage), {defaultSkin:'classic', switches:{music:'off'}, enabled:false})
  assert.deepEqual(plain(stageSwitchPatch(ext, {stage:undefined}).stage), {defaultSkin:'classic', switches:{music:'off'}})
  assert.deepEqual(plain(stageSwitchPatch(ext, {music:undefined, autoChoices:'on'}).stage), {dialogue:true, stage:true, defaultSkin:'classic', switches:{autoChoices:'on'}})
  assert.deepEqual(plain(stageSwitchPatch(ext, {music:undefined}).stage), {dialogue:true, stage:true, defaultSkin:'classic'})
  // 「去开启」: the missing switches become 本卡开启; a switch that only waits for 对话气泡 keeps its layer.
  const engine = {values:{stageToggles:{voice:true}}}, card = {stage:{}}
  const prefs = stagePrefs(card, engine)
  assert.deepEqual(plain(stageEnable('voice', stageActive(prefs), prefs)), {dialogue:'on'})
  const muted = stagePrefs(card, {values:{stageToggles:{voice:false}}})
  assert.deepEqual(plain(stageEnable('voice', stageActive(muted), muted)), {dialogue:'on', voice:'on'})
  assert.deepEqual(plain(stageEnable('stage', stageActive(prefs), prefs)), {dialogue:'on', stage:'on'})
  assert.deepEqual(plain(stageSwitchPatch(card, {dialogue:'on', stage:'on', voice:'on'}).stage), {switches:{voice:'on'}, enabled:true})
})

test('对话气泡 and 舞台模式 are two rows over one declaration; bubbles without the stage write the dialogue / stage pair', async () => {
  const {stageSwitchPatch, stageSwitchLayers} = await helpers()
  const engine = {values:{stageToggles:{}}}
  // 舞台模式 本卡关闭 on a declared card keeps its bubbles.
  const bubbles = stageSwitchPatch({stage:{enabled:true}}, {stage:'off'}).stage
  assert.deepEqual(plain(bubbles), {dialogue:true, stage:false})
  assert.deepEqual(plain(stageSwitchLayers({stage:bubbles}, engine).card), {dialogue:'on', stage:'off'})
  // 对话气泡 本卡关闭 turns both off; 本卡开启 on a card with neither keeps 舞台模式 off.
  assert.deepEqual(plain(stageSwitchPatch({stage:bubbles}, {dialogue:'off'}).stage), {enabled:false})
  assert.deepEqual(plain(stageSwitchPatch({stage:{enabled:false}}, {dialogue:'on'}).stage), {dialogue:true, stage:false})
  // 舞台模式 本卡开启 brings 对话气泡 with it; a 全局 choice on either row clears the declaration.
  assert.deepEqual(plain(stageSwitchPatch({stage:bubbles}, {stage:'on'}).stage), {enabled:true})
  assert.deepEqual(plain(stageSwitchPatch({stage:{...bubbles, switches:{music:'off'}}}, {dialogue:undefined}).stage), {switches:{music:'off'}})
})

// 方式 writes the card layer of three four-state switches in one write: 全文朗读 = fullReading on, 角色 / 旁白 off; 分角色 goes
// back to the global switches when the global mode is 分角色, else 角色配音 on + 全文朗读 off (旁白 untouched); ⟲ clears all three.
test('配音 › 方式 writes one card patch; the summary reads 分角色 / 全文朗读 / 关', async () => {
  const {voiceModePatch, voiceModeWrite, VOICE_MODE_RESET, cardVoiceMode, stagePrefs, stageActive} = await helpers()
  const ext = {stage:{enabled:true, switches:{music:'off'}}}
  const full = plain(voiceModeWrite(ext, voiceModePatch('full', {fullReading:false})).stage)
  assert.deepEqual(full, {enabled:true, switches:{music:'off', fullReading:'on', voice:'off'}, narrator:{enabled:false}})
  assert.deepEqual(plain(voiceModeWrite({stage:full}, voiceModePatch('split', {fullReading:false})).stage), {enabled:true, switches:{music:'off'}})
  assert.deepEqual(plain(voiceModeWrite({stage:{enabled:true, narrator:{enabled:true}}}, voiceModePatch('split', {fullReading:true})).stage),
    {enabled:true, narrator:{enabled:true}, switches:{voice:'on', fullReading:'off'}})
  assert.deepEqual(plain(voiceModeWrite({stage:full}, VOICE_MODE_RESET).stage), {enabled:true, switches:{music:'off'}})
  const engine = {values:{stageToggles:{dialogue:false, stage:false, voice:true, fullReading:false}}}
  const prefs = stagePrefs({stage:full}, engine)
  assert.equal(cardVoiceMode(prefs, false), 'full'); assert.equal(stageActive(prefs).voice, false, '全文朗读 turns 角色配音 off')
  assert.equal(cardVoiceMode(stagePrefs({stage:{enabled:true}}, engine), false), 'split')
  assert.equal(cardVoiceMode(stagePrefs({stage:{enabled:true, switches:{voice:'off'}}}, engine), false), 'off')
  assert.equal(cardVoiceMode(stagePrefs({stage:{enabled:false}}, engine), true), 'off', 'no bubbles: 关')
})
