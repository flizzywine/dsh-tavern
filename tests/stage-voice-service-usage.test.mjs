import test from 'node:test'
import assert from 'node:assert/strict'
import {countServiceUsers} from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-voice-authoring.js'
import {chooseService} from '../tavern-plugin/packages/dsh-tavern-tts/src/voice-resolver.js'

// 配音后端 counts the figures a service speaks for before deleting it, by the same choice synthesis makes.
test('service usage counts the figures whose 配音来源 that service speaks', async () => {
  const voices = {
    a:{name:'甲',defaultSource:'online',sources:{online:{kind:'preset',provider:'minimax',voiceName:'female-1',serviceId:'mm-b'}}},
    b:{name:'乙',defaultSource:'online',sources:{online:{kind:'preset',provider:'qwen',voiceName:'Cherry'}}},
    c:{name:'丙',defaultSource:'clone',sources:{clone:{kind:'reference-list',provider:'fish-audio',references:[]}}},
  }
  const pack = {manifest:{voiceLibrary:{voices}},figures:{
    one:{voice:{voice:'a'}}, two:{voice:{voice:'b'}}, three:{voice:{voice:'b',source:null}}, four:{voice:{voice:'c'}}, five:{}}}
  const library = {listPacks:async () => [pack, {packId:'broken',error:{code:'ASSET_UNAVAILABLE'}}]}
  const tts = {chooseService, listServices:async () => [{id:'mm-a',kind:'minimax'},{id:'mm-b',kind:'minimax'},{id:'my-qwen',kind:'qwen'},{id:'fish',kind:'fish-audio'}]}
  const count = async serviceId => (await countServiceUsers({library,tts,serviceId})).count
  assert.equal(await count('mm-b'), 1)
  assert.equal(await count('mm-a'), 0)
  // no serviceId and the only service of its kind; a figure set to 不配音 is not counted.
  assert.equal(await count('my-qwen'), 1)
  assert.equal(await count('fish'), 1)
})
