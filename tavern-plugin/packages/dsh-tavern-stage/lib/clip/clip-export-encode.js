import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { CLIP_AUDIO_BPS, CLIP_FPS, CLIP_MAX_BYTES, clipDiscordSettings, clipQualityFloor, clipVideoBitrate, verifyClipProbe } from '../domain/clip-export.js'
import { clipProcess, clipRun, clipWrite } from './clip-export-process.js'
import { createClipVideoStreams, clipVideoStreamKey } from './clip-export-stream.js'

const baseArgs = ['-hide_banner','-nostdin','-y']
const seconds = ms => String(ms / 1000)
const progressArgs = ['-progress','pipe:1','-stats_period','0.5']

export async function selectClipEncoder(ffmpeg,signal) {
  // Probe an actual encode, not merely the compiled encoder list: drivers may be absent.
  for(const [name,args] of [
    ['h264_nvenc',['-preset','p4']],
    ['h264_qsv',['-preset','veryfast']],
    ['h264_amf',['-quality','speed']]
  ]) {
    try {
      await clipRun(ffmpeg,[...baseArgs,'-v','error','-f','lavfi','-i','color=s=1920x1080:r=30','-frames:v','1','-c:v',name,...args,'-pix_fmt','yuv420p','-f','null','-'],{signal,timeoutMs:10000})
      return {name,args}
    } catch(error){signal?.throwIfAborted()}
  }
  return {name:'libx264',args:['-preset','veryfast']}
}

export function clipAudioInputs(audio, frames, fps = CLIP_FPS) {
  const args = [], filters = [], labels = []
  const duration = frames / fps
  audio.forEach((event, i) => {
    const boundedLoop=event.loop&&Number.isFinite(event.loopEnd)&&event.loopEnd>event.loopStart
    if (event.loop && !boundedLoop) args.push('-stream_loop','-1')
    args.push('-i',event.path)
    const length = Math.min(event.durationMs / 1000, duration - event.startFrame / fps)
    const delaySamples = Math.round(event.startFrame * 48000 / fps)
    const loop=boundedLoop?`aresample=48000,atrim=end=${event.loopEnd},aloop=loop=-1:size=${Math.round((event.loopEnd-event.loopStart)*48000)}:start=${Math.round(event.loopStart*48000)},`:''
    let gain=String(event.gain ?? 1)
    if(event.gains?.length) {
      const points=event.gains.filter((point,index,list)=>!index || Math.abs(point.gain-list[index-1].gain)>0.001)
      // A long BGM ducking envelope exceeds ffmpeg's parser depth if its conditionals form a chain.
      const branch=(from,to)=>{
        if(from===to)return String(from?points[from-1].gain:event.gain ?? 1)
        const mid=Math.floor((from+to)/2),time=Math.max(0,(points[mid].frame-event.startFrame)/fps)
        return `if(lt(t,${time}),${branch(from,mid)},${branch(mid+1,to)})`
      }
      gain=branch(0,points.length)
    }
    filters.push(`[${i + 1}:a]${loop}atrim=start=${seconds(event.sourceStartMs || 0)}:duration=${length},asetpts=PTS-STARTPTS,aresample=48000,volume=${event.gains?.length?"'"+gain+"'":gain}:eval=frame,adelay=${delaySamples}S:all=1[a${i}]`)
    labels.push(`[a${i}]`)
  })
  args.push('-f','lavfi','-t',String(duration),'-i','anullsrc=r=48000:cl=stereo')
  labels.push(`[${audio.length + 1}:a]`)
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,aresample=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[mix]`)
  return {args,filter:filters.join(';')}
}

async function verifyFaststart(path) {
  // Read box headers, not media payloads. An mp4's moov must precede mdat.
  const {open} = await import('node:fs/promises')
  const file = await open(path, 'r')
  try {
    let position = 0
    const header = Buffer.alloc(16), size = (await file.stat()).size
    while (position + 8 <= size) {
      await file.read(header, 0, 16, position)
      let length = header.readUInt32BE(0)
      const type = header.toString('ascii',4,8)
      if (type === 'moov') return true
      if (type === 'mdat') break
      if (length === 1) length = Number(header.readBigUInt64BE(8))
      if (length < 8) break
      position += length
    }
    throw new Error('MP4 缺少 faststart')
  } finally { await file.close() }
}

export async function verifyClipFile({path,plan,references,signal,onProgress = () => {},ffmpeg = 'ffmpeg',ffprobe = 'ffprobe',minSsim = 0.95,diagnosticsRoot}) {
  const {stdout} = await clipRun(ffprobe,['-v','error','-show_streams','-show_format','-of','json',path],{signal})
  const probe=JSON.parse(stdout)
  let decodedFrames=0
  onProgress({phase:'verify',step:'decode',frame:0,totalFrames:plan.frames})
  await clipRun(ffmpeg,[...baseArgs,...progressArgs,'-i',path,'-map','0:v:0','-an','-fps_mode','passthrough','-f','null','-'],{signal,timeoutMs:0,onProgress:frame=>{decodedFrames=frame;onProgress({phase:'verify',step:'decode',frame,totalFrames:plan.frames})}})
  probe.streams.find(stream=>stream.codec_type==='video').nb_read_frames=String(decodedFrames)
  const result = verifyClipProbe(probe, plan, (await stat(path)).size)
  if (plan.format !== 'gif') await verifyFaststart(path)
  const samples = []
  for (const reference of references) {
    const seek=plan.format==='gif'?[]:['-ss',String(Math.max(0,reference.frame/plan.fps-0.000001))]
    const filter = `[0:v]select=eq(n\\,${plan.format==='gif'?reference.frame:0}),setpts=PTS-STARTPTS[frame];[1:v]scale=${plan.resolution.width}:${plan.resolution.height}:flags=lanczos,format=yuv420p,setpts=PTS-STARTPTS[ref];[frame][ref]ssim`
    const {stderr} = await clipRun(ffmpeg,[...baseArgs,...seek,'-i',path,'-i',reference.path,'-filter_complex',filter,'-frames:v','1','-an','-f','null','-'],{signal})
    const score = Number(/All:([\d.]+)/.exec(stderr)?.[1])
    if (!Number.isFinite(score) || score < minSsim) {
      if(diagnosticsRoot)try{
        // Retain only the failing pair, not a frame dump or unpublished video.
        await mkdir(diagnosticsRoot,{recursive:true})
        await writeFile(join(diagnosticsRoot,'comparison.json'),JSON.stringify({frame:reference.frame,score,minSsim,preset:plan.preset}))
        await copyFile(reference.path,join(diagnosticsRoot,'reference.png'))
        await clipRun(ffmpeg,[...baseArgs,...seek,'-i',path,'-vf',`select=eq(n\\,${plan.format==='gif'?reference.frame:0})`,'-frames:v','1',join(diagnosticsRoot,'actual.png')],{signal,timeoutMs:15000})
      }catch{ /* A diagnostic failure must not change the verification verdict. */ }
      throw new Error(`第 ${reference.frame} 帧与直接回放参考图不一致`)
    }
    samples.push({frame:reference.frame,ssim:score})
    onProgress({phase:'verify',step:'samples',frame:samples.length,totalFrames:references.length})
  }
  return {...result,faststart:plan.format !== 'gif',samples}
}

export async function verifyDecodedAudio({ffmpeg,path,mixed,background,backgroundStartMs=0,temporary,audio,evidence,signal,fps = CLIP_FPS,onProgress = () => {}}) {
  const samplesPerFrame = 48000 / fps
  const voices=(evidence.plannedVoices || evidence.voiceOnsets).map(expected=>{
    const voice=audio.find(row=>row.kind==='voice'&&row.id===expected.id)
    if(!voice)throw new Error('计划中的对白缺少音轨：'+expected.id)
    return voice
  })
  if(!voices.length)return []
  async function pcm(input,name,trim=[]) {
    const output=join(temporary,name+'.f32')
    await clipRun(ffmpeg,[...baseArgs,'-i',input,...trim,'-vn','-ac','1','-ar','48000','-f','f32le',output],{signal})
    const bytes=await readFile(output),samples=new Float32Array(bytes.length/4)
    for(let i=0;i<samples.length;i++)samples[i]=bytes.readFloatLE(i*4)
    return samples
  }
  onProgress({phase:'verify',step:'audio',frame:0,totalFrames:voices.length})
  const [expected,decoded,bed]=await Promise.all([pcm(mixed,'expected'),pcm(path,'decoded'),background?pcm(background,'background',['-ss',seconds(backgroundStartMs),'-t',seconds(evidence.durationMs)]):null]),result=[]
  for(const [index,voice] of voices.entries()) {
    const original=await pcm(voice.referencePath || voice.path,'voice-'+index,['-ss',seconds(voice.sourceStartMs || 0),'-t',seconds(voice.plannedDurationMs || voice.durationMs)])
    const energy=[]
    for(let i=0;i<original.length;i+=480){let sum=0;for(let j=i;j<Math.min(i+480,original.length);j++)sum+=original[j]**2;energy.push(sum)}
    const peak=energy.reduce((max,value)=>Math.max(max,value),0),onset=energy.findIndex(value=>value>peak*0.0004)
    if(!(peak>1e-10)||onset<0)throw new Error('缓存对白没有可检测的声音起点')
    const reveal=evidence.voiceOnsets.find(row=>row.id===voice.id)
    if(!reveal||Math.abs(voice.startFrame-reveal.revealFrame)>1)throw new Error('对白播放起点与文字显示相差超过一帧')
    // Cached speech may contain its own leading silence. Preserve that source;
    // measure codec delay around audible speech, not around an empty pre-roll.
    const audibleSample=voice.startFrame*samplesPerFrame+onset*480
    const start=Math.max(0,audibleSample-4800),end=Math.min(expected.length,audibleSample+12000)
    let best={score:-1,lag:0}
    for(let lag=-3200;lag<=3200;lag+=16){
      let xy=0,xx=0,yy=0
      for(let i=start;i<end;i+=8){const x=expected[i],y=decoded[i+lag] || 0;xy+=x*y;xx+=x*x;yy+=y*y}
      const score=xy/Math.sqrt(xx*yy || 1)
      if(score>best.score+1e-8 || Math.abs(score-best.score)<=1e-8&&Math.abs(lag)<Math.abs(best.lag))best={score,lag}
    }
    if(best.score<0.85 || Math.abs(best.lag)>samplesPerFrame)throw new Error('编码后混音与回放时间线不一致')
    const audioFrame=voice.startFrame+Math.round(best.lag/samplesPerFrame)
    if(Math.abs(voice.startFrame+best.lag/samplesPerFrame-reveal.revealFrame)>1)throw new Error('对白播放起点与文字显示相差超过一帧')
    // Compare the cached voice itself, not only decoded audio against our own
    // mix (two equally voice-less mixes used to pass). Remove the independently
    // mixed non-voice bed and check the beginning, middle and end of each line.
    const spans=[]
    for(let part=0;part<3;part++) {
      const lo=Math.floor(energy.length*part/3),hi=Math.floor(energy.length*(part+1)/3)
      let loudest=lo
      for(let i=lo;i<hi;i++)if(energy[i]>energy[loudest])loudest=i
      if(energy[loudest]>peak*0.0004) {
        const from=Math.max(0,loudest*480-2400)
        spans.push({from,to:Math.min(original.length,from+12000)})
      }
    }
    let sourceBest={score:-1,lag:0,windows:[]}
    for(let lag=-3200;lag<=3200;lag+=16) {
      const windows=spans.map(({from,to})=>{
        let xy=0,xx=0,yy=0
        for(let i=from;i<to;i+=8) {
          const at=Math.round(voice.startFrame*samplesPerFrame+i),x=original[i],y=(decoded[at+lag] || 0)-(bed?.[at] || 0)
          xy+=x*y;xx+=x*x;yy+=y*y
        }
        return {sourceMs:from/48,correlation:xy/Math.sqrt(xx*yy || 1)}
      })
      const score=Math.min(...windows.map(row=>row.correlation))
      if(score>sourceBest.score+1e-8 || Math.abs(score-sourceBest.score)<=1e-8&&Math.abs(lag)<Math.abs(sourceBest.lag))sourceBest={score,lag,windows}
    }
    if(!spans.length||sourceBest.score<0.85||Math.abs(sourceBest.lag)>samplesPerFrame)throw new Error('成片缺少完整同步原始配音：'+voice.id)
    result.push({...reveal,audioFrame,audibleFrame:Math.floor((audibleSample+best.lag)/samplesPerFrame),sourceOnsetMs:onset*10,decodedLagSamples:best.lag,correlation:best.score,sourceCorrelation:sourceBest.score,sourceLagSamples:sourceBest.lag,windows:sourceBest.windows,method:'planned-voice-source-and-decoded-mix-correlation'})
    onProgress({phase:'verify',step:'audio',frame:index+1,totalFrames:voices.length})
  }
  return result
}

// Capture owns the temporary master and its audio sources until every encode has finished.
function ownedTask(operation,signal) {
  const task=operation()
  // Cancellation can win the caller's race before subprocess and temporary-file cleanup finishes.
  task.cleanup=task.then(value=>signal?.aborted?value?.close?.():undefined,()=>{})
  void task.cleanup.catch(()=>{})
  return task
}
export function renderClip(options) {return ownedTask(()=>renderFrames(options),options?.signal)}
async function renderFrames({plan,plannedFiles = [],tempRoot,renderer,audio = [],referenceFrames,signal,onProgress = () => {},ffmpeg = 'ffmpeg'}) {
  let temporary, capture, streams, closing, referenceTask, referenceError
  const fps = plan.fps || CLIP_FPS
  const close = () => closing ||= (async () => {
    try { await streams?.close();await renderer.close() }
    finally { await referenceTask?.catch(()=>{});if (temporary) await rm(temporary,{recursive:true,force:true}) }
  })()
  try {
    await mkdir(tempRoot,{recursive:true})
    temporary = await mkdtemp(join(tempRoot,'clip-'))
    const intermediate = join(temporary,'stage.mkv')
    const jpeg=plan.captureFormat==='jpeg',master={bytes:0,writeMs:0,drains:0,finishMs:0,streamWriteMs:0}
    const milestones=[];let activeAwait=null,awaitProgress
    const diagnostics=()=>({...renderer.metrics?.(),master:{...master},streams:streams?.metrics(),finalization:{activeAwait,memory:process.memoryUsage(),milestones:[...milestones]}})
    const record=event=>{milestones.push({at:Date.now(),...event});if(milestones.length>128)milestones.shift();if(awaitProgress)onProgress({...awaitProgress,capture:diagnostics()})}
    const wait=async(stage,operation,phase='render')=>{
      const started=performance.now(),totalFrames=stage==='master'?plan.frames:1;activeAwait=stage;awaitProgress={phase,step:stage,frame:0,totalFrames}
      record({stage,status:'start'})
      try {const value=await operation();activeAwait=null;awaitProgress={phase,step:stage,frame:totalFrames,totalFrames};record({stage,status:'done',ms:performance.now()-started});return value}
      catch(error){record({stage,status:'failed',ms:performance.now()-started});throw error}
    }
    const streamPlans=jpeg && fps===CLIP_FPS?plannedFiles.filter(part=>['1080p','discord'].includes(part.preset)&&part.fps===fps):[]
    if(streamPlans.length)streams=createClipVideoStreams({plans:streamPlans,temporary,fps,ffmpeg,signal,onProgress,onDiagnostic:record,encoder:streamPlans.some(part=>part.preset==='1080p')?await selectClipEncoder(ffmpeg,signal):null})
    const captureReferences=async(background=false)=>{
      const references=[],samples=[...new Set([...(referenceFrames || [0,Math.floor(plan.frames/2),plan.frames-1]),...(renderer.captureBoundaries?.() || [])])].sort((a,b)=>a-b)
      for(const frame of samples){
        const path=join(temporary,`reference-${frame}.png`)
        await writeFile(path,await renderer.reference(frame,{signal,background}))
        references.push({frame,path})
      }
      return references
    }
    await renderer.startCapture?.({directory:temporary})
    // The independent replay owns another page/browser and never consumes the
    // primary clock. Overlap it too, without weakening its PNG comparison.
    if(jpeg && fps===CLIP_FPS){referenceTask=captureReferences(true);void referenceTask.catch(error=>{referenceError=error})}
    // The progress watchdog already bounds a stalled stream. Write one seekable
    // master instead of closing every 300 frames and copying all its bytes again.
    capture = clipProcess(ffmpeg,[...baseArgs,'-f','image2pipe','-framerate',String(fps),'-vcodec',jpeg?'mjpeg':'png','-i','pipe:0','-an',...(jpeg?['-c:v','copy']:['-c:v','libx264rgb','-preset','ultrafast','-crf','0','-threads','4']),intermediate],{signal,input:true,timeoutMs:0})
    for (let frame = 0; frame < plan.frames; frame++) {
      signal?.throwIfAborted()
      if(referenceError)throw referenceError
      const png = await renderer.capture(frame, {signal})
      const started=performance.now()
      const draining=clipWrite(capture,png)
      if(draining){master.drains++;await draining}
      master.bytes+=png.length;master.writeMs+=performance.now()-started
      const streamStarted=performance.now();await streams?.write(frame,png);master.streamWriteMs+=performance.now()-streamStarted
      capture.touch()
      onProgress({phase:'render',step:'capture',frame:frame + 1,totalFrames:plan.frames,...(frame%30===0 || frame===plan.frames-1?{capture:diagnostics()}: {})})
    }
    onProgress({phase:'render',step:'master',frame:0,totalFrames:plan.frames})
    const finishing=performance.now()
    capture.child.stdin.end()
    await wait('master',()=>capture.done)
    master.finishMs=performance.now()-finishing
    const references=await wait('reference-task',()=>referenceTask ||= captureReferences())
    if(typeof audio === 'function')audio=await wait('audio-graph',audio)
    const evidence = await wait('evidence',()=>renderer.evidence())
    if (evidence.nonStageRects.length) throw new Error('画面包含非舞台界面')
    if (!['virtual','slowed-realtime'].includes(evidence.clock)) throw new Error('缺少回放时钟证据')
    for (const voice of evidence.voiceOnsets) if (Math.abs(voice.audioFrame - voice.revealFrame) > 1) throw new Error('对白与文字显示相差超过一帧')
    for(const voice of evidence.timeline?.voices || [])if(!audio.some(event=>event.kind==='voice'&&event.id===voice.id))throw new Error('计划中的对白缺少音轨：'+voice.id)
    for (const event of audio.filter(event => event.kind === 'voice')) {
      if (!evidence.voiceOnsets.some(row => row.id === event.id && Math.abs(row.audioFrame - event.startFrame) <= 1)) throw new Error('缺少对白起点验证')
    }
    onProgress({phase:'encode',step:'mix',frame:0,totalFrames:plan.frames})
    const mix = clipAudioInputs(audio,plan.frames,fps), mixed = join(temporary,'master.wav')
    const mixScript=join(temporary,'mix.filter');await wait('mix-script',()=>writeFile(mixScript,mix.filter),'encode')
    // The replay graph already includes the stored voice gain and user volumes. Never normalize again.
    await wait('mix',()=>clipRun(ffmpeg,[...baseArgs,...progressArgs,'-i',intermediate,...mix.args,'-filter_complex_script',mixScript,'-map','[mix]','-c:a','pcm_f32le',mixed],{signal,timeoutMs:0,onTime:seconds=>onProgress({phase:'encode',step:'mix',frame:Math.min(plan.frames,Math.round(seconds*fps)),totalFrames:plan.frames})}),'encode')
    const background=join(temporary,'background.wav'),bed=clipAudioInputs(audio.filter(row=>row.kind!=='voice'),plan.frames,fps),bedScript=join(temporary,'background.filter')
    await writeFile(bedScript,bed.filter)
    await wait('background',()=>clipRun(ffmpeg,[...baseArgs,...progressArgs,'-i',intermediate,...bed.args,'-filter_complex_script',bedScript,'-map','[mix]','-c:a','pcm_f32le',background],{signal,timeoutMs:0,onTime:seconds=>onProgress({phase:'encode',step:'background',frame:Math.min(plan.frames,Math.round(seconds*fps)),totalFrames:plan.frames})}),'encode')
    const videos=await wait('streams',()=>streams?.finish(),'encode')
    onProgress({phase:'encode',step:'mix',frame:plan.frames,totalFrames:plan.frames,capture:diagnostics()})
    return {plan,temporary,intermediate,mixed,background,references,audio,evidence,videos,close}
  } catch(error) {
    if (capture && capture.child.exitCode === null) { capture.stop(error); await capture.done.catch(() => {}) }
    await close()
    throw error
  } finally {
    if (capture && capture.child.exitCode === null) { capture.stop(new Error('Capture closed')); await capture.done.catch(() => {}) }
  }
}

export function clipVideoWindow(plan,renderFps) {
  const fps=plan.fps || CLIP_FPS,seekSeconds=Math.floor((plan.startFrame || 0)/CLIP_FPS)
  const startFrame=(plan.startFrame || 0)*renderFps/CLIP_FPS-seekSeconds*renderFps
  return {seekSeconds,startFrame,endFrame:startFrame+plan.frames*renderFps/fps}
}

export function encodeClip(options) {return ownedTask(()=>encodeFrames(options),options?.signal)}
async function encodeFrames({plan,outputPath,tempRoot,renderer,audio = [],rendered,signal,onProgress = () => {},ffmpeg = 'ffmpeg',ffprobe = 'ffprobe'}) {
  const ownsRender = !rendered
  let success = false, temporary
  const attempts=[]
  plan={...plan}
  try {
    rendered ||= await renderClip({plan,tempRoot,renderer,audio,signal,onProgress,ffmpeg})
    temporary = await mkdtemp(join(rendered.temporary,'encode-'))
    const fps=plan.fps || CLIP_FPS, renderFps=rendered.plan.fps || CLIP_FPS
    const start=(plan.startFrame || 0)/CLIP_FPS, duration=plan.frames/fps
    // Integer-second input seeking avoids repeatedly decoding every earlier part.
    // Trim the remaining exact frames: fractional seeks can skip a rounded MKV timestamp.
    const window=clipVideoWindow(plan,renderFps)
    const videoInput=[...(window.seekSeconds?['-ss',String(window.seekSeconds)]:[]),'-i',rendered.intermediate]
    const passlog=join(temporary,'x264'), mixed=join(temporary,'mix.wav')
    const encoder=rendered.videos?.get(clipVideoStreamKey(plan))?.encoder || (plan.preset==='discord'?{name:'libx264',args:['-preset','veryfast']}:plan.format==='gif'?null:await selectClipEncoder(ffmpeg,signal))
    // Select the reference frame grid, not fps's midpoint sampling. Convert
    // JPEG full-range samples to TV range as well as tagging the H264 output.
    const filterFor=resolution=>`trim=start_frame=${window.startFrame}:end_frame=${window.endFrame},select=not(mod(n\\,${renderFps/fps})),setpts=N/${fps}/TB,fps=${fps},scale=${resolution.width}:${resolution.height}:flags=lanczos${plan.format==='gif'?'':':out_range=tv'}`
    const filter=filterFor(plan.resolution)
    const references=rendered.references.filter(row=>row.frame>=start*renderFps && row.frame<Math.min(rendered.plan.frames,(start+duration)*renderFps) && Number.isInteger((row.frame-start*renderFps)*fps/renderFps)).map(row=>({...row,frame:(row.frame-start*renderFps)*fps/renderFps}))
    if (!references.length) throw new Error('缺少此输出的独立回放参考帧')
    onProgress({phase:'encode',frame:0,totalFrames:plan.frames})
    if (plan.format === 'gif') {
      const palette=join(temporary,'palette.png')
      await clipRun(ffmpeg,[...baseArgs,...videoInput,'-vf',filter+',palettegen=stats_mode=diff','-frames:v','1',palette],{signal})
      await clipRun(ffmpeg,[...baseArgs,...videoInput,'-i',palette,'-filter_complex',`[0:v]${filter}[v];[v][1:v]paletteuse=dither=sierra2_4a`,'-frames:v',String(plan.frames),'-an','-loop','0',outputPath],{signal})
    } else {
      await clipRun(ffmpeg,[...baseArgs,'-ss',String(start),'-i',rendered.mixed,'-af',`apad,atrim=duration=${duration},asetpts=PTS-STARTPTS`,'-c:a','pcm_f32le',mixed],{signal})
      const maxBytes=plan.maxBytes === undefined ? CLIP_MAX_BYTES : plan.maxBytes
      const budget=clipVideoBitrate(plan.sourceFrames || plan.frames)
      const candidates=plan.preset==='discord'
        ? [clipDiscordSettings(plan.sourceFrames || plan.frames)]
        : [{resolution:plan.resolution,videoBitrate:plan.videoBitrate}]
      for(let attempt=0;attempt<candidates.length;attempt++) {
        Object.assign(plan,candidates[attempt])
        const twoPass=plan.preset==='discord'
        const videoArgs=['-vf',filterFor(plan.resolution),'-map','0:v:0','-c:v',encoder.name,...encoder.args,'-b:v',String(plan.videoBitrate),'-pix_fmt','yuv420p','-color_range','tv','-r',String(fps),'-fps_mode','cfr','-frames:v',String(plan.frames)]
        const progress=step=>({signal,timeoutMs:0,onProgress:frame=>onProgress({phase:'encode',step,frame,totalFrames:plan.frames,encoder:encoder.name})})
        const streamed=rendered.videos?.get(clipVideoStreamKey(plan))
        const mux=['-map','1:a:0','-c:a','aac','-b:a',String(plan.audioBitrate || CLIP_AUDIO_BPS),'-ar','48000','-t',String(duration),'-movflags','+faststart',outputPath]
        if(streamed){
          // Keep AAC progress independent of video packet progress. The final
          // mux only copies packets, with no competing audio encoder/input queue.
          const encodedAudio=join(temporary,'stream-audio.m4a')
          await clipRun(ffmpeg,[...baseArgs,...progressArgs,'-i',mixed,'-map','0:a:0','-c:a','aac','-b:a',String(plan.audioBitrate || CLIP_AUDIO_BPS),'-ar','48000','-t',String(duration),encodedAudio],
            {...progress('audio'),onTime:seconds=>onProgress({phase:'encode',step:'audio',frame:Math.min(plan.frames,Math.round(seconds*fps)),totalFrames:plan.frames})})
          await clipRun(ffmpeg,[...baseArgs,...progressArgs,'-i',streamed.path,'-i',encodedAudio,'-map','0:v:0','-map','1:a:0','-c','copy','-t',String(duration),'-movflags','+faststart',outputPath],progress('mux'))
        } else {
          if(twoPass)await clipRun(ffmpeg,[...baseArgs,...progressArgs,...videoInput,...videoArgs,'-passlogfile',passlog,'-pass','1','-an','-f','null','-'],progress('pass1'))
          await clipRun(ffmpeg,[...baseArgs,...progressArgs,...videoInput,'-i',mixed,...videoArgs,...(twoPass?['-passlogfile',passlog,'-pass','2']:[]),...mux],progress(twoPass?'pass2':'video'))
        }
        const bytes=(await stat(outputPath)).size
        attempts.push({...candidates[attempt],bytes})
        if(!maxBytes || bytes<=maxBytes)break
        const videoBitrate=Math.floor(plan.videoBitrate*maxBytes/bytes*0.96)
        const indivisible=plan.from?.turn===plan.to?.turn && plan.from?.para===plan.to?.para
        if(attempt>=5 || videoBitrate<=0)throw new Error('实测大小无法满足 720p30 与 8 MB 限制')
        // Actual overflow, not a speculative full-quality encode, drives any correction.
        if(videoBitrate>=clipQualityFloor(plan.resolution.height) || indivisible && plan.resolution.height===720) {
          candidates.push({step:plan.resolution.height===1080?2:3,resolution:plan.resolution,videoBitrate})
        } else if(plan.resolution.height===1080) {
          candidates.push({step:3,resolution:{width:1280,height:720},videoBitrate:Math.max(clipQualityFloor(720),Math.min(budget,4_000_000))})
        } else {
          throw Object.assign(new Error('Measured file size requires paragraph-boundary replanning'),{code:'CLIP_SIZE_REPLAN',videoBitrate,attempts})
        }
      }
      plan.bpppf=plan.videoBitrate/(plan.resolution.width*plan.resolution.height*fps)
      plan.belowQualityFloor=plan.preset==='discord' && plan.videoBitrate<clipQualityFloor(plan.resolution.height)
    }
    onProgress({phase:'verify',frame:plan.frames,totalFrames:plan.frames})
    const verification = await verifyClipFile({path:outputPath,plan,references,signal,ffmpeg,ffprobe,minSsim:plan.format==='gif'?0.90:0.95,onProgress,diagnosticsRoot:tempRoot&&join(tempRoot,'mismatch-'+basename(dirname(outputPath)))})
    const convert=frame=>(frame-(plan.startFrame || 0)*renderFps/CLIP_FPS)*fps/renderFps
    const partAudio=rendered.audio.filter(row=>row.startFrame/renderFps>=start && row.startFrame/renderFps<start+duration).map(row=>({...row,startFrame:convert(row.startFrame)}))
    const evidence={...rendered.evidence,durationMs:duration*1000,plannedVoices:rendered.evidence.timeline?.voices.filter(row=>row.startFrame/CLIP_FPS>=start&&row.startFrame/CLIP_FPS<start+duration),voiceOnsets:rendered.evidence.voiceOnsets.filter(row=>row.audioFrame/renderFps>=start && row.audioFrame/renderFps<start+duration).map(row=>({...row,audioFrame:convert(row.audioFrame),revealFrame:convert(row.revealFrame)}))}
    const voiceOnsets=plan.format==='gif'?[]:await verifyDecodedAudio({ffmpeg,path:outputPath,mixed,background:rendered.background,backgroundStartMs:start*1000,temporary,audio:partAudio,evidence,signal,fps,onProgress})
    success = true
    return {file:{path:outputPath,preset:plan.preset,from:plan.from,to:plan.to,step:plan.step,videoBitrate:plan.videoBitrate,bpppf:plan.bpppf,belowQualityFloor:plan.belowQualityFloor,...verification},verification:{...verification,attempts,encoder:encoder?.name,clock:evidence.clock,voiceOnsets,pageTurns:rendered.evidence.pageTurns?.filter(row=>row.frame/renderFps>=start&&row.frame/renderFps<start+duration).map(row=>({...row,frame:convert(row.frame)})),referenceTurns:rendered.evidence.referenceTurns?.filter(row=>row.frame/renderFps>=start&&row.frame/renderFps<start+duration).map(row=>({...row,frame:convert(row.frame)})),nonStageRects:[]},
      warnings:[...(plan.belowQualityFloor?['单段已完整保留，720p 码率低于清晰度下限']:[]),...(evidence.clock === 'slowed-realtime' ? ['部分动画不能跟随虚拟时钟，已在独立静音窗口使用慢速实时时钟捕获'] : [])]}
  } finally {
    if (temporary) await rm(temporary,{recursive:true,force:true})
    if (ownsRender && rendered) await rendered.close()
    if (!success) await rm(outputPath,{force:true})
  }
}
