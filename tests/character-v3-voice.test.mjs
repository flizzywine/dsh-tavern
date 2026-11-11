// current reading dictionary fixtures.
import { normalizeReadingEntries } from '../tavern-plugin/packages/dsh-tavern-tts/src/reading-dictionary.js'
// real TTS sources prove pack/figure isolation, not a global preset mock.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {validateVoice} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure-voice.js'
import {validateFigureClosure} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure.js'
import {createAssetPackSpeech} from '../tavern-plugin/lib/domain/asset-pack-speech.js'
import {createTts} from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import {figureCatalogue, resolution} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {figureTtsVoice} from '../tavern-plugin/lib/domain/figure-voice.js'
import {portableVoice} from '../tavern-plugin/packages/dsh-tavern-tts/src/core.js'
import {pcmWav} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'
import {syntheticPack,PACK_ID,OTHER_PACK_ID,FIGURE_ID,OTHER_FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
const require=createRequire(import.meta.url)
const {createPackVoicePlayer}=require('../tavern-plugin/src/client/pack-playback.cjs')
import {onlineSpec as preset,cloneSpec} from './fixtures/asset-packs/voice.mjs'
import {validateVoiceSpec} from '../tavern-plugin/packages/dsh-presentation-protocol/src/voice-schema.js'
const audio=pcmWav(Buffer.alloc(100,1))
function scene(tts, voice, {packId=PACK_ID,figureId=FIGURE_ID,readReference}={}) {
  // speech resolves exact names from effective figures, never card cast.
  const figure={id:figureId,name:'Actor',aliases:['actor'],enabled:true,recall:{mode:'keyword',keywords:[]},appearance:'avatar',outfits:[],voice:{voice:'actor'}}, ref={packId,figureId}
  const extension={stage:{},assetBindings:{boundPackIds:[packId]}}
  let listener
  const presentation={extension,
    resolveName:async segment=>resolution.resolveFigureName(figureCatalogue({snapshots:[{manifest:{id:packId,figures:[figureId]},figures:{[figureId]:figure}}],bindings:extension.assetBindings}),segment),
    resolveFigure:async()=>({ref,value:figure,voiceSpec:voice,revision:'revision'}),readReference,
    subscribe(fn){listener=fn;return()=>{listener=null}}}
  return {figure,voiceSpec:voice,extension,presentation,speech:createAssetPackSpeech({presentation,getTts:()=>tts,scope:'dsh-browser'}),
    refresh:()=>listener?.({kind:'refresh',scope:{packId},reason:'pack-revision-observed'})}
}
function native(t) {
  const calls=[],tts=createTts()
  t.after(()=>tts.dispose())
  tts.registerProvider('fixture',{id:'azure',kind:'azure',revision:'r1',capabilities:{},synthesize:async input=>{calls.push(input);return audio}})
  return {tts,calls}
}

// ingress validates the binding and reusable spec, not a retired embedded preset.
test('strict figure binding and spec reject retired descriptors, secrets and machine paths',async()=>{
  assert.equal(validateVoice({voice:'actor'}).voice,'actor')
  validateVoiceSpec(preset())
  for(const modify of [v=>{v.providerId='local'},v=>{v.sources.azure.token='secret'},v=>{v.sources.azure.url='https://host'},v=>{v.sources.azure.apiKey='secret'},v=>{v.language='not a locale'}]) {const voice=preset();modify(voice);assert.throws(()=>validateVoiceSpec(voice))}
  for(const value of [{kind:'clone',engine:'gpt-sovits'},{kind:'service-preset',engine:'azure'},{id:'old/voice',language:'ja'}])assert.throws(()=>validateVoice(value))
  const online=preset();online.sources.azure.model='/absolute/weights';assert.throws(()=>validateVoiceSpec(online))
  const voice=cloneSpec(await syntheticPack());voice.sources.fish.references[0].textFile='credits/ref.txt';assert.throws(()=>validateVoiceSpec(voice))
  for(const source of [{kind:'emotion-references',provider:'local',fallback:[],emotions:{}},{kind:'reference-list',provider:'local',references:[]}]){const retired=cloneSpec(await syntheticPack());retired.sources.local=source;assert.throws(()=>validateVoiceSpec(retired))}
})
test('tuning is scalar and cannot change voice identity; locale is not limited to three languages',()=>{
  const voice=preset();voice.language='fr-CA';voice.variants={soft:{tuning:{azure:{rate:-10,style:'gentle'}}}};validateVoiceSpec(voice)
  for(const tuning of [{voiceName:'other'},{model:'other'},{moods:{calm:'soft'}}]){voice.variants.soft.tuning.azure=tuning;assert.throws(()=>validateVoiceSpec(voice))}
})

test('clone audio belongs to pack closure and must be WAV, never a missing/global reference',async()=>{
  const pack=await syntheticPack();validateFigureClosure(pack.manifest,pack.figures,pack.sprites)
  const hash=Object.values(pack.manifest.voiceLibrary.voices)[0].sources.fish.references[0].media
  delete pack.manifest.blobs[hash]
  assert.throws(()=>validateFigureClosure(pack.manifest,pack.figures,pack.sprites),{code:'MISSING_DEPENDENCY'})
  pack.manifest.blobs[hash]={mime:'audio/mp3'}
  assert.throws(()=>validateFigureClosure(pack.manifest,pack.figures,pack.sprites),{code:'MISSING_DEPENDENCY'})
})

for(const samePack of [false,true])test(`equal IDs in ${samePack?'different figures of one pack':'different packs'} cannot cross-resolve`,async t=>{
  const {tts,calls}=native(t),a=scene(tts,preset()),b=scene(tts,preset('Second','ja-JP-KeitaNeural'),{packId:samePack?PACK_ID:OTHER_PACK_ID,figureId:OTHER_FIGURE_ID})
  t.after(()=>{a.speech.dispose();b.speech.dispose()})
  const va=await a.speech.open('actor'),vb=await b.speech.open('actor')
  assert.equal(va.available,true);assert.equal(vb.available,true);assert.equal(va.voiceId,vb.voiceId)
  assert.notEqual(va.voice.source,vb.voice.source)
  const first=await a.speech.synthesize('actor',{text:'same'}),second=await b.speech.synthesize('actor',{text:'same'})
  assert.notEqual(first.key,second.key)
  assert.equal(calls[0].params.voiceName,'ja-JP-NanamiNeural');assert.equal(calls[1].params.voiceName,'ja-JP-KeitaNeural')
  assert.equal((await a.speech.synthesize('actor',{text:'same'})).cacheHit,true)
  assert.equal(calls.length,2)
  const wrong=tts.grantConsumer({principal:'test',source:va.voice.source,scope:'test'})
  await assert.rejects(tts.synthesize({voice:vb.voice,text:'forbidden',language:'ja'},{grant:wrong.grant,scope:'test'}),{code:'FORBIDDEN'})
  wrong.dispose()
  assert.deepEqual(await tts.exportVoicePresets(['shared/voice']),[],'figure registration does not write the global registry')
})

test('clone synthesis reads verified pack media and exact reference transcript through the real TTS pipeline',async t=>{
  const pack=await syntheticPack(),voice=cloneSpec(pack),calls=[],reads=[],tts=createTts()
  t.after(()=>tts.dispose())
  tts.registerProvider('fixture',{id:'clone',kind:'fish-audio',revision:'r1',capabilities:{voiceKinds:['fish-audio','reference'],paid:false,referenceInput:['bytes-v1','bytes-list-v1']},synthesize:async input=>{calls.push(input);return audio}})
  const f=scene(tts,voice,{readReference:async(ref,revision,hash)=>{reads.push({ref,revision,hash});return pack.files.get(`media/${hash}.wav`)}})
  t.after(()=>f.speech.dispose())
  assert.equal((await f.speech.open('actor')).available,true)
  await f.speech.synthesize('actor',{text:'hello',mood:'crying'})
  assert.equal(reads[0].ref.packId,PACK_ID)
  assert.ok(voice.sources.fish.references.some(r=>r.media===reads[0].hash&&r.text===calls[0].reference.transcript)) // repeated SHA may have distinct captions.
  assert.deepEqual(calls[0].reference.bytes,pack.files.get(`media/${reads[0].hash}.wav`))
  assert.equal(calls[0].references.length,voice.sources.fish.references.length) // the whole ordered pool, no per-mood pick
})

test('shared clone source keeps a live reference reader after either card consumer closes',async t=>{
  const pack=await syntheticPack(),voice=cloneSpec(pack),tts=createTts()
  t.after(()=>tts.dispose())
  tts.registerProvider('fixture',{id:'clone',kind:'fish-audio',revision:'r1',capabilities:{voiceKinds:['fish-audio','reference'],paid:false,referenceInput:['bytes-v1','bytes-list-v1']},synthesize:async()=>audio})
  for(const closeFirst of [true,false]) {
    const live=[true,true],scenes=live.map((_,i)=>scene(tts,voice,{readReference:async(_ref,_revision,hash)=>{
      assert.equal(live[i],true,'disposed presentation must not read bytes');return pack.files.get(`media/${hash}.wav`)
    }}))
    t.after(()=>scenes.forEach(s=>s.speech.dispose()))
    const selected=await Promise.all(scenes.map(s=>s.speech.open('actor')))
    assert.equal(selected[0].voice.source,selected[1].voice.source)
    const closed=closeFirst?0:1,remaining=1-closed
    scenes[closed].speech.dispose();live[closed]=false
    await scenes[remaining].speech.synthesize('actor',{text:'remaining '+closed,mood:'crying'})
    scenes[remaining].speech.dispose();live[remaining]=false
  }
})

test('visual refresh preserves voice source/cache; preset and language edits change source identity (readings are global)',async t=>{
  const {tts}=native(t),f=scene(tts,preset());t.after(()=>f.speech.dispose())
  const first=await f.speech.open('actor');await f.speech.synthesize('actor',{text:'same'})
  f.refresh();assert.deepEqual((await f.speech.open('actor')).voice,first.voice)
  assert.equal((await f.speech.synthesize('actor',{text:'same'})).cacheHit,true)
  f.figure.voice.language='en';f.refresh()
  const next=await f.speech.open('actor');assert.notEqual(next.voice.source,first.voice.source);assert.equal(next.language,'en')
  const read=next
  f.voiceSpec.sources.azure.voiceName='ja-JP-KeitaNeural';f.refresh()
  assert.notEqual((await f.speech.open('actor')).voice.source,read.voice.source)
})

test('author revalidation to an unserved provider revokes the old scoped voice and leaves the figure silent',async t=>{
  const {tts,calls}=native(t),f=scene(tts,preset());t.after(()=>f.speech.dispose())
  const old=await f.speech.open('actor')
  f.voiceSpec.sources.azure={kind:'preset',provider:'qwen',voiceName:'Bella'}
  f.refresh()
  // No service listed speaks qwen: the figure stays silent and says so (SERVICE_REQUIRED); nothing switches to the browser.
  assert.deepEqual(await f.speech.open('actor'),{available:false,diagnostics:['SERVICE_REQUIRED']})
  assert.throws(()=>tts.jobs.submit({voice:old.voice,text:'stale',language:'ja'},{principal:'dsh-browser',scope:old.scope}),{code:'FORBIDDEN'})
  assert.equal(calls.length,0)
})

test('a superseded resolution failure cannot revoke a newer generation grant',async t=>{
  const {tts}=native(t),f=scene(tts,preset());t.after(()=>f.speech.dispose())
  await f.speech.open('actor')
  const resolve=f.presentation.resolveFigure
  let reject
  f.presentation.resolveFigure=()=>new Promise((_,fail)=>{reject=fail})
  const pending=f.speech.open('actor')
  await new Promise(resolve=>setImmediate(resolve)) // Let async name resolution reach the suspended figure read.
  f.presentation.resolveFigure=resolve;f.figure.voice.language='en';f.refresh()
  const next=await f.speech.open('actor');assert.equal(next.available,true)
  reject(Object.assign(new Error('old resolution'),{code:'ASSET_STALE'}))
  assert.equal((await pending).available,false)
  const job=tts.jobs.submit({voice:next.voice,text:'current',language:'en'},{principal:'dsh-browser',scope:next.scope})
  tts.jobs.cancel(job.requestId,'dsh-browser')
})

test('browser player submits the scoped host voice via native jobs, never the display/global ID',async t=>{
  const {tts,calls}=native(t),f=scene(tts,preset());t.after(()=>f.speech.dispose())
  const descriptor=await f.speech.open('actor'),submissions=[]
  const client={apiVersion:1,available:()=>true,subscribe:()=>()=>{},synthesize:async(input,options)=>{
    submissions.push(input)
    const {requestId}=tts.jobs.submit(input,{principal:'dsh-browser',scope:options.scope})
    const signal=AbortSignal.timeout(5000)
    for (;;) {
      const job=await tts.jobs.wait(requestId,'dsh-browser',signal)
      if(job.state==='ready')return job.result
      if(job.state==='error')throw Error(job.error)
    }
  },audio:async ticket=>new Blob([await tts.redeemAudioTicket(ticket)])}
  const player=createPackVoicePlayer({getClient:()=>client,createAudio:()=>({play:async()=>{},pause(){}}),urls:{createObjectURL:()=> 'blob:voice',revokeObjectURL(){}}})
  t.after(()=>player.dispose());player.setEnabled(true)
  const played=await player.play(descriptor,{owner:'test',id:'line',text:'same'})
  assert.equal(played,true,JSON.stringify(player.get()))
  assert.deepEqual(submissions[0].voice,descriptor.voice);assert.equal('voiceId' in submissions[0],false)
  assert.equal(calls[0].params.voiceName,'ja-JP-NanamiNeural')
})
