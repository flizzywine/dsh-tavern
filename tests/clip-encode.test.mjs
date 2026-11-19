import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createClipExport } from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export.js'
import { encodeClip } from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-encode.js'
import { clipProcess } from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-process.js'

const paragraphs = durations => durations.map((durationMs,i) => ({turn:i < 2 ? 4 : 5,para:i < 2 ? i + 1 : i - 1,text:'Host paragraph '+i,durationMs,missingVoiceCount:i === 1 ? 1 : 0}))
const rangeFor = rows => ({chatId:'chat-fixture',from:{turn:rows[0].turn,para:rows[0].para},to:{turn:rows.at(-1).turn,para:rows.at(-1).para}})

const probe = {streams:[{codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width:1920,height:1080,r_frame_rate:'30/1',avg_frame_rate:'30/1',nb_read_frames:'30',duration:'1',start_time:'0'},
  {codec_type:'audio',codec_name:'aac',start_time:'0',duration:'1'}],format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2'}}

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
