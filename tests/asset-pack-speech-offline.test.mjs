import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssetPackSpeech } from '../tavern-plugin/lib/domain/asset-pack-speech.js'
import { createTts } from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import { pcmWav } from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'

const extension = () => ({schemaVersion:1,assetBindings:{boundPackIds:[]}})

// A stopped service (a local voice server that is turned off) does not close the figure's voice: its cached line still plays.
test('a figure voice opens and plays its cached line while its service is down; a new line reports the service',async t => {
  const ext=extension(), audio=pcmWav(Buffer.alloc(100,1)), ref={packId:'11111111-1111-4111-8111-111111111111',figureId:'22222222-2222-4222-8222-222222222222'}
  ext.assetBindings.boundPackIds=[ref.packId]
  const figure={enabled:true,voice:{voice:'iroha'}},voiceSpec={name:'Iroha',language:'ja',defaultSource:'qwen',sources:{qwen:{kind:'preset',provider:'qwen',voiceName:'Bella'}}}
  const presentation={resolveName:async()=>({status:'resolved',ref}),extension:ext,subscribe:() => () => {},resolveFigure:async() => ({value:figure,voiceSpec,revision:'r1'})}
  const tts=createTts({}), speech=createAssetPackSpeech({presentation,getTts:() => tts,scope:'card'})
  t.after(async () => {speech.dispose(); await tts.dispose()})
  let down=false
  const offline=() => {if(down)throw Object.assign(Error('down'),{code:'SERVICE_OFFLINE'})}
  tts.registerProvider('local',{id:'local',kind:'qwen',revision:'provider',capabilities:{serviceVoiceEngines:['service-engine']},discover:async () => offline(),health:async () => (offline(),{state:'ready'}),
    catalog:async () => [],synthesize:async () => (offline(),audio)})
  assert.equal((await speech.open('iroha')).available,true)
  const first=await speech.synthesize('iroha',{text:'だめ',mood:'anger'})
  speech.dispose()
  down=true
  const again=createAssetPackSpeech({presentation,getTts:() => tts,scope:'card'})
  t.after(() => again.dispose())
  assert.equal((await again.open('iroha')).available,true)
  const cached=await again.synthesize('iroha',{text:'だめ',mood:'anger'})
  assert.equal(cached.key,first.key); assert.equal(cached.cacheHit,true)
  await assert.rejects(again.synthesize('iroha',{text:'新しい台詞',mood:'anger'}),{code:'SERVICE_OFFLINE'})
})
