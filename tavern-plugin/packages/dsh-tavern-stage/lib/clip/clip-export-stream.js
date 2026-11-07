import {join} from 'node:path'
import {rm} from 'node:fs/promises'
import {clipProcess,clipWrite} from './clip-export-process.js'

const base=['-hide_banner','-nostdin','-y','-filter_threads','2','-progress','pipe:1','-stats_period','0.5']
export const clipVideoStreamKey=plan=>JSON.stringify([plan.preset,plan.startFrame || 0,plan.frames,plan.fps,plan.resolution.width,plan.resolution.height,plan.videoBitrate])

// Only video is knowable during capture. Audio still comes from the completed
// replay graph, and every muxed file goes through the normal size/sync/SSIM gates.
// These unpublished videos need no faststart relocation; the final mux adds it.
export function createClipVideoStreams({plans,temporary,fps,encoder,ffmpeg,signal,onProgress,onDiagnostic=()=>{}}) {
  const abort=new AbortController(),ownedSignal=AbortSignal.any([abort.signal,...(signal?[signal]:[])])
  const videos=new Map(),tasks=[],rows=plans.map((plan,index)=>({plan,index,frames:0,state:'waiting',pass1Frames:0,pass2Frames:0}));let failure,finalizing=false,closing
  const mark=(row,state)=>{row.state=state;onDiagnostic({stage:`stream-${row.index}:${state}`,worker:row.index,preset:row.plan.preset,startFrame:row.plan.startFrame || 0,process:row.worker?.diagnostics()})}
  const progress=(row,pass,frame)=>{
    row[pass+'Frames']=frame
    if(finalizing)onProgress({phase:'encode',step:'stream-'+pass,frame,totalFrames:row.plan.frames})
  }
  function start(row) {
    const {plan,index}=row,twoPass=plan.preset==='discord'
    const source=join(temporary,`stream-${index}.mkv`),path=join(temporary,`stream-${index}.mp4`),passlog=join(temporary,`stream-${index}-x264`)
    const selected=twoPass?{name:'libx264',args:['-preset','veryfast']}:encoder
    const video=['-map','0:v:0','-vf',`scale=${plan.resolution.width}:${plan.resolution.height}:flags=lanczos:out_range=tv`,'-c:v',selected.name,...selected.args,'-threads','4','-b:v',String(plan.videoBitrate),'-pix_fmt','yuv420p','-color_range','tv','-r',String(fps),'-fps_mode','cfr','-frames:v',String(plan.frames),'-an']
    row.state=twoPass?'pass1':'video'
    row.process=clipProcess(ffmpeg,[...base,'-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0',...video,
      ...(twoPass?['-passlogfile',passlog,'-pass','1','-f','null','-','-map','0:v:0','-c:v','copy','-frames:v',String(plan.frames),source]:[path])],
    {signal:ownedSignal,input:true,timeoutMs:0,onProgress:frame=>progress(row,'pass1',frame)})
    row.worker=row.process;mark(row,row.state)
    const task=(async()=>{
      await row.process.done
      mark(row,'pass1-closed')
      if(twoPass){
        row.worker=clipProcess(ffmpeg,[...base,'-i',source,...video,'-passlogfile',passlog,'-pass','2',path],
          {signal:ownedSignal,timeoutMs:0,onProgress:frame=>progress(row,'pass2',frame)})
        mark(row,'pass2')
        await row.worker.done
        mark(row,'source-remove')
        await rm(source,{force:true})
      }
      mark(row,'done');videos.set(clipVideoStreamKey(plan),{path,encoder:selected})
    })()
    row.task=task;tasks.push(task);void task.catch(error=>{failure ||= error;mark(row,'failed')})
  }
  return {
    async write(frame,bytes) {
      if(failure)throw failure
      await Promise.all(rows.filter(row=>frame>=(row.plan.startFrame || 0)&&frame<(row.plan.startFrame || 0)+row.plan.frames).map(async row=>{
        if(!row.process)start(row)
        const process=row.process
        await clipWrite(process,bytes)
        row.frames++;process.touch()
        if(row.frames===row.plan.frames)process.child.stdin.end()
      }))
    },
    metrics:()=>rows.map(({plan,index,frames,state,pass1Frames,pass2Frames,worker,process})=>({worker:index,preset:plan.preset,startFrame:plan.startFrame || 0,frames,state,pass1Frames,pass2Frames,process:worker?.diagnostics(),input:process?.diagnostics().stdin})),
    async finish() {finalizing=true;await Promise.all(rows.map(async row=>{onDiagnostic({stage:`stream-${row.index}:finish`,status:'start',worker:row.index,process:row.worker?.diagnostics()});await row.task;onDiagnostic({stage:`stream-${row.index}:finish`,status:'done',worker:row.index,process:row.worker?.diagnostics()})}));if(failure)throw failure;return videos},
    close:()=>closing ||= (async()=>{abort.abort(new Error('Streaming video capture closed'));await Promise.allSettled(tasks)})()
  }
}
