import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {installClipClock} from './clip-export-clock.js'
import {installClipTime} from './clip-export-time.js'
import {clipCaptureSegments,createClipFrameSpool} from './clip-export-parallel.js'
import autoTiming from '../../../../src/client/stage-auto-timing.cjs'
import {createClipTimeline} from '../domain/clip-export-timeline.js'
import {readStageClient,stageClientModuleAsScript} from '../client-assets.js'

const {CLIP_READING}=autoTiming

const require = createRequire(new URL('../../../../../package.json',import.meta.url))
export const CLIP_ORIGIN = 'https://clip-export.invalid'
export function clipChromiumArgs(platform=process.platform,controlled=false) {
  // CFT's Windows startup sampler can crash in native stack unwinding during PNG encoding
  // (Chromium 473587142). It is not part of replay or capture; disable it, never retry a lost page.
  // Keep Chromium's normal BeginFrame source. Its unthrottled source can stop
  // advancing the browser compositor while a new-surface screenshot waits for a copy.
  // Replay time is controlled separately by installClipTime, not this native cadence.
  return ['--mute-audio','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=0',...(platform==='win32'?['--disable-stack-profiler']:[]),...(controlled?['--enable-begin-frame-control','--run-all-compositor-stages-before-draw','--use-angle=d3d11']:[])]
}
export function clipScreenshotOptions(format='png') {
  return {format,...(format==='jpeg'?{quality:95}:{}),captureBeyondViewport:false,optimizeForSpeed:true}
}
async function reactScript() {
  let source = 'const modules={};\n'
  for (const [name,file] of [['react','react.production.js'],['scheduler','scheduler.production.js'],['react-dom','react-dom.production.js'],['react-dom/client','react-dom-client.production.js']]) {
    source += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}},exports=module.exports,require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)),'cjs',file),'utf8')}\nreturn module.exports;})();\n`
  }
  // The core client registers through the module-loader facade; the stage client is an ES module (stage-client.mjs)
  // evaluated as a strict classic script whose completion value is the plugin.
  return source + `Object.assign(modules['react-dom'],modules['react-dom/client']);window.__ModuleLoader__={load(d){window.clipClient=d.factory(name=>modules[name]||{});}};`
}

export async function createClipBrowser({snapshot,plan,transport,readAsset,signal,onProgress=()=>{},onClose=async()=>{},captureResources,measureOnly=false}) {
  signal?.throwIfAborted()
  onProgress({phase:'prepare',step:'browser',frame:0,totalFrames:66})
  const {chromium} = await import('playwright')
  // Headless shell exposes an acknowledged compositor frame, unlike a real-time
  // screencast. Replay's JS/media clock is unchanged; no CDP virtual time is used.
  const controlled=plan.captureFormat==='jpeg' && process.platform==='win32'
  const launchCaptureBrowser=()=>chromium.launch({...(controlled?{}:{channel:'chromium'}),headless:true,args:clipChromiumArgs(process.platform,controlled),timeout:30000})
  const browser = await launchCaptureBrowser()
  const captureBrowsers=[browser]
  const lifecycle=[],record=event=>{lifecycle.push({event,at:Date.now()});if(lifecycle.length>12)lifecycle.shift()}
  browser.on('disconnected',()=>record('browser-disconnected'))
  let closing,referencePass,referenceBrowser,referenceProgress,captureFinished=false,referenceInBackground=false,spool
  const capturePasses=[]
  const reportReference=value=>{referenceProgress=value;if(!referenceInBackground || captureFinished)onProgress(value)}
  const close=()=>closing ||=(async()=>{record('cleanup');signal?.removeEventListener('abort',abort);try{await Promise.all([...captureBrowsers.map(value=>value.close()),referenceBrowser?.close()]);await spool?.close()}finally{await onClose()}})()
  const abort = () => {record('abort');void close().catch(()=>{})};signal?.addEventListener('abort',abort,{once:true})
  if(signal?.aborted){await close();signal.throwIfAborted()}
  async function bounded(task,label,timeout=30000) {
    let timer
    try {return await Promise.race([task,new Promise((resolve,reject)=>{timer=setTimeout(()=>{
      reject(new Error(label+'超时，请重试导出'));void close().catch(()=>{})
    },timeout)})])} finally {clearTimeout(timer)}
  }
  let scripts
  const clockEpoch=Date.now()
  const paragraphs=snapshot.paragraphs.filter(row=>(row.turn>plan.from.turn||row.turn===plan.from.turn&&row.para>=plan.from.para)&&(row.turn<plan.to.turn||row.turn===plan.to.turn&&row.para<=plan.to.para))
  const fps=plan.fps || 30
  let contentPlan=snapshot.timeline,segments
  const captureCards=()=>contentPlan.cards.map(row=>({...row,start:row.start*fps/contentPlan.fps,end:row.end*fps/contentPlan.fps}))
  let timeline=contentPlan && captureCards()
  async function createPass(reference=false,auxiliary=false) {
    const report=(step,frame)=>{if(!auxiliary)(reference?reportReference:onProgress)({phase:reference?'verify':'prepare',step:reference?'reference-prepare-'+step:step,frame,totalFrames:66})}
    report('page',1)
    // Keep the reference on the original full Chromium screenshot path so the
    // new frame source cannot validate its own stale-frame or compositor errors.
    if(reference && controlled) {
      referenceBrowser=await chromium.launch({channel:'chromium',headless:true,args:clipChromiumArgs(),timeout:30000})
      if(signal?.aborted || closing){await referenceBrowser.close();signal?.throwIfAborted();throw new Error('Export closed')}
    }
    let passBrowser=referenceBrowser && reference?referenceBrowser:browser
    if(auxiliary) {
      // Each segment needs its own compositor/GPU command queue, not just a
      // context behind the same headless-shell screenshot scheduler.
      passBrowser=await launchCaptureBrowser()
      captureBrowsers.push(passBrowser)
      if(signal?.aborted || closing){await passBrowser.close();signal?.throwIfAborted();throw new Error('Export closed')}
    }
    const page=await passBrowser.newPage({viewport:plan.resolution,deviceScaleFactor:1})
    const captureSession=await page.context().newCDPSession(page)
    for(const event of ['close','crash'])page.on(event,()=>record((reference?'reference:':'primary:')+event))
    page.on('framenavigated',frame=>{if(!frame.parentFrame())record((reference?'reference:':'primary:')+'navigation')})
    const errors=[],requested=new Set(),reveals=new Map(),nonStageRects=[],pageTurns=[]
    let outstanding=0,lastFrame=-1,current=null
    const metrics={frames:0,clockMs:0,stateMs:0,screenshotMs:0,settleMs:0,settleCalls:0,resourceWaitMs:0,paragraphs:0,screenshotMaxMs:0,screenshotBuckets:[0,0,0,0,0,0],frameSource:controlled&&!reference?'begin-frame':'screenshot'}
    page.on('pageerror',error=>errors.push(error.stack || error.message))
    page.on('requestfailed',request=>{
      const failure=request.failure()?.errorText
      if(failure&&failure!=='net::ERR_ABORTED'){
        const url=new URL(request.url())
        errors.push('Export resource failed: '+url.protocol+' '+url.pathname+' ('+failure+')')
      }
    })
    await page.addInitScript('window.__name=fn=>fn;')
    await page.route('**/*',async route=>{
      outstanding++
      try {
        const url=new URL(route.request().url())
        if(url.origin!==CLIP_ORIGIN)throw new Error('Export blocked external resource: '+url.origin+url.pathname)
        if(url.pathname==='/')return await route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body></body>'})
        // Dev-diagnostics beacon of the audio trace: not an asset, so acknowledge it without an export error.
        if(url.pathname==='/api/dsh-tavern/recordAudioTrace')return await route.fulfill({status:204,body:''})
        requested.add(url.pathname)
        const value=await readAsset(url)
        if(!value)throw new Error('Export asset unavailable: '+url.pathname)
        await route.fulfill({status:200,contentType:value.mediaType || value.type || 'application/octet-stream',body:Buffer.from(value.body)})
      } catch(error){errors.push(error.message);await route.abort('failed').catch(()=>{})}
      finally{outstanding--}
    })
    await page.goto(CLIP_ORIGIN)
    await page.evaluate(installClipTime,{epoch:clockEpoch,fps})
    await page.evaluate(installClipClock,CLIP_READING)
    await page.exposeFunction('clipTransport',async(method,args)=>{outstanding++;try{return await transport(method,args)}finally{outstanding--}})
    report('audio',2)
    await page.evaluate(async rows=>{
      if(!rows.length)return
      const context=new AudioContext()
      for(const row of rows){const response=await fetch('/clip-voice/'+row.key),blob=await response.blob(),buffer=await context.decodeAudioData(await blob.arrayBuffer());window.clipOriginalVoices.set(row.key,{key:row.key,blob,buffer})}
      await context.close()
    },[...new Map(paragraphs.flatMap(row=>[row.voice,...(row.pageVoices || [])]).filter(Boolean).map(voice=>[voice.key,voice])).values()])
    report('stage',3)
    await page.addScriptTag({content:scripts.react})
    await page.addScriptTag({content:scripts.client})
    await page.addScriptTag({content:scripts.stage + '\nwindow.clipStage=stageClientPlugin;'})
    await page.evaluate(async value=>{window.clipReplay=await window.clipStage.mountClipReplay(window.clipClient.clipReplayCore(),value,window.clipTransport)},snapshot)
    // Pump render acknowledgements at the SAME timestamp while IO completes. Loading never consumes output frames.
    async function settle() {
      const started=performance.now()
      metrics.settleCalls++
      let stable=0
      // The enclosing phase deadline bounds IO, not an arbitrary number of CDP pumps.
      while(true) {
        signal?.throwIfAborted()
        await page.evaluate(()=>{window.clipFlushFrame();window.clipSeekAnimations()})
        await page.evaluate(()=>window.clipAdvance(0))
        // Controlled frames must also deliver native layout/ResizeObserver
        // work before the first captured frame of a newly sized paragraph.
        if(controlled && !reference)await captureSession.send('HeadlessExperimental.beginFrame',{})
        if(errors.length)throw new Error(errors.join('\n'))
        if(outstanding===0)stable++;else stable=0
        if(stable>=5){metrics.settleMs+=performance.now()-started;return}
        if(outstanding){const waiting=performance.now();await new Promise(resolve=>setTimeout(resolve,10));metrics.resourceWaitMs+=performance.now()-waiting}
      }
    }
    report('resources',4)
    await settle()
    // Fixed preroll, identical in the independent reference pass; no selected one-shot is running yet.
    for(let i=0;i<60;i++){await page.evaluate(ms=>window.clipAdvance(ms),i%3===2?34:33);await settle();report('warmup',5+i)}
    // Every pass reads each selected page from history (nothing plays) for the text box pager's cards, at the same
    // clock time, so all passes leave the same state; the first pass times the cards, the others must find the same cards.
    report('paging',65)
    const measured=[]
    for(const row of paragraphs) {
      const pages=[]
      // Loading a turn precedes asking its page count; an unloaded first turn is
      // not an empty paragraph and must never disappear from the content clock.
      await page.evaluate(({turn,para})=>window.clipReplay.view(turn,para,0),row)
      await settle()
      for(let card=0;card<await page.evaluate(({turn,para})=>window.clipReplay.pages(turn,para).length,row);card++) {
        await page.evaluate(({turn,para,card})=>window.clipReplay.view(turn,para,card),{turn:row.turn,para:row.para,card})
        await settle()
        const cards=await page.evaluate(({turn,para,card})=>window.clipReplay.cards(turn,para,card),{turn:row.turn,para:row.para,card})
        if(!cards?.length)throw new Error(`Export paging could not read ${row.turn}:${row.para} page ${card}`)
        pages.push(cards)
      }
      // Each page's narrator line (旁白配音: the stage's own voice descriptor), for the host to read its cached voice.
      measured.push({pages,narration:await page.evaluate(({turn,para})=>window.clipReplay.pages(turn,para).map(row=>row.narration),row)})
    }
    if(!contentPlan){contentPlan=createClipTimeline(paragraphs,measured);timeline=captureCards()}
    else if(JSON.stringify(measured.map(row=>row.pages.map(page=>page.map(card=>card.text))))!==JSON.stringify(contentPlan.lines.map(row=>contentPlan.cards.filter(item=>item.turn===row.turn&&item.para===row.para).reduce((pages,item)=>{(pages[item.card] ||= []).push(item.text);return pages},[]))))
      throw new Error('Export paging does not match the timeline')
    if(measureOnly)return {page,metrics,measured}
    report('replay',65)
    await page.evaluate(()=>window.clipBegin())
    await page.evaluate(({turn,para})=>window.clipReplay.replay(turn,para),plan.from)
    await settle()
    report('ready',66)
    metrics.prepare={settleMs:metrics.settleMs,settleCalls:metrics.settleCalls,resourceWaitMs:metrics.resourceWaitMs}
    metrics.settleMs=0;metrics.settleCalls=0;metrics.resourceWaitMs=0
    const box=await page.locator('.fork-gal-stage').boundingBox()
    if(!box||box.x!==0||box.y!==0||box.width!==plan.resolution.width||box.height!==plan.resolution.height)throw new Error('Export stage geometry mismatch')
    const inspect=()=>page.evaluate(()=>{
      window.clipSeekAnimations()
      const stage=document.querySelector('.fork-gal-stage'),caption=stage?.querySelector('.fork-gal-text'),style=caption&&getComputedStyle(caption)
      const forbidden='.fork-gal-topbar,.fork-gal-controls,.fork-gal-runtime-status,.fork-gal-menu-fold,.fork-gal-voice,.fork-widget-source-controls,.fork-gal-meta,.fork-gal-entry-overlay,.fork-stage-load-progress,.fork-stage-skin-buttons'
      const visible=node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width>0&&rect.height>0&&rect.right>0&&rect.bottom>0&&rect.left<innerWidth&&rect.top<innerHeight&&style.visibility!=='hidden'&&style.display!=='none'&&Number(style.opacity)>0&&node.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true})!==false}
      const external=[...document.querySelectorAll('body *')].filter(node=>!node.closest('.fork-gal-stage')&&!node.querySelector('.fork-gal-stage')&&!['SCRIPT','STYLE'].includes(node.tagName))
      return {text:stage?.innerText,caption:caption?.textContent,captionVisible:!!caption&&visible(caption)&&style.visibility!=='hidden',
        state:window.clipReplay.state(),nonStageRects:[...external,...document.querySelectorAll(forbidden)].filter(visible).map(node=>({tag:node.tagName,className:node.className}))}
    })
    return {
      page,inspect,errors,requested,reveals,nonStageRects,pageTurns,metrics,
      async capture(frame,screenshot=true) {
        let mark=performance.now()
        metrics.activeFrame=frame;metrics.activeStep='clock'
        signal?.throwIfAborted()
        if(frame!==lastFrame+1)throw new Error('Export frames must be sequential')
        if(errors.length)throw new Error(errors.join('\n'))
        await page.evaluate(async({frame,delta,prefix})=>{
          window.clipFrame=frame
          if(delta)await window.clipAdvance(delta)
          window.clipTickMedia()
          if(prefix)window.clipSeekAnimations()
        },{frame,delta:frame?Math.round(frame*1000/fps)-Math.round(lastFrame*1000/fps):0,prefix:!screenshot&&!reference})
        lastFrame=frame
        metrics.clockMs+=performance.now()-mark;mark=performance.now();metrics.activeStep='state'
        const row=timeline.find(row=>frame>=row.start&&frame<row.end)
        if(!row)throw new Error('Export paging does not match frame plan')
        metrics.turn=row.turn;metrics.para=row.para
        if(row!==current) {
          // A card on the same page is the stage's own card turn (the voice keeps playing); a new page navigates the replay.
          if(current&&current.turn===row.turn&&current.para===row.para&&current.card===row.card)await page.evaluate(sub=>window.clipReplay.subpage(sub),row.sub)
          else {
            metrics.paragraphs++
            if(current&&current.turn!==row.turn)await page.evaluate(({turn,para})=>window.clipReplay.replay(turn,para),row)
            await page.evaluate(({turn,para,card})=>window.clipReplay.paragraph(turn,para,card),row)
          }
          await settle();current=row
          const shown=await page.evaluate(()=>window.clipReplay.card())
          if(shown.card!==row.sub||shown.text!==row.text)throw new Error(`Export paging does not match frame plan at ${row.turn}:${row.para} card ${row.sub}`)
          pageTurns.push({turn:row.turn,para:row.para,card:row.card,sub:row.sub,frame})
        }
        // Invisible prefix frames still tick the complete replay/media/CSS clock.
        // Once reveal is measured, they need no repeated full-document UI scan.
        // A narration voice starts with its own page (旁白配音), so each page's first visible frame is measured too.
        const pageReveal=row.turn+':'+row.para+':'+row.card
        if(reference || screenshot || !reveals.has(pageReveal)) {
          const visible=await inspect()
          if(visible.state.entry!=='ready' || visible.state.pending.error)throw new Error('Recorded stage did not become ready for capture: '+JSON.stringify(visible.state))
          const recorded=snapshot.turns.find(turn=>turn.turn===row.turn)?.direction
          if(recorded?.token && JSON.stringify(visible.state.director.token)!==JSON.stringify(recorded.token))throw new Error('Recorded direction was not admitted: '+JSON.stringify(visible.state.director))
          if(visible.nonStageRects.length)nonStageRects.push(...visible.nonStageRects)
          if(visible.captionVisible&&visible.caption?.trim()&&visible.state.cursor.anchor?.para===row.para) {
            if(!reveals.has(row.turn+':'+row.para))reveals.set(row.turn+':'+row.para,frame)
            if(!reveals.has(pageReveal))reveals.set(pageReveal,frame)
          }
        }
        metrics.stateMs+=performance.now()-mark;mark=performance.now()
        if(!screenshot){metrics.activeStep='done';return null}
        metrics.activeStep='screenshot'
        // The validated stage fills the viewport. Even a matching clip makes Chromium
        // toggle viewport emulation per frame; capture without changing that geometry.
        const format=reference?'png':plan.captureFormat || 'png'
        const shot=controlled&&!reference
          ? await captureSession.send('HeadlessExperimental.beginFrame',{screenshot:{format,quality:95,optimizeForSpeed:true}})
          : await captureSession.send('Page.captureScreenshot',clipScreenshotOptions(format))
        const data=controlled&&!reference?shot.screenshotData:shot.data
        if(!data)throw new Error('Compositor did not return the requested export frame')
        const elapsed=performance.now()-mark
        metrics.screenshotMs+=elapsed;metrics.screenshotMaxMs=Math.max(metrics.screenshotMaxMs,elapsed)
        metrics.screenshotBuckets[[10,20,33.334,50,100,Infinity].findIndex(limit=>elapsed<limit)]++
        metrics.frames++;metrics.activeStep='done'
        return Buffer.from(data,'base64')
      },
      last:()=>lastFrame
    }
  }
  try {
    const client = await readFile(new URL('../../../../lib/client.js',import.meta.url),'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error
      return readFile(require.resolve('dsh-tavern-plugin/client'), 'utf8')
    })
    scripts={react:await reactScript(),client,stage:stageClientModuleAsScript((await readStageClient()).toString('utf8'))}
    const primary=await bounded(createPass(),'舞台准备',120000)
    if(measureOnly)return {timeline:contentPlan,measured:primary.measured,close}
    capturePasses[0]=primary
    // Capture partitions use paragraph starts from the same measured content clock.
    const planSegments=()=>{
      if(segments)return segments
      if(timeline.at(-1).end!==plan.frames)throw new Error('Export paging does not match frame plan')
      return segments=controlled && fps===30 && process.env.DSH_CLIP_CAPTURE_WORKERS!=='1'
        ? clipCaptureSegments(timeline,plan.frames,captureResources)
        : [{start:0,end:plan.frames}]
    }
    const audioPass=()=>spool?capturePasses.at(-1):primary
    const audioRead={stage:'idle',eventsCalls:0,blobCalls:0,eventCount:0,blobBytes:0}
    primary.metrics.audioRead=audioRead
    const events=async()=>{audioRead.stage='events';audioRead.eventsCalls++;audioRead.startedAt=Date.now();const rows=await audioPass().page.evaluate(()=>window.clipAudioEvents);audioRead.eventCount=rows.length;audioRead.stage='events-done';return rows}
    return {
      timeline:contentPlan,
      async startCapture({directory}) {
        if(planSegments().length<2)return
        spool=await createClipFrameSpool({segments,directory,produce:async(index,write)=>{
          const pass=index?await bounded(createPass(false,true),'分段舞台准备',120000):primary
          capturePasses[index]=pass
          // Persistent projection alone cannot restore active animation/media
          // phases. Reuse the exact replay prefix, without copying its frames.
          for(let frame=0;frame<segments[index].end;frame++) {
            const selected=frame>=segments[index].start
            const image=await bounded(pass.capture(frame,selected),'分段舞台捕帧')
            if(selected)await write(frame,image)
          }
        }})
        if(closing){await spool.close();signal?.throwIfAborted();throw new Error('Export closed')}
      },
      capture:async frame=>{const image=await bounded(spool?spool.read(frame):primary.capture(frame),'舞台捕帧');if(frame===plan.frames-1){await spool?.finish();captureFinished=true}return image},
      captureBoundaries:()=>planSegments().slice(1).flatMap(({start})=>[start-1,start,start+1]),
      metrics:()=>({...primary.metrics,...(spool?{parallel:{mode:'replay-prefix',segments:spool.metrics(),passes:capturePasses.map(pass=>({...pass.metrics}))}}:{}),referenceProgress,lifecycle:[...lifecycle],browserConnected:browser.isConnected(),primaryClosed:primary.page.isClosed(),...(referencePass?{reference:{...referencePass.metrics},referenceClosed:referencePass.page.isClosed()}:{})}),
      async reference(frame,{background=false}={}) {
        referenceInBackground=background
        referencePass ||= await bounded(createPass(true),'校验舞台准备',120000)
        let png
        for(let index=referencePass.last()+1;index<=frame;index++){
          png=await bounded(referencePass.capture(index,index===frame),'校验捕帧')
          reportReference({phase:'verify',step:'reference',frame:index+1,totalFrames:plan.frames})
        }
        return png
      },
      async evidence() {
        const recorded=await events()
        const voiceOnsets=contentPlan.voices.map(voice=>{
          const start=voice.startFrame*fps/contentPlan.fps
          const matches=recorded.filter(event=>event.kind==='play'&&event.layer==='voice'&&event.voiceKey===voice.key&&Math.abs(event.frame-start)<=1)
          if(matches.length!==1)throw new Error(`第 ${voice.turn} 轮第 ${voice.para} 段缺少配音播放证据`)
          const event=matches[0]
          const visiblePass=spool?capturePasses[segments.findIndex(segment=>start>=segment.start&&start<segment.end)]:primary
          const revealFrame=visiblePass.reveals.get(voice.id)
          if(revealFrame===undefined)throw new Error('Missing measured dialogue reveal')
          return {id:voice.id,key:voice.key,turn:voice.turn,para:voice.para,audioFrame:event.frame,revealFrame,durationMs:voice.durationMs}
        })
        const audio=await events(),starts=audio.filter(row=>row.kind==='play'&&row.frame>=0&&row.layer!=='ui')
        const audioLayers=[...new Set(starts.map(row=>row.layer))].map(layer=>{
          const rows=starts.filter(row=>row.layer===layer),ids=new Set(rows.map(row=>row.id))
          return {layer,starts:rows.length,peakGain:audio.filter(row=>ids.has(row.id)).reduce((peak,row)=>Math.max(peak,row.gain ?? row.volume ?? 0),0)}
        })
        return {clock:'virtual',timeline:contentPlan,pageTurns:capturePasses.flatMap((pass,index)=>pass.pageTurns.filter(row=>!spool || row.frame>=segments[index].start&&row.frame<segments[index].end)),referenceTurns:referencePass?.pageTurns || [],nonStageRects:capturePasses.flatMap(pass=>pass.nonStageRects),voiceOnsets,audioLayers}
      },
      audioEvents:events,
      async audioBlob(url) {
        audioRead.stage='blob';audioRead.blobCalls++;audioRead.startedAt=Date.now()
        const base64=await audioPass().page.evaluate(async url=>{const blob=window.clipBlobs.get(url) || await(await fetch(url)).blob();const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary)},url)
        const bytes=Buffer.from(base64,'base64');audioRead.blobBytes+=bytes.length;audioRead.stage='blob-done';return bytes
      },
      diagnostics:()=>audioPass().page.evaluate(()=>window.clipReplay.diagnostics()),
      inspect:primary.inspect,close,debug:()=>({errors:primary.errors,requested:[...primary.requested]})
    }
  } catch(error){await close();throw error}
}
