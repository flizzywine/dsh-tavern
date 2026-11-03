import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {renderClip,encodeClip,verifyClipFile} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-encode.js'
import {clipVideoStreamKey} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-stream.js'
import {clipRun} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-process.js'

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'clip-stream-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const images=[]
  for(const color of ['red','blue']){
    const png=join(root,color+'.png'),jpg=join(root,color+'.jpg')
    await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i',`color=c=${color}:s=320x180`,'-frames:v','1',png])
    await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-i',png,'-q:v','1',jpg])
    images.push({png:await readFile(png),jpg:await readFile(jpg)})
  }
  const plan={fps:30,frames:90,captureFormat:'jpeg',resolution:{width:320,height:180}}
  const file=(preset,startFrame,frames)=>({preset,format:'mp4',fps:30,frames,startFrame,sourceFrames:frames,durationMs:frames*1000/30,resolution:{width:1920,height:1080},videoBitrate:8000000,audioBitrate:160000,maxBytes:preset==='discord'?8388608:null,from:{turn:1,para:startFrame?2:1},to:{turn:1,para:2}})
  const parts=[file('1080p',0,90),file('discord',0,41),file('discord',41,49)]
  const frame=n=>images[n%2]
  const renderer={capture:async n=>frame(n).jpg,reference:async n=>frame(n).png,evidence:async()=>({clock:'virtual',nonStageRects:[],voiceOnsets:[]}),close:async()=>{}}
  return {root,plan,parts,renderer}
}

test('capture streams full and paragraph video encodes, then muxes measured audio without reencoding',{timeout:90000},async t=>{
  const {root,plan,parts,renderer}=await fixture(t),progress=[]
  const capture=renderer.capture,reference=renderer.reference;let referenceStarted=false
  renderer.reference=async(frame,options)=>{referenceStarted=true;assert.equal(options.background,true);return reference(frame)}
  renderer.capture=async frame=>{assert.ok(referenceStarted,'independent replay starts before primary capture finishes');return capture(frame)}
  const voice=join(root,'voice.wav')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','sine=frequency=773:duration=0.5','-ar','48000',voice])
  renderer.evidence=async()=>({clock:'virtual',nonStageRects:[],voiceOnsets:[{id:'voice',audioFrame:12,revealFrame:12}]})
  const rendered=await renderClip({plan,plannedFiles:parts,tempRoot:root,renderer,audio:[{id:'voice',kind:'voice',path:voice,startFrame:12,durationMs:500}],referenceFrames:[0,40,41,42,88,89],onProgress:value=>progress.push(value)})
  t.after(()=>rendered.close())
  assert.equal(rendered.videos.size,3)
  assert.ok(progress.some(row=>row.step==='capture'&&row.capture?.streams?.some(stream=>stream.frames>0)),'video encoders receive frames during capture')
  for(const [index,part] of parts.entries()){
    assert.ok(rendered.videos.has(clipVideoStreamKey(part)))
    const intermediate=await readFile(rendered.videos.get(clipVideoStreamKey(part)).path)
    assert.ok(intermediate.indexOf(Buffer.from('mdat'))<intermediate.indexOf(Buffer.from('moov')),'unpublished video skips redundant faststart relocation')
    const phases=[]
    const result=await encodeClip({plan:part,rendered,outputPath:join(root,index+'.mp4'),onProgress:value=>phases.push(value)})
    assert.equal(result.file.frames,part.frames)
    assert.ok(phases.some(row=>row.step==='audio'))
    assert.ok(phases.some(row=>row.step==='mux'))
    assert.equal(result.verification.voiceOnsets.length,index===2?0:1)
    for(const onset of result.verification.voiceOnsets){assert.ok(onset.correlation>=0.85);assert.equal(onset.decodedLagSamples,0)}
    assert.ok(!phases.some(row=>['pass1','pass2','video'].includes(row.step)))
    assert.ok(result.file.samples.every(row=>row.ssim>=0.95))
    assert.ok(result.file.faststart)
    if(part.preset==='discord')assert.ok(result.file.bytes<=8388608)
    if(index===0){
      const diagnosticsRoot=join(root,'mismatch')
      await assert.rejects(verifyClipFile({path:result.file.path,plan:part,references:rendered.references,minSsim:2,diagnosticsRoot}),/不一致/)
      assert.deepEqual((await readdir(diagnosticsRoot)).sort(),['actual.png','comparison.json','reference.png'])
      assert.equal(JSON.parse(await readFile(join(diagnosticsRoot,'comparison.json'))).frame,0)
    }
  }
  // An actual overflow/replan changes the encoding parameters and cannot reuse
  // a video encoded for the old budget, even though its source frames match.
  assert.ok(!rendered.videos.has(clipVideoStreamKey({...parts[1],videoBitrate:4000000})))
})

test('failed capture closes every streaming encoder before removing its temporary files',{timeout:60000},async t=>{
  const {root,plan,parts,renderer}=await fixture(t),capture=renderer.capture
  let closed=false
  renderer.capture=async frame=>{if(frame===4)throw new Error('capture fixture failure');return capture(frame)}
  renderer.close=async()=>{closed=true}
  await assert.rejects(renderClip({plan,plannedFiles:parts,tempRoot:root,renderer}),/capture fixture failure/)
  assert.equal(closed,true)
  assert.ok(!(await readdir(root)).some(name=>name.startsWith('clip-')))
})

test('failed independent replay stops capture and closes encoders before removing reference files',{timeout:60000},async t=>{
  const {root,plan,parts,renderer}=await fixture(t),capture=renderer.capture
  let closed=false,captures=0
  renderer.capture=async frame=>{captures++;return capture(frame)}
  renderer.reference=async()=>{throw new Error('independent replay fixture failure')}
  renderer.close=async()=>{closed=true}
  await assert.rejects(renderClip({plan,plannedFiles:parts,tempRoot:root,renderer}),/independent replay fixture failure/)
  assert.equal(closed,true)
  assert.ok(captures<plan.frames)
  assert.ok(!(await readdir(root)).some(name=>name.startsWith('clip-')))
})
