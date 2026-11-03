import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CLIP_MAX_BYTES, clipRange, planClipExport, planClipExportBatch, verifyClipProbe } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/clip-export.js'
import { createClipExport } from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export.js'
import { clipAudioInputs, clipVideoWindow, encodeClip, renderClip, verifyDecodedAudio } from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-encode.js'
import { clipRun, clipProcess } from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-process.js'

const paragraphs = durations => durations.map((durationMs,i) => ({turn:i < 2 ? 4 : 5,para:i < 2 ? i + 1 : i - 1,text:'Host paragraph '+i,durationMs,missingVoiceCount:i === 1 ? 1 : 0}))
const rangeFor = rows => ({chatId:'chat-fixture',from:{turn:rows[0].turn,para:rows[0].para},to:{turn:rows.at(-1).turn,para:rows.at(-1).para}})

test('host coordinate ranges include both ends, span rounds, and reject missing/reversed boundaries', () => {
  const rows = paragraphs([1000,1000,1000])
  assert.equal(clipRange(rows,rangeFor(rows)).length,3)
  assert.throws(() => clipRange(rows,{...rangeFor(rows),to:{turn:9,para:1}}),/重新选择/)
  assert.throws(() => clipRange(rows,{...rangeFor(rows),from:rangeFor(rows).to,to:rangeFor(rows).from}),/重新选择/)
})

test('Discord predicts normal 1080p, lower 1080p, 720p, then the fewest paragraph groups', () => {
  const short = paragraphs([5000,5000]), medium = paragraphs([15000,15000]), long = paragraphs([20000,20000,20000,20000])
  assert.equal(planClipExport(short,rangeFor(short),'discord').plannedFiles[0].resolution.height,1080)
  assert.equal(planClipExport(medium,rangeFor(medium),'discord').plannedFiles[0].resolution.height,720)
  assert.equal(planClipExport(paragraphs([5000]),rangeFor(paragraphs([5000])),'discord').step,1)
  assert.equal(planClipExport(short,rangeFor(short),'discord').step,2)
  assert.equal(planClipExport(medium,rangeFor(medium),'discord').step,3)
  const result = planClipExport(long,rangeFor(long),'discord')
  assert.equal(result.plannedFiles.length,2);assert.equal(result.step,4)
  assert.deepEqual(result.plannedFiles.map(row => [row.from,row.to]),[[{turn:4,para:1},{turn:4,para:2}],[{turn:5,para:1},{turn:5,para:2}]])
  assert.ok(result.plannedFiles.every(row => row.estBytes <= CLIP_MAX_BYTES && row.fps === 30 && row.resolution.height >= 720))
  assert.equal(result.missingVoiceCount,1)
  const tooLong = paragraphs([60000]),single=planClipExport(tooLong,rangeFor(tooLong),'discord').plannedFiles[0]
  assert.equal(single.resolution.height,720);assert.equal(single.belowQualityFloor,true);assert.equal(single.sourceFrames,1800);assert.ok(single.videoBitrate<1_200_000);assert.ok(single.estBytes<=CLIP_MAX_BYTES)
  const fraction = paragraphs([1001]);assert.equal(planClipExport(fraction,rangeFor(fraction)).plannedFiles[0].frames,31)
})

test('audio filter uses sample-accurate replay delays and original-file trim, and never a synthesis input', () => {
  const value = clipAudioInputs([{path:'recorded.wav',startFrame:2,durationMs:700,sourceStartMs:40,gain:0.5}],30)
  assert.deepEqual(value.args.slice(0,2),['-i','recorded.wav'])
  assert.match(value.filter,/atrim=start=0\.04:duration=0\.7/)
  assert.match(value.filter,/adelay=3200S:all=1/)
  assert.match(value.filter,/amix=inputs=2/)
})

const probe = {streams:[{codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width:1920,height:1080,r_frame_rate:'30/1',avg_frame_rate:'30/1',nb_read_frames:'30',duration:'1',start_time:'0'},
  {codec_type:'audio',codec_name:'aac',start_time:'0',duration:'1'}],format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2'}}

test('output gate rejects oversized, dropped-frame, downgraded and unsynchronised files', () => {
  const rows = paragraphs([1000]), plan = planClipExport(rows,rangeFor(rows),'discord').plannedFiles[0]
  assert.equal(verifyClipProbe(probe,plan,50000).frames,30)
  assert.throws(() => verifyClipProbe(probe,plan,CLIP_MAX_BYTES + 1),/8 MB/)
  for (const patch of [{nb_read_frames:'29'},{height:480},{avg_frame_rate:'25/1'},{start_time:'0.05'}]) {
    const value = structuredClone(probe);Object.assign(value.streams[0],patch)
    assert.throws(() => verifyClipProbe(value,plan,50000))
  }
})

async function waitJob(service,jobId) {
  // Some callers run real ffmpeg passes; a one-second iteration count is not a job-completion contract.
  const deadline = performance.now() + 30000
  while (performance.now() < deadline) {
    const value = await service.call('getClipExportJob',{sessionId:'session',jobId})
    if (['completed','failed','cancelled'].includes(value.state)) return value
    await new Promise(resolve => setTimeout(resolve,10))
  }
  throw new Error('Fixture job did not finish')
}

test('job ownership, immutable public status, serial renderer, folder action and cancellation cleanup', async t => {
  const root = await mkdtemp(join(tmpdir(),'clip-jobs-'));t.after(() => rm(root,{recursive:true,force:true}))
  const rows = paragraphs([1000]), range = rangeFor(rows), opened = []
  let block = false, active = 0, maximum = 0
  const service = createClipExport({exportsRoot:root,tempRoot:root,checkDisk:async () => {},readSnapshot:async () => ({chatId:range.chatId,paragraphs:rows}),
    openFolder:async path => opened.push(path),createRenderer:async () => ({renderer:{},audio:[]}),render:async()=>({close:async()=>{}}),
    encode:async ({signal,outputPath,onProgress}) => {
      active++;maximum=Math.max(maximum,active)
      try {
        await writeFile(outputPath,'fixture');onProgress({phase:'render',frame:1,totalFrames:30})
        if (block) await new Promise((resolve,reject) => {if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',() => reject(signal.reason),{once:true})})
        return {file:{path:outputPath,bytes:7},verification:{fixture:true},warnings:[]}
      } finally {active--}
    }})
  t.after(() => service.dispose())
  assert.equal((await service.call('getClipExportParagraphs',{sessionId:'session',chatId:range.chatId})).paragraphs[0].durationMs,undefined)
  const {jobId} = await service.call('startClipExport',{sessionId:'session',range})
  await assert.rejects(() => service.call('getClipExportJob',{sessionId:'other',jobId}),/找不到/)
  const value = await waitJob(service,jobId);assert.equal(value.state,'completed')
  value.result.files[0].bytes = -1
  assert.equal((await service.call('getClipExportJob',{sessionId:'session',jobId})).result.files[0].bytes,7)
  await service.call('openClipExportFolder',{sessionId:'session',jobId});assert.deepEqual(opened,[value.result.folder])
  block = true
  assert.deepEqual(service.activity(),{busy:false,activeJobs:0})
  const next = await service.call('startClipExport',{sessionId:'session',range})
  assert.deepEqual(service.activity(),{busy:true,activeJobs:1})
  await service.call('cancelClipExport',{sessionId:'session',jobId:next.jobId})
  assert.equal((await waitJob(service,next.jobId)).state,'cancelled');assert.equal(maximum,1)
  assert.deepEqual(service.activity(),{busy:false,activeJobs:0})
  const receipt=JSON.parse(await readFile(join(root,`clip-${next.jobId}.json`),'utf8'))
  assert.equal(receipt.state,'cancelled')
  assert.ok(receipt.timings.finishedAt)
  assert.ok(!(await readdir(root)).some(name=>name.endsWith('.tmp')))
})

test('preparation deadlines fail visibly, release the queue, and close late renderers', async t => {
  const root=await mkdtemp(join(tmpdir(),'clip-prepare-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const rows=paragraphs([1000]),range=rangeFor(rows)
  let finish,closed=0,calls=0
  const service=createClipExport({exportsRoot:root,tempRoot:root,prepareTimeoutMs:30,checkDisk:async()=>{},
    readSnapshot:async()=>({chatId:range.chatId,paragraphs:rows}),openFolder:async()=>{},
    createRenderer:async({onProgress})=>{calls++;onProgress({phase:'prepare',step:'resources',frame:4,totalFrames:6});if(calls===1)return new Promise(resolve=>{finish=resolve});if(calls===3)throw new Error('Executable missing: C:/private/browser.exe');return {renderer:{close:async()=>{}},audio:[]}},
    render:async()=>({close:async()=>{}}),encode:async()=>({file:{bytes:1},verification:{},warnings:[]})})
  t.after(()=>service.dispose())
  const first=await service.call('startClipExport',{sessionId:'session',range})
  const second=await service.call('startClipExport',{sessionId:'session',range})
  const failed=await waitJob(service,first.jobId)
  assert.equal(failed.state,'failed');assert.match(failed.error,/画面还没准备好.*重试/)
  assert.equal(failed.progress.step,'resources')
  assert.match(await readFile(join(root,`clip-${first.jobId}.error.log`),'utf8'),/resources/)
  assert.equal((await waitJob(service,second.jobId)).state,'completed')
  finish({renderer:{close:async()=>{closed++}},audio:[]})
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(closed,1)
  const third=await service.call('startClipExport',{sessionId:'session',range})
  const rejected=await waitJob(service,third.jobId)
  assert.match(rejected.error,/画面还没准备好.*重试/);assert.ok(!rejected.error.includes('C:/private'))
})

test('unavailable diagnostic storage cannot leave a failed preparation running', async t => {
  const root=await mkdtemp(join(tmpdir(),'clip-diagnostic-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const unavailable=join(root,'not-a-directory');await writeFile(unavailable,'fixture')
  const rows=paragraphs([1000]),range=rangeFor(rows)
  const service=createClipExport({exportsRoot:root,tempRoot:unavailable,checkDisk:async()=>{},
    readSnapshot:async()=>({chatId:range.chatId,paragraphs:rows}),
    createRenderer:async()=>{throw new Error('fixture preparation failure')}})
  t.after(()=>service.dispose())
  const {jobId}=await service.call('startClipExport',{sessionId:'session',range})
  assert.equal((await waitJob(service,jobId)).state,'failed')
  assert.deepEqual(await readdir(join(root,'chat-chat-fixture')),[])
})

test('cancellation interrupts a pending preparation without waiting for its deadline', async t => {
  const root=await mkdtemp(join(tmpdir(),'clip-prepare-cancel-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const rows=paragraphs([1000]),range=rangeFor(rows)
  let started
  const ready=new Promise(resolve=>{started=resolve})
  const service=createClipExport({exportsRoot:root,tempRoot:root,checkDisk:async()=>{},
    readSnapshot:async()=>({chatId:range.chatId,paragraphs:rows}),openFolder:async()=>{},
    createRenderer:()=>{started();return new Promise(()=>{})}})
  t.after(()=>service.dispose())
  const {jobId}=await service.call('startClipExport',{sessionId:'session',range})
  await ready
  await service.call('cancelClipExport',{sessionId:'session',jobId})
  const job=await waitJob(service,jobId)
  assert.equal(job.state,'cancelled');assert.equal(job.error,null)
})

test('cancelled jobs stay active until owned render and encode cleanup settles',async t=>{
  for(const phase of ['render','encode'])await t.test(phase,async t=>{
    const root=await mkdtemp(join(tmpdir(),'clip-owned-cleanup-'));t.after(()=>rm(root,{recursive:true,force:true}))
    const rows=paragraphs([1000]),range=rangeFor(rows)
    let notifyStarted,notifyCleanup,release
    const started=new Promise(resolve=>{notifyStarted=resolve}),observed=new Promise(resolve=>{notifyCleanup=resolve}),gate=new Promise(resolve=>{release=resolve})
    const operation=({signal})=>{
      const task=new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{void gate.then(()=>reject(signal.reason))},{once:true});notifyStarted()})
      const cleanup=task.catch(()=>{})
      Object.defineProperty(task,'cleanup',{get(){notifyCleanup('cleanup');return cleanup}})
      return task
    }
    const service=createClipExport({exportsRoot:root,tempRoot:root,checkDisk:async()=>{},readSnapshot:async()=>({chatId:range.chatId,paragraphs:rows}),
      createRenderer:async()=>({renderer:{close:async()=>{}},audio:[]}),
      render:phase==='render'?operation:async()=>({close:async()=>{}}),encode:operation})
    t.after(()=>service.dispose())
    const {jobId}=await service.call('startClipExport',{sessionId:'session',range});await started
    await service.call('cancelClipExport',{sessionId:'session',jobId})
    try{
      assert.equal(await Promise.race([observed,waitJob(service,jobId)]),'cleanup')
      assert.equal((await service.call('getClipExportJob',{sessionId:'session',jobId})).state,'running')
      assert.deepEqual(service.activity(),{busy:true,activeJobs:1})
    }finally{release()}
    assert.equal((await waitJob(service,jobId)).state,'cancelled')
    assert.deepEqual(service.activity(),{busy:false,activeJobs:0})
  })
})

test('real ffmpeg streams 720p30, two-pass H264/AAC, faststart and SSIM; this is an encoder fixture, not a stage scenario',{timeout:120000},async t => {
  const root = await mkdtemp(join(process.env.DSH_CLIP_TEST_TEMP || tmpdir(),'clip-encode-'))
  t.after(() => rm(root,{recursive:true,force:true}))
  const pngPath = join(root,'fixture.png')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=0x305040:s=1280x720','-frames:v','1',pngPath])
  const voicePath = join(root,'voice.wav')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','sine=frequency=731:sample_rate=48000:duration=0.5','-c:a','pcm_s16le',voicePath])
  const png = await readFile(pngPath), stages = []
  const plan = {resolution:{width:1280,height:720},frames:30,durationMs:1000,fps:30,videoBitrate:1_500_000}
  let closed = false
  const result = await encodeClip({plan,outputPath:join(root,'fixture.mp4'),tempRoot:root,
    renderer:{capture:async () => png,reference:async () => png,evidence:async () => ({clock:'virtual',nonStageRects:[],voiceOnsets:[{id:'line-1',audioFrame:6,revealFrame:6}]}),close:async () => {closed=true}},
    audio:[{id:'line-1',kind:'voice',path:voicePath,startFrame:6,durationMs:500}],
    onProgress:value => stages.push(value.phase)})
  assert.equal(result.file.frames,30);assert.ok(result.file.bytes <= CLIP_MAX_BYTES);assert.equal(result.file.height,720)
  assert.ok(result.verification.samples.every(row => row.ssim >= 0.95));assert.ok(closed)
  assert.deepEqual([...new Set(stages)],['render','encode','verify'])
  const pcmPath = join(root,'decoded.f32')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-i',result.file.path,'-vn','-ac','1','-ar','48000','-f','f32le',pcmPath])
  const bytes = await readFile(pcmPath)
  let onset = -1
  for(let offset = 0; offset < bytes.length; offset += 4) if(Math.abs(bytes.readFloatLE(offset)) > 0.01) {onset=offset / 4;break}
  assert.ok(Math.abs(onset / 1600 - 6) <= 1,`Decoded voice onset ${onset / 1600} differs from reveal frame 6`)
  const silent = await encodeClip({plan,outputPath:join(root,'silent.mp4'),tempRoot:root,
    renderer:{capture:async () => png,reference:async () => png,evidence:async () => ({clock:'virtual',nonStageRects:[],voiceOnsets:[]}),close:async () => {}}})
  assert.equal(silent.file.frames,30,'Missing voices must produce valid silent AAC, never NaN loudness')
})

test('renderer failure cancels its encoder, closes the renderer and removes unpublished output',{timeout:20000},async t => {
  const root = await mkdtemp(join(process.env.DSH_CLIP_TEST_TEMP || tmpdir(),'clip-failure-'))
  t.after(() => rm(root,{recursive:true,force:true}))
  let closed = false
  await assert.rejects(() => encodeClip({plan:{resolution:{width:1280,height:720},frames:30,durationMs:1000,fps:30,videoBitrate:1_500_000},
    outputPath:join(root,'failed.mp4'),tempRoot:root,renderer:{capture:async () => {throw new Error('fixture renderer failed')},close:async () => {closed=true}}}),/fixture renderer failed/)
  assert.ok(closed)
  const {readdir} = await import('node:fs/promises')
  assert.deepEqual(await readdir(root),[])
})

test('measured overflow splits at paragraphs without changing resolution or recapturing',async t=>{
  const root=await mkdtemp(join(process.env.DSH_CLIP_TEST_TEMP || tmpdir(),'clip-replan-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const rows=paragraphs([5000,5000]),attempts=[]
  let renderCount=0
  const service=createClipExport({exportsRoot:root,tempRoot:root,checkDisk:async()=>{},readSnapshot:async()=>({chatId:'chat-fixture',paragraphs:rows}),openFolder:async()=>{},
    createRenderer:async()=>({renderer:{},audio:[]}),render:async()=>{renderCount++;return {close:async()=>{}}},encode:async({plan,outputPath})=>{
      attempts.push(structuredClone(plan))
      if(plan.from.para!==plan.to.para)throw Object.assign(new Error('overflow'),{code:'CLIP_SIZE_REPLAN',videoBitrate:plan.resolution.height===1080?2000000:1000000})
      return {file:{path:outputPath,bytes:100},verification:{},warnings:[]}
    }})
  t.after(()=>service.dispose())
  const {jobId}=await service.call('startClipExport',{sessionId:'session',range:rangeFor(rows),preset:'discord'}),job=await waitJob(service,jobId)
  assert.equal(job.state,'completed',job.error);assert.equal(job.result.files.length,2)
  assert.equal(renderCount,1)
  assert.deepEqual(attempts.map(row=>[row.from.para,row.to.para,row.resolution.height]),[[1,2,1080],[1,1,1080],[2,2,1080]])
})


test('Discord encodes planned paragraph groups directly from one master',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-budget-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const rows=paragraphs([20000,20000,20000,20000]),range=rangeFor(rows),attempts=[]
  const expected=planClipExport(rows,range,'discord').plannedFiles
  let renders=0
  const service=createClipExport({exportsRoot:root,tempRoot:root,checkDisk:async()=>{},readSnapshot:async()=>({chatId:range.chatId,paragraphs:rows}),openFolder:async()=>{},
    createRenderer:async()=>({renderer:{},audio:[]}),render:async()=>{renders++;return {close:async()=>{}}},encode:async({plan})=>{
      attempts.push(structuredClone(plan));return {file:{bytes:100},verification:{},warnings:[]}
    }})
  t.after(()=>service.dispose())
  const {jobId}=await service.call('startClipExport',{sessionId:'session',range,preset:'discord'})
  assert.equal((await waitJob(service,jobId)).state,'completed')
  assert.deepEqual(attempts,expected,'Do not merge groups into an oversized full-round trial')
  assert.equal(renders,1)
})

test('Discord real encoding starts at the predicted bitrate, including a long indivisible paragraph',{timeout:120000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-predicted-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const intermediate=join(root,'stage.mkv'),mixed=join(root,'mix.wav'),reference=join(root,'reference.png')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=0x305040:s=1280x720:r=30:d=60','-c:v','libx264','-preset','ultrafast','-crf','0',intermediate])
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','60','-c:a','pcm_f32le',mixed])
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-i',intermediate,'-frames:v','1',reference])
  const rendered={temporary:root,intermediate,mixed,plan:{fps:30,frames:1800},references:[{frame:0,path:reference}],audio:[],evidence:{clock:'virtual',voiceOnsets:[]}}
  for(const duration of [10000,30000,60000]) {
    const rows=paragraphs([duration]),plan=planClipExport(rows,rangeFor(rows),'discord').plannedFiles[0]
    const result=await encodeClip({plan,rendered,outputPath:join(root,duration+'.mp4')})
    assert.equal(result.verification.attempts.length,1)
    assert.equal(result.file.videoBitrate,plan.videoBitrate)
    assert.equal(result.file.height,plan.resolution.height)
    assert.equal(result.file.frames,plan.frames)
    assert.equal(result.file.belowQualityFloor,plan.belowQualityFloor)
    assert.ok(result.file.bytes<=CLIP_MAX_BYTES)
  }
})

test('presets default to uncapped 1080p, quality caps native resolution, GIF rejects long selections',()=>{
  const rows=paragraphs([15000,15700]),range=rangeFor(rows)
  const standard=planClipExport(rows,range)
  assert.equal(standard.preset,'1080p');assert.equal(standard.plannedFiles.length,1)
  assert.equal(standard.plannedFiles[0].maxBytes,null);assert.equal(standard.plannedFiles[0].fps,30)
  assert.ok(standard.plannedFiles[0].estBytes>CLIP_MAX_BYTES)
  const quality=planClipExport(rows,range,'quality',{width:3840,height:2160})
  assert.deepEqual(quality.plannedFiles[0].resolution,{width:2560,height:1440})
  assert.equal(quality.plannedFiles[0].fps,60);assert.equal(quality.plannedFiles.length,1)
  assert.throws(()=>planClipExport(rows,range,'gif'),/15/)
  assert.throws(()=>planClipExport(rows,range,'unknown'))
  const gif=planClipExport(rows.slice(0,1),rangeFor(rows.slice(0,1)),'gif')
  assert.equal(gif.maxDurationMs,15000);assert.equal(gif.plannedFiles[0].audioBitrate,0)
  const long=paragraphs([30000,5000]),discord=planClipExport(long,rangeFor(long),'discord')
  assert.deepEqual(discord.plannedFiles.map(row=>row.resolution.height),[720])
  assert.deepEqual(discord.plannedFiles.map(row=>row.startFrame),[0])
  assert.ok(discord.plannedFiles.every(row=>row.estBytes<=CLIP_MAX_BYTES))
  assert.ok(discord.plannedFiles[0].videoBitrate<2_500_000)
  const batch=planClipExportBatch(rows,range,['quality','1080p','discord','gif'])
  assert.equal(batch.renderPlan.frames,1842)
  assert.deepEqual(batch.plannedFiles.map(row=>row.preset),['quality','1080p','discord','gif'])
  assert.equal(batch.plannedFiles.at(-1).durationMs,15000)
  assert.deepEqual(batch.plannedFiles.at(-1).to,range.from)
})

test('one deterministic master feeds all four real encoders and preserves authored audio gain',{timeout:120000},async t=>{
  const root=await mkdtemp(join(process.env.DSH_CLIP_TEST_TEMP || tmpdir(),'clip-presets-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const pngPath=join(root,'stage.png'),voicePath=join(root,'voice.wav')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=0x305040:s=1920x1080','-frames:v','1',pngPath])
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','sine=frequency=731:sample_rate=48000:duration=0.5','-c:a','pcm_s16le',voicePath])
  const png=await readFile(pngPath),rows=paragraphs([1000]),range=rangeFor(rows)
  let captures=0,closed=false
  const rendered=await renderClip({plan:planClipExportBatch(rows,range,['quality','1080p','discord','gif']).renderPlan,tempRoot:root,referenceFrames:[0,30,56,58],
    renderer:{capture:async()=>{captures++;return png},reference:async()=>png,evidence:async()=>({clock:'virtual',nonStageRects:[],voiceOnsets:[{id:'voice',audioFrame:12,revealFrame:12}]}),close:async()=>{closed=true}},
    audio:[{id:'voice',kind:'voice',path:voicePath,startFrame:12,durationMs:500,gain:2}]})
  t.after(()=>rendered.close())
  assert.equal(captures,60)
  for(const preset of ['quality','1080p','discord','gif']) {
    const plan=planClipExport(rows,range,preset).plannedFiles[0]
    const result=await encodeClip({plan,rendered,outputPath:join(root,preset+'.'+plan.format)})
    assert.equal(result.file.fps,plan.fps);assert.equal(result.file.frames,plan.frames)
    assert.equal(result.file.width,plan.resolution.width)
    assert.equal(captures,60);assert.equal(closed,false)
    if(preset==='gif')assert.equal(result.verification.voiceOnsets.length,0)
    if(preset==='1080p') {
      const pcm=join(root,'gain.f32')
      await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-i',result.file.path,'-vn','-ac','1','-ar','48000','-f','f32le',pcm])
      const data=await readFile(pcm);let peak=0
      for(let i=0;i<data.length;i+=4)peak=Math.max(peak,Math.abs(data.readFloatLE(i)))
      assert.ok(peak>0.23&&peak<0.28,`Stored gain should yield 0.25 peak without loudnorm, got ${peak}`)
    }
  }
  await rendered.close();assert.equal(closed,true)
})


test('ordinary JPEG master encodes as limited-range yuv420p H264 with AAC',{timeout:60000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-jpeg-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const pngPath=join(root,'stage.png'),jpegPath=join(root,'stage.jpg');
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=0x305040:s=1920x1080','-frames:v','1',pngPath]);
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-i',pngPath,'-frames:v','1','-q:v','2',jpegPath]);
  const png=await readFile(pngPath),jpeg=await readFile(jpegPath),rows=paragraphs([1000]),range=rangeFor(rows),estimate=planClipExport(rows,range,'1080p');
  const rendered=await renderClip({plan:estimate.renderPlan,tempRoot:root,referenceFrames:[0,29],audio:[],
    renderer:{capture:async()=>jpeg,reference:async()=>png,evidence:async()=>({clock:'virtual',nonStageRects:[],voiceOnsets:[]}),close:async()=>{}}});
  t.after(()=>rendered.close());
  const result=await encodeClip({plan:estimate.plannedFiles[0],rendered,outputPath:join(root,'clip.mp4')});
  assert.equal(result.file.frames,30);
  const {stdout}=await clipRun('ffprobe',['-v','error','-show_streams','-of','json',result.file.path]);
  const video=JSON.parse(stdout).streams.find(stream=>stream.codec_type==='video');
  assert.equal(video.pix_fmt,'yuv420p');assert.equal(video.color_range,'tv');
});

test('long capture streams one lossless master without losing a frame',{timeout:60000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-chunks-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const pngPath=join(root,'frame.png')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=0x305040:s=320x180','-frames:v','1',pngPath])
  const markPath=join(root,'mark.png')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=white:s=320x180','-frames:v','1',markPath])
  const png=await readFile(pngPath),mark=await readFile(markPath),seen=[],progress=[],frame=n=>n===300?mark:png
  const master=await renderClip({plan:{fps:60,frames:360},tempRoot:root,referenceFrames:[0,300,330,358],onProgress:value=>progress.push(value),renderer:{capture:async n=>{seen.push(n);return frame(n)},reference:async n=>frame(n),evidence:async()=>({clock:'virtual',nonStageRects:[],voiceOnsets:[]}),close:async()=>{}}})
  t.after(()=>master.close())
  const {stdout}=await clipRun('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',master.intermediate])
  const probe=JSON.parse(stdout)
  assert.equal(Number(probe.streams[0].nb_read_frames),360)
  assert.ok(Math.abs(Number(probe.format.duration)-6)<0.002) // Matroska timestamps use milliseconds; output PTS are reset from frame indices.
  assert.deepEqual(seen,Array.from({length:360},(_,i)=>i))
  const finished=progress.findLast(row=>row.step==='master')
  assert.equal(finished.frame,360)
  assert.equal(finished.capture.master.bytes,png.length*359+mark.length)
  assert.ok(finished.capture.master.finishMs>=0)
  const finalization=progress.at(-1).capture.finalization
  assert.equal(finalization.activeAwait,null)
  for(const stage of ['master','reference-task','evidence','mix-script','mix','streams']){
    assert.ok(finalization.milestones.some(row=>row.stage===stage&&row.status==='start'))
    assert.ok(finalization.milestones.some(row=>row.stage===stage&&row.status==='done'))
  }
  const rows=paragraphs([1000]),part=planClipExport(rows,rangeFor(rows)).plannedFiles[0];part.startFrame=150
  const encoded=await encodeClip({plan:part,rendered:master,tempRoot:root,outputPath:join(root,'tail.mp4')})
  assert.equal(encoded.file.frames,30)
  assert.ok(encoded.file.samples[0].ssim>=0.95,'The exact marked frame after an integer-second seek is not skipped')
})


test('long ducking envelopes stay within ffmpeg expression depth and retain their gain steps',{timeout:30000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-gains-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const audioPath=join(root,'source.wav'),output=join(root,'mix.f32'),script=join(root,'mix.filter')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','aevalsrc=0.25:s=48000:d=10','-c:a','pcm_f32le',audioPath])
  const gains=Array.from({length:600},(_,frame)=>({frame,gain:frame%2?0.5:1}))
  const mix=clipAudioInputs([{path:audioPath,startFrame:0,durationMs:10000,gain:1,gains}],600,60)
  await writeFile(script,mix.filter)
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=s=16x16:d=10',...mix.args,'-filter_complex_script',script,'-map','[mix]','-ac','1','-f','f32le',output])
  const pcm=await readFile(output),values=[]
  for(let n=0;n<pcm.length/4;n+=1024)values.push(pcm.readFloatLE(n*4))
  assert.ok(values.some(value=>Math.abs(value-0.25)<0.001))
  assert.ok(values.some(value=>Math.abs(value-0.125)<0.001))
  assert.ok(values.every(value=>value>0.12&&value<0.26))
})


test('a later paragraph validates decoded voice against the matching master-audio slice',{timeout:60000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-audio-slice-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const pngPath=join(root,'frame.png'),voicePath=join(root,'voice.wav')
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=0x305040:s=320x180','-frames:v','1',pngPath])
  await clipRun('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','sine=frequency=731:sample_rate=48000:duration=0.5','-c:a','pcm_s16le',voicePath])
  const png=await readFile(pngPath),rows=paragraphs([1000,1000])
  const rendered=await renderClip({plan:{fps:60,frames:120},tempRoot:root,referenceFrames:[60,90,118],
    renderer:{capture:async()=>png,reference:async()=>png,evidence:async()=>({clock:'virtual',nonStageRects:[],voiceOnsets:[{id:'later',audioFrame:72,revealFrame:72}]}),close:async()=>{}},
    audio:[{id:'later',kind:'voice',path:voicePath,startFrame:72,durationMs:500,gain:1}]})
  t.after(()=>rendered.close())
  const plan=planClipExport(rows.slice(1),rangeFor(rows.slice(1))).plannedFiles[0];plan.startFrame=30
  const result=await encodeClip({plan,rendered,tempRoot:root,outputPath:join(root,'part-02.mp4')})
  assert.equal(result.verification.voiceOnsets.length,1)
  assert.equal(result.verification.voiceOnsets[0].audioFrame,6)
  assert.ok(result.verification.voiceOnsets[0].correlation>=0.85)
})

test('video windows seek whole seconds and retain the exact output-frame grid',()=>{
  for(const renderFps of [30,60])for(const fps of [15,30,60].filter(fps=>fps<=renderFps))for(const startFrame of [0,1,29,30,31,61,1252,5924]){
    const window=clipVideoWindow({startFrame,frames:30,fps},renderFps)
    assert.equal(window.seekSeconds*renderFps+window.startFrame,startFrame*renderFps/30)
    assert.ok(Number.isInteger(window.seekSeconds)&&window.startFrame>=0&&window.startFrame<renderFps)
    assert.equal(window.endFrame-window.startFrame,30*renderFps/fps)
  }
})

test('late JPEG MP4 and GIF parts keep the exact frame after integer-second input seeking',{timeout:60000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-seek-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const images=[]
  for(const color of ['red','blue']){
    const files={}
    for(const extension of ['png','jpg']){
      const path=join(root,color+'.'+extension)
      await clipRun('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=16x16`,'-frames:v','1',path])
      files[extension]=await readFile(path)
    }
    images.push(files)
  }
  const rendered=await renderClip({plan:{fps:30,frames:91,captureFormat:'jpeg'},tempRoot:root,referenceFrames:[61,75,76,89,90],
    renderer:{capture:async frame=>images[frame%2].jpg,reference:async frame=>images[frame%2].png,evidence:async()=>({clock:'virtual',nonStageRects:[],voiceOnsets:[]}),close:async()=>{}}})
  t.after(()=>rendered.close())
  const rows=paragraphs([1000]),plan=planClipExport(rows,rangeFor(rows),'1080p').plannedFiles[0];plan.startFrame=61
  const video=await encodeClip({plan,rendered,tempRoot:root,outputPath:join(root,'late.mp4')})
  assert.equal(video.file.frames,30);assert.equal(video.file.samples.length,5)
  const gif=await encodeClip({plan:{...plan,preset:'gif',format:'gif',frames:15,fps:15,resolution:{width:720,height:406}},rendered,tempRoot:root,outputPath:join(root,'late.gif')})
  assert.equal(gif.file.frames,15);assert.equal(gif.file.samples.length,3)
})

test('intrinsic cached-voice silence is preserved while additional encoded delay still fails',{timeout:60000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-source-silence-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const voice=join(root,'voice.wav'),mixed=join(root,'mixed.wav'),normal=join(root,'normal.m4a'),delayed=join(root,'delayed.m4a')
  await clipRun('ffmpeg',['-v','error','-y','-f','lavfi','-i','anoisesrc=color=pink:seed=7:sample_rate=48000:duration=1','-af','adelay=150:all=1','-c:a','pcm_f32le',voice])
  await clipRun('ffmpeg',['-v','error','-y','-i',voice,'-af','adelay=400:all=1','-c:a','pcm_f32le',mixed])
  await clipRun('ffmpeg',['-v','error','-y','-i',mixed,'-c:a','aac','-b:a','160k',normal])
  await clipRun('ffmpeg',['-v','error','-y','-i',mixed,'-af','adelay=50:all=1','-c:a','aac','-b:a','160k',delayed])
  const options={ffmpeg:'ffmpeg',mixed,temporary:root,fps:30,audio:[{id:'voice',kind:'voice',path:voice,startFrame:12,durationMs:1150}],evidence:{voiceOnsets:[{id:'voice',audioFrame:12,revealFrame:12}]}}
  const [result]=await verifyDecodedAudio({...options,path:normal})
  assert.equal(result.audioFrame,12)
  assert.ok(result.sourceOnsetMs>=140 && result.sourceOnsetMs<=160)
  assert.ok(result.audibleFrame>=16)
  assert.ok(Math.abs(result.decodedLagSamples)<=16)
  await assert.rejects(verifyDecodedAudio({...options,path:delayed}),/混音|mixed audio/)
})

test('no-progress render fails in Chinese, closes its renderer and releases the queue',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-stall-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const rows=paragraphs([1000]),range=rangeFor(rows);let closed=0
  const service=createClipExport({exportsRoot:root,tempRoot:root,progressTimeoutMs:30,checkDisk:async()=>{},readSnapshot:async()=>({chatId:range.chatId,paragraphs:rows}),
    createRenderer:async()=>({renderer:{close:async()=>{closed++},metrics:()=>({activeFrame:12,activeStep:'screenshot'})},audio:[]}),
    render:async({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})
  t.after(()=>service.dispose())
  const first=await service.call('startClipExport',{sessionId:'session',range})
  const status=await waitJob(service,first.jobId)
  assert.equal(status.state,'failed');assert.match(status.error,/没能做好视频.*重试/)
  assert.equal(status.diagnostic,undefined);assert.doesNotMatch(status.error,/没有进展|screenshot/)
  const receipt=JSON.parse(await readFile(join(root,`clip-${first.jobId}.json`),'utf8'))
  assert.match(receipt.diagnostic.message,/没有进展/)
  assert.deepEqual(receipt.request,{chatId:range.chatId,from:range.from,to:range.to,preset:'1080p'})
  assert.deepEqual(status.progress.capture,{activeFrame:12,activeStep:'screenshot'})
  await service.dispose();assert.equal(closed,1)
  assert.deepEqual(await readdir(join(root,'chat-'+range.chatId)),[])
})

test('streaming encoder inactivity and explicit cancellation leave no child process',async()=>{
  const stalled=clipProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{input:true,idleTimeoutMs:30,timeoutMs:0})
  await assert.rejects(stalled.done,error=>{
    assert.match(error.message,/没有进展/)
    assert.equal(error.processDiagnostics.command,process.execPath)
    assert.ok(error.processDiagnostics.stderr.length<=8000)
    return true
  })
  assert.throws(()=>process.kill(stalled.child.pid,0))
  const controller=new AbortController()
  const cancelled=clipProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{input:true,signal:controller.signal})
  controller.abort(Object.freeze(new DOMException('Cancelled','AbortError')))
  await assert.rejects(cancelled.done,{name:'AbortError'})
  assert.throws(()=>process.kill(cancelled.child.pid,0))
})

test('audio-only progress reports actual output time without requiring video frame records',async()=>{
  const times=[]
  await clipRun(process.execPath,['-e',"process.stdout.write('out_time_us=0\\nout_time_us=1000000\\nout_time_us=2500000\\n')"],{timeoutMs:0,onTime:time=>times.push(time)})
  assert.deepEqual(times,[0,1,2.5])
})

test('master resolution and frame rate follow requested outputs rather than unrequested quality',()=>{
  const rows=paragraphs([1000]),range=rangeFor(rows),native={width:3840,height:2160}
  const standard=planClipExport(rows,range,'1080p',native).renderPlan
  assert.equal(standard.fps,30);assert.equal(standard.frames,30);assert.equal(standard.captureFormat,'jpeg')
  assert.deepEqual(standard.resolution,{width:1920,height:1080})
  const quality=planClipExport(rows,range,'quality',native).renderPlan
  assert.equal(quality.fps,60);assert.equal(quality.captureFormat,'png');assert.equal(quality.resolution.height,1440)
  assert.equal(planClipExportBatch(rows,range,['1080p','discord'],native).renderPlan.fps,30)
  assert.equal(planClipExportBatch(rows,range,['1080p','quality'],native).renderPlan.fps,60)
  assert.deepEqual(planClipExportBatch(rows,range,['gif'],native).renderPlan.resolution,planClipExport(rows,range,'gif',native).renderPlan.resolution)
})

test('the gate rejects missing planned voices even when the encoded file exactly matches a voice-less mix',{timeout:60000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-missing-voice-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const voice=join(root,'voice.wav'),bed=join(root,'bed.wav'),encoded=join(root,'missing.m4a')
  await clipRun('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=731:sample_rate=48000:duration=1','-c:a','pcm_f32le',voice])
  await clipRun('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=221:sample_rate=48000:duration=1','-c:a','pcm_f32le',bed])
  await clipRun('ffmpeg',['-v','error','-y','-i',bed,'-c:a','aac','-b:a','160k',encoded])
  const evidence={durationMs:1000,plannedVoices:[{id:'first'}],voiceOnsets:[{id:'first',audioFrame:0,revealFrame:0}]}
  const options={ffmpeg:'ffmpeg',path:encoded,mixed:bed,background:bed,temporary:root,evidence,fps:30}
  await assert.rejects(verifyDecodedAudio({...options,audio:[]}),/缺少音轨/)
  await assert.rejects(verifyDecodedAudio({...options,audio:[{id:'first',kind:'voice',path:voice,startFrame:0,durationMs:1000}]}),/缺少完整同步原始配音/)
})
