import { mkdtemp } from './helpers/temp-directory.mjs'
// real publication, independent preview grants, and byte exports.
// Figure voices are assigned from built-in provider presets; clones are authored as pack voice specs (voice-p1-backend).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createFigureVoiceAuthoring} from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-voice-authoring.js'
import {createTts} from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import {FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {pcmWav} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'
const audio=pcmWav(Buffer.alloc(100,1))

async function fixture(t,{beforeRead}={}) {
  const base=fileURLToPath(new URL('../.tmp/',import.meta.url));await mkdir(base,{recursive:true})
  const library=createAssetPackService({assetRoot:await mkdtemp(join(base,'figure-voice-')),authorizeLease:async()=>true})
  const tts=createTts(),calls=[]
  tts.registerProvider('fixture',{id:'local',kind:'qwen',revision:'v1',capabilities:{paid:false,serviceVoiceEngines:['qwen']},synthesize:async input=>{calls.push(input);return audio}})
  const authoringLibrary=beforeRead ? {...library,getPackSnapshot:async input=>{await beforeRead();return library.getPackSnapshot(input)}} : library
  const api=createFigureVoiceAuthoring({getLibrary:()=>authoringLibrary,getTts:()=>tts,getSettings:()=>({})})
  let pack=(await library.createPack({name:'Voices',expectedRevision:null})).snapshot
  pack=(await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,id:FIGURE_ID,name:'Figure',enabled:true,outfits:[]}})).snapshot
  t.after(async()=>{api.dispose();await tts.dispose();await library.dispose()})
  const figureId=pack.manifest.figures[0]
  const input=()=>({packId:pack.manifest.id,figureId,expectedRevision:pack.revision})
  const assign=async extra=>{const result=await api.assign({...input(),voiceId:'qwen/bella',...extra});pack=result.snapshot;return pack}
  return {figureId,api,library,tts,calls,input,assign,get pack(){return pack}}
}

test('assigning a preset publishes the figure voice under revision CAS; clear removes only the voice',async t=>{
  const f=await fixture(t),before=f.input()
  const pack=await f.assign()
  assert.ok(pack.figures[f.figureId].voice.voice.startsWith('v-'))
  assert.equal(pack.manifest.voiceLibrary.voices[pack.figures[f.figureId].voice.voice].defaultSource,'qwen')
  await assert.rejects(f.api.assign({...before,voiceId:'qwen/bella'}),{code:'REVISION_CONFLICT'})
  await f.assign({voiceId:null});assert.equal(f.pack.figures[f.figureId].voice,undefined)
  assert.equal(f.pack.figures[f.figureId].name,'Figure')
})

test('builtin provider presets copy parameters into the figure without paid synthesis or a global saved preset',async t=>{
  const f=await fixture(t);await f.assign({voiceId:'qwen/bella'})
  assert.equal(f.pack.manifest.voiceLibrary.voices[f.pack.figures[f.figureId].voice.voice].sources.qwen.provider,'qwen')
  assert.equal(f.pack.manifest.voiceLibrary.voices[f.pack.figures[f.figureId].voice.voice].sources.qwen.voiceName,'Bella')
  assert.equal(f.pack.manifest.voiceLibrary.voices[f.pack.figures[f.figureId].voice.voice].sources.qwen.engine,undefined)
  assert.equal(f.calls.length,0)
})

test('independent saved figure preview uses scoped jobs; edits revoke grant and ticket, no session needed',async t=>{
  const f=await fixture(t);await f.assign()
  await assert.rejects(f.api.open(f.input()),{code:'FORBIDDEN'})
  const grant=await f.api.open(f.input(),'http://localhost')
  assert.throws(()=>f.tts.jobs.submit({voice:grant.voice,text:'test',language:grant.language},{principal:'other',scope:grant.scope}),{code:'FORBIDDEN'})
  const job=f.tts.jobs.submit({voice:grant.voice,text:'test',language:grant.language},{principal:'dsh-browser',scope:grant.scope})
  let status
  for(let n=0;n<100;n++){status=f.tts.jobs.poll(job.requestId,'dsh-browser');if(status.state!=='running')break;await new Promise(r=>setTimeout(r,5))}
  assert.equal(status.state,'ready',JSON.stringify(status));assert.ok(await f.tts.redeemAudioTicket(status.result.ticket))
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].voiceId,undefined);assert.equal(f.calls[0].params.voice,'Bella')
  await f.assign({voiceId:null})
  await assert.rejects(f.tts.redeemAudioTicket(status.result.ticket),{code:'AUDIO_GONE'})
  assert.throws(()=>f.tts.jobs.submit({voice:grant.voice,text:'test',language:grant.language},{principal:'dsh-browser',scope:grant.scope}),{code:'FORBIDDEN'})
})

test('machine invalidation fences an in-flight open before publishing a preview grant',async t=>{
  let resume,entered,armed=false
  const gate=new Promise(resolve=>{resume=resolve}),started=new Promise(resolve=>{entered=resolve})
  // Discovery no longer probes health; pause the actual asynchronous pack read instead.
  const f=await fixture(t,{beforeRead:async()=>{if(armed){entered();await gate}}});await f.assign();armed=true
  const pending=f.api.open(f.input(),'http://localhost');await started
  f.api.invalidate();resume()
  await assert.rejects(pending,{code:'PLUGIN_UNAVAILABLE'})
  assert.equal(f.calls.length,0)
})

test('parallel preview opens respect the sixteen-grant bound',async t=>{
  const f=await fixture(t);await f.assign()
  const results=await Promise.allSettled(Array.from({length:17},()=>f.api.open(f.input(),'http://localhost')))
  assert.equal(results.filter(item=>item.status==='fulfilled').length,16)
  assert.equal(results.find(item=>item.status==='rejected').reason.code,'QUEUE_FULL')
  for(const result of results)if(result.status==='fulfilled')f.api.close(result.value.scope)
})

test('cloud preview is refused before synthesis',async t=>{
  const f=await fixture(t)
  f.tts.registerVoiceSource({owner:'fixture',sourceId:'voice-presets',revision:'one',voices:[{schemaVersion:1,id:'test/cloud',enabled:true,kind:'azure',label:'Cloud',languages:['ja'],params:{voiceName:'ja-JP-NanamiNeural'}}]})
  await f.assign({voiceId:'test/cloud'})
  f.tts.registerProvider('fixture',{id:'cloud',kind:'azure',revision:'one',capabilities:{paid:true},synthesize:()=>assert.fail('No paid synthesis')})
  await assert.rejects(f.api.open(f.input(),'http://localhost'),{code:'PAID_PREVIEW_DISABLED'});assert.equal(f.calls.length,0)
})
