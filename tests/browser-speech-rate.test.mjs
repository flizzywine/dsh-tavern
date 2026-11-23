// a browser source speaks at its own 调音 语速 (there is no global 配音倍速): schema-checked once, read from the plan then the bound variant.
import test from 'node:test'
import assert from 'node:assert/strict'
import {validateVoiceSpec} from '../tavern-plugin/packages/dsh-presentation-protocol/src/voice-schema.js'
import {browserSpeechRate} from '../tavern-plugin/lib/domain/figure-voice.js'

const base = {name:'Sys',language:'ja',defaultSource:'sys',sources:{sys:{kind:'preset',provider:'browser',voiceName:'Nanami'}}}
const withTuning = tuning => ({...base,variants:{normal:{name:'原声',tuning:{sys:tuning}}}})

test('browser source tuning: 语速 is its only parameter, 0.5-2',()=>{
  assert.ok(validateVoiceSpec(withTuning({rate:1.25})))
  for(const bad of [{rate:3},{rate:0.2},{rate:'1'},{speed:1.2},{pitch:1}]) assert.throws(()=>validateVoiceSpec(withTuning(bad)),{code:'INVALID_INPUT'})
})

test('browser speech rate comes from the normal plan, then the bound variant; none means the system pace',()=>{
  const voice = {...base,variants:{normal:{name:'原声',tuning:{sys:{rate:1.1}}},quick:{name:'快',tuning:{sys:{rate:1.5}}}}}
  assert.deepEqual(browserSpeechRate(voice,{voice:'v'}),{rate:1.1})
  assert.deepEqual(browserSpeechRate(voice,{voice:'v',variant:'quick'}),{rate:1.5})
  assert.deepEqual(browserSpeechRate(base,{voice:'v'}),{})
})