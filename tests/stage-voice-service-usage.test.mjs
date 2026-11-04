import test from 'node:test'
import assert from 'node:assert/strict'
import {countServiceUsers,createFigureVoiceAuthoring} from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-voice-authoring.js'
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

// Browser speech needs no voice service and no voice name: without one it is the system default voice.
test('the figure voice editor reports no issue for browser speech, with or without a voice name',async()=>{
  const ref={packId:'11111111-1111-4111-8111-111111111111',figureId:'22222222-2222-4222-8222-222222222222'}
  const spec=voiceName=>({name:'Akane',language:'ja',defaultSource:'browser',sources:{browser:{kind:'preset',provider:'browser',...(voiceName?{voiceName}:{})}}})
  const tts={apiVersion:1,resolveVoiceService:async()=>({effective:null,issues:[{code:'SERVICE_REQUIRED'}]})}
  const editor=async voiceSpec=>{
    const library={apiVersion:2,getPackSnapshot:async()=>({revision:'r',figures:{[ref.figureId]:{id:ref.figureId,voice:{voice:'akane'}}},manifest:{voiceLibrary:{version:1,voices:{akane:voiceSpec}}}})}
    return createFigureVoiceAuthoring({getLibrary:()=>library,getTts:()=>tts,getSettings:()=>({})}).editor(ref)
  }
  assert.deepEqual((await editor(spec('Microsoft Nanami'))).issues,[])
  assert.deepEqual((await editor(spec(null))).issues,[],'no voiceName is the system default voice, not VOICE_NOT_FOUND')
})