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
  // a card that declares nothing follows the global 使用舞台; 本卡关闭 wins over 全局开启.
  const global = {values:{stageToggles:{dialogue:true, stage:true}}}
  assert.equal(stageActive(stagePrefs({stage:{}}, global)).stage, true)
  assert.equal(stageActive(stagePrefs({stage:{enabled:false}}, global)).stage, false)
  assert.equal(stageActive(stagePrefs({stage:{}}, engine)).stage, false)
})

test('a card choice writes stage.switches or the declaration, and a 全局 choice clears it', async () => {
  const {stageSwitchPatch, stageEnable, stagePrefs, stageActive} = await helpers()
  const ext = {stage:{dialogue:true, stage:true, defaultSkin:'classic', switches:{music:'off'}}}
  assert.deepEqual(plain(stageSwitchPatch(ext, {stage:'off'}).stage), {defaultSkin:'classic', switches:{music:'off'}, enabled:false})
  assert.deepEqual(plain(stageSwitchPatch(ext, {stage:undefined}).stage), {defaultSkin:'classic', switches:{music:'off'}})
  assert.deepEqual(plain(stageSwitchPatch(ext, {music:undefined, autoChoices:'on'}).stage), {dialogue:true, stage:true, defaultSkin:'classic', switches:{autoChoices:'on'}})
  assert.deepEqual(plain(stageSwitchPatch(ext, {music:undefined}).stage), {dialogue:true, stage:true, defaultSkin:'classic'})
  // 「去开启」: the missing switches become 本卡开启; a switch that only waits for 使用舞台 keeps its layer.
  const engine = {values:{stageToggles:{voice:true}}}, card = {stage:{}}
  const prefs = stagePrefs(card, engine)
  assert.deepEqual(plain(stageEnable('voice', stageActive(prefs), prefs)), {stage:'on'})
  const muted = stagePrefs(card, {values:{stageToggles:{voice:false}}})
  assert.deepEqual(plain(stageEnable('voice', stageActive(muted), muted)), {stage:'on', voice:'on'})
  assert.deepEqual(plain(stageSwitchPatch(card, {stage:'on', voice:'on'}).stage), {switches:{voice:'on'}, enabled:true})
})
