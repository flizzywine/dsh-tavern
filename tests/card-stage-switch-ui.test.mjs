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
  // Narrator settings share the card patch and four-state switch semantics.
  vm.runInContext(source.slice(source.indexOf('const NARRATOR_DEFAULT='), source.indexOf('const VOICE_HELP=')) +
    ';Object.assign(this.api,{narratorLayers,narratorCardPatch,narratorWrite});', sandbox)
  return sandbox.api
}
const plain = value => JSON.parse(JSON.stringify(value))

test('旁白配音 writes only its switch: the card layer in stage.narrator, the global one in tts.reading.narrator', async () => {
  const api=await helpers(),writes=[],reading=[]
  const ctx={ext:{stage:{enabled:true}},writer:{reading:{narrator:{enabled:false}},write:fn=>writes.push(plain(fn(ctx.ext))),setReading:p=>reading.push(plain(p))}}
  api.narratorWrite(ctx,'card',{enabled:true})
  assert.deepEqual(writes[0],{stage:{enabled:true,narrator:{enabled:true}}})
  assert.equal(api.narratorLayers(writes[0],ctx.writer.reading).effective.enabled,true)
  ctx.ext=writes[0];api.narratorWrite(ctx,'card',{enabled:undefined})
  assert.deepEqual(writes[1],{stage:{enabled:true}})
  api.narratorWrite(ctx,'global',{enabled:true})
  assert.deepEqual(reading,[{narrator:{enabled:true}}])
})