import test from 'node:test'
import assert from 'node:assert/strict'
import { countServiceUsers } from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-voice-authoring.js'
import {chooseService} from '../tavern-plugin/packages/dsh-tavern-tts/src/voice-resolver.js'
import {migrateServiceSourceModels} from '../tavern-plugin/packages/dsh-tavern-stage/lib/service-model-migration.js'

// 语音后端 counts the figures a service speaks for before deleting it, by the same choice synthesis makes.
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

// The Fish / MiniMax model moves once from 语音后端 to the figures: a source with no model of its own, spoken by a service of
// its kind whose saved config still names one, takes it; the service then loses the field; with no field left nothing is written.
test('service model migration writes the service model into the sources it speaks for, then drops it once', async () => {
  const fish = (extra = {}) => ({kind:'reference-list',provider:'fish-audio',references:[],...extra})
  const voices = {
    a:{name:'甲',defaultSource:'clone',sources:{clone:fish({serviceId:'cloud'}),lib:{kind:'voice-id',provider:'fish-audio',voiceId:'x',serviceId:'local'}}},
    b:{name:'乙',defaultSource:'clone',sources:{clone:fish({serviceId:'cloud',model:'s2.1-pro-free'})}},
    c:{name:'丙',defaultSource:'online',sources:{online:{kind:'preset',provider:'qwen',voiceName:'Cherry'}}},
    d:{name:'丁',defaultSource:'mm',sources:{mm:{kind:'preset',provider:'minimax',voiceName:'female-shaonv'}}},
  }
  let packs = [{manifest:{id:'p1',voiceLibrary:{version:1,voices}},revision:'r1'},{manifest:{id:'p2',voiceLibrary:{version:1,voices:{c:voices.c}}},revision:'r2'}]
  const patches = []
  const library = {listPacks:async () => packs, patchPack:async input => { patches.push(input); packs = packs.map(p => p.manifest.id === input.packId ? {...p, manifest:{...p.manifest, voiceLibrary:input.patch.voiceLibrary}, revision:'next'} : p) }}
  let config = [{id:'cloud',kind:'fish-audio',config:{url:'https://api.fish.audio',model:'drama-3'}},{id:'local',kind:'fish-audio',config:{url:'http://127.0.0.1:9884'}},{id:'q',kind:'qwen',config:{}},{id:'mm',kind:'minimax',config:{url:'https://api.minimaxi.com',model:'speech-02-hd'}}]
  const tts = {chooseService, listServices:async () => config.map(({id,kind}) => ({id,kind})),
    legacyServiceModels:() => config.filter(p => p.config.model).map(p => ({serviceId:p.id, kind:p.kind, model:p.config.model})),
    dropLegacyServiceModels:async () => { const before = config.filter(p => p.config.model).length; config = config.map(p => p.config.model ? {...p, config:{url:p.config.url}} : p); return {dropped:before} }}
  assert.deepEqual(await migrateServiceSourceModels({library,tts}), {packs:1, sources:2, services:2})
  assert.deepEqual(patches.map(p => [p.packId, p.expectedRevision]), [['p1','r1']])
  const moved = patches[0].patch.voiceLibrary.voices
  assert.equal(moved.a.sources.clone.model, 'drama-3', 'the cloud source takes the cloud service model')
  assert.equal(moved.a.sources.lib.model, undefined, 'a service with no model gives none')
  assert.equal(moved.b.sources.clone.model, 's2.1-pro-free', 'a source that picked its own model keeps it')
  assert.equal(moved.d.sources.mm.model, 'speech-02-hd', 'the MiniMax source takes the MiniMax service model')
  assert.equal(moved.c.sources.online.model, undefined, 'another kind takes nothing')
  assert.deepEqual(config.map(p => p.config.model), [undefined, undefined, undefined, undefined], 'the old field is gone')
  assert.equal(await migrateServiceSourceModels({library,tts}), null, 'no old field: nothing to do')
  assert.equal(patches.length, 1)
})