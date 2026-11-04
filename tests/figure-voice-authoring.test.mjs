import { mkdtemp } from './helpers/temp-directory.mjs'
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

async function fixture(t) {
  const base=fileURLToPath(new URL('../.tmp/',import.meta.url));await mkdir(base,{recursive:true})
  const library=createAssetPackService({assetRoot:await mkdtemp(join(base,'figure-voice-')),authorizeLease:async()=>true})
  const tts=createTts()
  tts.registerProvider('fixture',{id:'local',kind:'qwen',revision:'v1',capabilities:{paid:false,serviceVoiceEngines:['qwen']},synthesize:async()=>audio})
  const api=createFigureVoiceAuthoring({getLibrary:()=>library,getTts:()=>tts,getSettings:()=>({})})
  let pack=(await library.createPack({name:'Voices',expectedRevision:null})).snapshot
  pack=(await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,id:FIGURE_ID,name:'Figure',enabled:true,outfits:[]}})).snapshot
  t.after(async()=>{api.dispose();await tts.dispose();await library.dispose()})
  const figureId=pack.manifest.figures[0]
  const input=()=>({packId:pack.manifest.id,figureId,expectedRevision:pack.revision})
  const assign=async extra=>{const result=await api.assign({...input(),voiceId:'qwen/bella',...extra});pack=result.snapshot;return pack}
  return {figureId,api,library,assign,get pack(){return pack}}
}

// The figure lamp is about the stage, not authoring: a figure switched off, or the new-figure page's hidden draft
// (enabled:false), still auditions its saved voice and candidates on its voice page.
test('a figure switched off still previews its voice and candidates',async t=>{
  const f=await fixture(t);await f.assign()
  const pack=(await f.library.patchFigure({packId:f.pack.manifest.id,expectedRevision:f.pack.revision,figureId:f.figureId,patch:{enabled:false}})).snapshot
  const input={packId:pack.manifest.id,figureId:f.figureId,expectedRevision:pack.revision}
  const saved=await f.api.open(input,'http://localhost');f.api.close(saved.scope)
  const candidate=await f.api.preview({...input,voiceSpec:{name:'Candidate',language:'ja',defaultSource:'qwen',sources:{qwen:{kind:'preset',provider:'qwen',voiceName:'Cherry'}}}},'http://localhost')
  assert.equal(candidate.status,'submitted');f.api.close(candidate.scope)
})

test('a figure without a voice still refuses a saved-voice preview',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.api.open({packId:f.pack.manifest.id,figureId:f.figureId,expectedRevision:f.pack.revision},'http://localhost'),{code:'VOICE_NOT_FOUND'})
})
