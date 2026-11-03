import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,copyFile,appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'
import sharp from 'sharp'
import {createClipExport} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export.js'
import {renderClip} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-encode.js'
import {clipVideoStreamKey} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-stream.js'
import {clipRun} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-process.js'

// Opt-in: 6394 frames / 213 seconds of content, without a slot. Producer pacing
// keeps several workers active; production SSIM/audio gates are not replaced here.
test('long paced multi-group capture drains and closes all workers after capture.done',{skip:process.env.DSH_CLIP_LONG!=='1',timeout:170000},async t=>{
  const root=await mkdtemp(join(process.env.DSH_CLIP_TEST_TEMP || tmpdir(),'clip-long-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const counts=[1252,1213,1181,948,1330,470],frames=counts.reduce((a,b)=>a+b,0),width=1920,height=1080
  const pixels=Buffer.alloc(width*height*3)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*3;pixels[p]=(x*13+y*7)%256;pixels[p+1]=(x+y*3)%256;pixels[p+2]=(x*3+y)%256}
  const png=await sharp(pixels,{raw:{width,height,channels:3}}).png().toBuffer()
  const jpeg=await sharp(png).jpeg({quality:95,chromaSubsampling:'4:2:0'}).toBuffer()
  if(process.env.DSH_CLIP_LONG_LOG)await appendFile(process.env.DSH_CLIP_LONG_LOG,JSON.stringify({kind:'fixture',root,frames,jpegBytes:jpeg.length,paceMs:Number(process.env.DSH_CLIP_LONG_PACE_MS || 10)})+'\n')
  const paragraphs=counts.map((count,i)=>({turn:1,para:i+1,text:'Synthetic recorded paragraph '+i,durationMs:Math.floor(count*1000/30)}))
  let referenceFrame=-1,lastProgress,maximumWorkers=0
  const renderer={
    async capture(){await delay(Number(process.env.DSH_CLIP_LONG_PACE_MS || 10));return Buffer.from(jpeg)},
    async reference(frame){while(referenceFrame<frame){await delay(6);referenceFrame++}return png},
    async evidence(){return {clock:'virtual',voiceOnsets:[],nonStageRects:[]}},async close(){}
  }
  const service=createClipExport({exportsRoot:join(root,'exports'),tempRoot:join(root,'temp'),checkDisk:async()=>{},
    readSnapshot:async()=>({chatId:'long-fixture',paragraphs}),createRenderer:async()=>({renderer,audio:async()=>[]}),
    render:options=>renderClip({...options,onProgress:value=>{lastProgress=value;const workers=value.capture?.streams || [];maximumWorkers=Math.max(maximumWorkers,workers.filter(row=>['video','pass1','pass2'].includes(row.state)).length);options.onProgress(value)}}),
    encode:({plan,rendered,outputPath,signal,onProgress})=>{
      const task=(async()=>{
        const video=rendered.videos.get(clipVideoStreamKey(plan));assert.ok(video,'every planned video must have finished')
        let decoded=0
        await clipRun('ffmpeg',['-hide_banner','-nostdin','-progress','pipe:1','-stats_period','0.5','-i',video.path,'-map','0:v:0','-an','-fps_mode','passthrough','-f','null','-'],{signal,timeoutMs:0,onProgress:frame=>{decoded=frame;onProgress({phase:'verify',step:'decode',frame,totalFrames:plan.frames})}})
        assert.equal(decoded,plan.frames)
        await copyFile(video.path,outputPath)
        return {file:{frames:plan.frames},verification:{},warnings:[]}
      })()
      task.cleanup=task.catch(()=>{});return task
    }})
  t.after(()=>service.dispose())
  const args={sessionId:'long-fixture',range:{chatId:'long-fixture',from:{turn:1,para:1},to:{turn:1,para:counts.length}},presets:['1080p','discord']}
  const {jobId}=await service.call('startClipExport',args)
  let status,logged=0
  do {
    await delay(1000);status=await service.call('getClipExportJob',{sessionId:args.sessionId,jobId})
    if(process.env.DSH_CLIP_LONG_LOG && ++logged%5===0)await appendFile(process.env.DSH_CLIP_LONG_LOG,JSON.stringify({at:new Date().toISOString(),state:status.state,memory:process.memoryUsage(),progress:status.progress})+'\n')
  }while(!['completed','failed','cancelled'].includes(status.state))
  if(process.env.DSH_CLIP_LONG_LOG)await appendFile(process.env.DSH_CLIP_LONG_LOG,JSON.stringify({at:new Date().toISOString(),state:status.state,error:status.error,timings:status.timings,maximumWorkers,lastProgress})+'\n')
  const diagnostic=status.state==='completed'?'':await readFile(join(root,'temp',`clip-${jobId}.error.log`),'utf8').catch(()=>JSON.stringify(status))
  assert.equal(status.state,'completed',diagnostic)
  assert.equal(status.result.files[0].frames,frames)
  assert.equal(status.result.files.length,7)
  assert.ok(maximumWorkers>=3,'exercise overlapping encoders')
})
