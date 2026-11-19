// 声音 tab writes: deleting a pack voice, and copying another pack's voice into a pack for a figure.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {sealPack,jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'voice-writes-')),pack=await syntheticPack(),voiceId=pack.figures[FIGURE_ID].voice.voice
  await sealPack(pack.manifest,pack.files)
  const zip=path.join(root,'fixture.zip');await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
  const assetRoot=path.join(root,'assets'),owner=createAssetPackService({assetRoot,authorizeLease:async()=>true});t.after(()=>owner.dispose())
  const inspection=await owner.inspectImport({bytes:await readFile(zip)})
  const installed=await owner.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})
  return {owner,assetRoot,voiceId,snapshot:installed.snapshot}
}
const mediaFile=(f,packId,hash)=>path.join(f.assetRoot,'packs',packId,'media',hash+'.wav')
test('another pack\'s voice is copied into the pack, reference audio included, and pointed at by the figure',async t=>{
  const f=await fixture(t),voice=f.snapshot.manifest.voiceLibrary.voices[f.voiceId]
  const target=(await f.owner.createPack({name:'Target',expectedRevision:null})).snapshot
  const created=await f.owner.createFigure({packId:target.manifest.id,expectedRevision:target.revision,figure:{schemaVersion:1,name:'Target',enabled:true,outfits:[]}})
  const input={packId:target.manifest.id,expectedRevision:created.snapshot.revision,figureId:created.figureId,sourcePackId:PACK_ID,voiceId:f.voiceId}
  await assert.rejects(f.owner.assignPackVoiceCopy({...input,voiceId:'missing'}),{code:'VOICE_NOT_FOUND'})
  const r=await f.owner.assignPackVoiceCopy(input)
  assert.notEqual(r.voiceId,f.voiceId)
  assert.deepEqual(r.snapshot.manifest.voiceLibrary.voices[r.voiceId],voice)
  assert.deepEqual(r.snapshot.figures[created.figureId].voice,{voice:r.voiceId})
  for(const ref of voice.sources.fish.references){
    assert.ok(r.snapshot.manifest.blobs[ref.media])
    assert.deepEqual(await readFile(mediaFile(f,target.manifest.id,ref.media)),await readFile(mediaFile(f,PACK_ID,ref.media)))
  }
  // The source pack is unchanged.
  assert.deepEqual((await f.owner.getPackSnapshot({packId:PACK_ID})).manifest.voiceLibrary.voices[f.voiceId],voice)
  // The catalogue names who speaks with each voice.
  const listed=(await f.owner.listVoiceCatalogue()).voices.find(v=>v.ref.packId===target.manifest.id&&v.ref.voiceId===r.voiceId)
  assert.deepEqual(listed.users.map(u=>u.name),['Target']);assert.equal(listed.previewFigureId,created.figureId)
})
