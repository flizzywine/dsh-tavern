import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import figureResolution from '../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs'

const picker = await readFile(new URL('../tavern-plugin/src/client/voice-catalogue-picker.js',import.meta.url),'utf8')
const figure = await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js',import.meta.url),'utf8')
const context = vm.createContext({figureResolution})
vm.runInContext(picker.slice(0,picker.indexOf('const GENERAL_DEFAULT=')) +
  figure.slice(figure.indexOf('const voiceNeedle='),figure.indexOf('// Esc in a search box')) +
  ';globalThis.api={generalVoiceOptions,voiceKey,voiceFromKey,voiceNeedle,voiceMatches}',context)

test('catalogue options retain pack and template references and match Chinese names', async () => {
  const refs = [{packId:'11111111-1111-4111-8111-111111111111',voiceId:'clone'}, {templateId:'33333333-3333-4333-8333-333333333333'}]
  const options = await context.api.generalVoiceOptions({service:{listVoiceCatalogue:async () => ({voices:refs.map((ref,i)=>({ref,name:i?'小圆模板':'小圆',packName:i?undefined:'声音包'}))})}})
  assert.equal(options.length,2)
  for (const [i,option] of options.entries()) {
    assert.deepEqual(JSON.parse(JSON.stringify(context.api.voiceFromKey(option.value))),refs[i])
    assert.equal(context.api.voiceMatches(context.api.voiceNeedle('小圆'),[option.label,option.group]),true)
    assert.equal(context.api.voiceMatches(context.api.voiceNeedle('小圆'),['无关声音']),false)
  }
})