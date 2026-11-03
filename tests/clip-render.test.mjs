import test from 'node:test'
import assert from 'node:assert/strict'
import {createClipBrowser,clipChromiumArgs,clipScreenshotOptions} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-browser.js'
import {roundBody} from '../tavern-plugin/lib/domain/round-body.js'
import {readTavernClientAsset} from '../tavern-plugin/lib/domain/tavern-client-assets.js'
import {resolveTavernRuntimeAsset} from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {clipRun} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-process.js'
import stageSkins from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'

test('capture keeps native compositor scheduling and GPU rendering, disabling only the Windows stack sampler',()=>{
  for(const platform of ['win32','linux','darwin']){
    const args=clipChromiumArgs(platform)
    assert.equal(args.includes('--disable-stack-profiler'),platform==='win32')
    assert.ok(args.includes('--mute-audio'))
    assert.ok(!args.includes('--disable-frame-rate-limit'),'unthrottled BeginFrames can strand a new-surface copy')
    assert.ok(!args.includes('--disable-gpu'))
  }
})

test('full viewport capture preserves PNG and JPEG settings without per-frame viewport emulation',()=>{
  assert.deepEqual(clipScreenshotOptions(),{format:'png',captureBeyondViewport:false,optimizeForSpeed:true})
  assert.deepEqual(clipScreenshotOptions('jpeg'),{format:'jpeg',quality:95,captureBeyondViewport:false,optimizeForSpeed:true})
})

test('isolated full production client mounts replay with no host window or synthesis',{timeout:60000},async t=>{
  const body=roundBody([{kind:'markdown',text:'A recorded paragraph.'}],{chatId:'fixture',turn:1})
  const snapshot={sessionId:'export-fixture',chatId:'fixture',cardPath:'cards/fixture.json',from:{turn:1,para:1},config:{characters:[],voice:{enabled:false},stage:{director:false,face:'off',music:false,theme:'classic'}},turns:[{turn:1,body}],paragraphs:[{turn:1,para:1,durationMs:1000,text:'A recorded paragraph.'}]}
  const calls=[],progress=[]
  let holdCleanup=false,notifyCleanup,releaseCleanup
  const cleanupStarted=new Promise(resolve=>{notifyCleanup=resolve}),cleanupGate=new Promise(resolve=>{releaseCleanup=resolve})
  const renderer=await createClipBrowser({snapshot,onClose:async()=>{if(holdCleanup){notifyCleanup();await cleanupGate}},onProgress:value=>progress.push(value),plan:{from:{turn:1,para:1},to:{turn:1,para:1},frames:30,resolution:{width:1280,height:720}},transport:async(method,args)=>{
    calls.push(method)
    switch(method){
      case 'getRoundBody':return body
      case 'getStageDirection':return {phase:'off',revision:0,generation:0,token:null}
      case 'getStageModHistory':return {turns:[]}
      case 'getModStageViews':return {views:[]}
      case 'getStageMusicTracks':return {tracks:[]}
      case 'listFonts':return {fonts:[]}
      case 'getDialogueBubbles':return {config:snapshot.config}
      default:throw new Error('Unexpected export RPC '+method)
    }
  },readAsset:async url=>{
    const client=await readTavernClientAsset(url.pathname);if(client)return client
    const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}
  }})
  t.after(()=>renderer.close())
  assert.deepEqual(progress.filter(row=>row.step==='warmup').map(row=>row.frame),Array.from({length:60},(_,i)=>i+5))
  assert.deepEqual(progress.at(-1),{phase:'prepare',step:'ready',frame:66,totalFrames:66})
  const png=await renderer.capture(0)
  assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a')
  assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[1280,720])
  const visible=await renderer.inspect()
  assert.match(visible.text,/A recorded paragraph\./)
  assert.equal(visible.state.cursor.mode,'replay')
  assert.deepEqual(visible.nonStageRects,[])
  const reference=await renderer.reference(0)
  assert.ok(progress.some(row=>row.phase==='verify'&&row.step==='reference-prepare-resources'))
  assert.equal(progress.filter(row=>row.phase==='prepare').length,68)
  const root=await mkdtemp(join(process.env.DSH_CLIP_TEST_TEMP || tmpdir(),'clip-reference-'));t.after(()=>rm(root,{recursive:true,force:true}))
  await writeFile(join(root,'capture.png'),png);await writeFile(join(root,'reference.png'),reference)
  const {stderr}=await clipRun('ffmpeg',['-hide_banner','-i',join(root,'capture.png'),'-i',join(root,'reference.png'),'-filter_complex','ssim','-frames:v','1','-f','null','-'])
  const ssim=Number(/All:([\d.]+)/.exec(stderr)?.[1]);assert.ok(ssim>=0.995,'independent replay SSIM: '+ssim)
  assert.deepEqual(await renderer.evidence(),{clock:'virtual',timeline:renderer.timeline,pageTurns:[{turn:1,para:1,card:0,sub:0,frame:0}],referenceTurns:[{turn:1,para:1,card:0,sub:0,frame:0}],nonStageRects:[],voiceOnsets:[],audioLayers:[]})
  assert.ok(!calls.some(method=>/synthes|generate|save|notify/.test(method)),JSON.stringify(calls))
  snapshot.turns[0].direction={token:{digest:'recorded-direction-required'}}
  await assert.rejects(renderer.capture(1),/Recorded direction was not admitted/)
  holdCleanup=true
  const closing=renderer.close()
  let secondClosed=false
  const second=renderer.close().then(()=>{secondClosed=true})
  await cleanupStarted
  try {assert.equal(secondClosed,false,'concurrent close must await the existing cleanup')}
  finally {releaseCleanup();await Promise.all([closing,second])}
})

test('resource readiness uses the phase deadline rather than a fixed number of pumps',{timeout:45000},async t=>{
  const body=roundBody([{kind:'markdown',text:'Delayed resource.'}],{chatId:'slow-resource',turn:1})
  const snapshot={sessionId:'slow-resource',chatId:'slow-resource',cardPath:'fixture.json',from:{turn:1,para:1},config:{characters:[],voice:{enabled:false},stage:{director:false,face:'off',music:false,theme:'classic'}},turns:[{turn:1,body}],paragraphs:[{turn:1,para:1,durationMs:1000,text:'Delayed resource.'}]}
  let delayed=false,resolved=false
  const renderer=await createClipBrowser({snapshot,plan:{from:snapshot.from,to:snapshot.from,frames:30,resolution:{width:1280,height:720}},
    transport:async method=>{switch(method){
      case 'getRoundBody':return body
      case 'getStageDirection':return {phase:'off',revision:0,generation:0,token:null}
      case 'getStageModHistory':return {turns:[]}
      case 'getModStageViews':if(!delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,16000));resolved=true}return {views:[]}
      case 'getStageMusicTracks':return {tracks:[]}
      case 'listFonts':return {fonts:[]}
      case 'getDialogueBubbles':return {config:snapshot.config}
      default:throw new Error(method)
    }},readAsset:async url=>{const client=await readTavernClientAsset(url.pathname);if(client)return client;const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}}
  });t.after(()=>renderer.close())
  assert.equal(resolved,true)
  assert.equal((await renderer.capture(0)).toString('hex',0,8),'89504e470d0a1a0a')
  assert.equal((await renderer.inspect()).state.entry,'ready')
})

test('acknowledged JPEG frames visit every canonical card and agree with independent Chromium across rounds',{timeout:60000},async t=>{
  const first='A'.repeat(100)+'!',second='B'.repeat(100)+'!',body=roundBody([{kind:'markdown',text:first+' '+second}],{chatId:'pages',turn:1})
  const last=roundBody([{kind:'markdown',text:'Last recorded round.'}],{chatId:'pages',turn:2})
  const snapshot={sessionId:'pages-session',chatId:'pages',cardPath:'fixture.json',from:{turn:1,para:1},config:{characters:[],voice:{enabled:false},stage:{director:false,face:'off',music:false,theme:'classic'}},
    turns:[{turn:1,body},{turn:2,body:last}],paragraphs:[{turn:1,para:1,pageFrames:[10,10],durationMs:2000/3,text:first+' '+second},{turn:2,para:1,pageFrames:[10],durationMs:1000/3,text:'Last recorded round.'}]}
  const renderer=await createClipBrowser({snapshot,plan:{from:snapshot.from,to:{turn:2,para:1},frames:30,captureFormat:'jpeg',resolution:{width:1280,height:720}},
    transport:async(method,args)=>{switch(method){case 'getRoundBody':return args.turn===1?body:last;case 'getStageDirection':return {phase:'off',revision:0,generation:0,token:null};case 'getStageModHistory':return {turns:[]};case 'getModStageViews':return {views:[]};case 'getStageMusicTracks':return {tracks:[]};case 'listFonts':return {fonts:[]};case 'getDialogueBubbles':return {config:snapshot.config};default:throw new Error(method)}},
    readAsset:async url=>{const client=await readTavernClientAsset(url.pathname);if(client)return client;const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}}
  });t.after(()=>renderer.close())
  // Measured timeline: the long paragraph's two canonical pages (one text box card each), then the next round.
  assert.deepEqual(renderer.timeline.lines.map(row=>row.cards.map(page=>page.length)),[[1,1],[1]])
  const ends=[];let end=0;for(const frames of renderer.timeline.lines.flatMap(row=>row.pageFrames))ends.push(end+=frames)
  const total=ends.at(-1),keep=new Set([0,...ends.flatMap(value=>[value-1,value])].filter(frame=>frame<total))
  const captions=[],shots=new Map(),started=performance.now()
  for(let frame=0;frame<total;frame++){
    const shot=await renderer.capture(frame)
    if(keep.has(frame))shots.set(frame,shot)
    if(ends.includes(frame+1))captions.push((await renderer.inspect()).caption)
  }
  t.diagnostic(`capture ${total} frames: ${(performance.now()-started).toFixed(1)} ms; ${JSON.stringify(renderer.metrics())}`)
  assert.equal(renderer.metrics().frames,total)
  for(const key of ['clockMs','stateMs','screenshotMs'])assert.ok(renderer.metrics()[key]>0,key)
  assert.deepEqual(captions,[first,second,'Last recorded round.'])
  assert.equal((await renderer.inspect()).state.cursor.mode,'replay')
  assert.equal(renderer.metrics().frameSource,process.platform==='win32'?'begin-frame':'screenshot')
  assert.equal(renderer.metrics().screenshotBuckets.reduce((sum,n)=>sum+n,0),total)
  const root=await mkdtemp(join(tmpdir(),'clip-jpeg-reference-'));t.after(()=>rm(root,{recursive:true,force:true}))
  for(const [frame,shot] of shots){
    const captured=join(root,frame+'.jpg'),reference=join(root,frame+'.png')
    await writeFile(captured,shot);await writeFile(reference,await renderer.reference(frame))
    const {stderr}=await clipRun('ffmpeg',['-hide_banner','-i',captured,'-i',reference,'-filter_complex','[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim','-frames:v','1','-f','null','-'])
    const ssim=Number(/All:([\d.]+)/.exec(stderr)?.[1]);assert.ok(ssim>=0.98,`frame ${frame}: ${ssim}`)
  }
  assert.equal(renderer.metrics().reference.frameSource,'screenshot')
})

test('controlled GPU compositor returns every requested WebGL frame, not the previous surface',{timeout:30000,skip:process.platform!=='win32'},async t=>{
  const {chromium}=await import('playwright'),{default:sharp}=await import('sharp')
  const browser=await chromium.launch({headless:true,args:clipChromiumArgs('win32',true)});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:640,height:360}})
  await page.setContent('<style>body{margin:0}</style><canvas width="640" height="360"></canvas>')
  await page.evaluate(()=>{window.gl=document.querySelector('canvas').getContext('webgl2');if(!gl)throw new Error('WebGL2 unavailable');gl.enable(gl.SCISSOR_TEST)})
  const session=await page.context().newCDPSession(page)
  for(let frame=0;frame<120;frame++){
    await page.evaluate(frame=>{for(let bit=0;bit<8;bit++){const value=(frame>>bit)&1;gl.scissor(bit*80,0,80,360);gl.clearColor(value,value,value,1);gl.clear(gl.COLOR_BUFFER_BIT)}},frame)
    const shot=await session.send('HeadlessExperimental.beginFrame',{screenshot:{format:'jpeg',quality:95,optimizeForSpeed:true}})
    assert.ok(shot.screenshotData,`missing frame ${frame}`)
    const {data,info}=await sharp(Buffer.from(shot.screenshotData,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true})
    let decoded=0
    for(let bit=0;bit<8;bit++)if(data[(180*info.width+bit*80+40)*info.channels]>128)decoded|=1<<bit
    assert.equal(decoded,frame,`stale or missing surface at frame ${frame}`)
  }
})

test('controlled capture matches independent replay on an art-skin narration boundary',{timeout:60000},async t=>{
  const narration='She looks quietly at the lunch box and seems to be thinking about something far away.'
  const body=roundBody([{kind:'markdown',text:'@bubble:actor|Actor|calm|[Recorded words.]\n\n'+narration}],{chatId:'layout',turn:1})
  const skin={...stageSkins.BUILTIN_STAGE_SKINS.aero,id:'clip-layout-fixture',art:{screen:576,screenWidth:1024,
    textbox:{images:{plain:'box.png'},body:[0,0,450,180],bottom:20,text:[30,420,90],font:25,lines:3},
    narration:{font:32,pitch:64,veil:178/255,y:288,lines:{fade:.7,stagger:.9,rise:30}}}}
  const base='https://clip-export.invalid/clip-skin/',revision='fixture',form=new FormData(),{default:sharp}=await import('sharp')
  const artImage=await sharp({create:{width:600,height:200,channels:4,background:{r:240,g:240,b:240,alpha:1}}}).png().toBuffer()
  form.set(base+'skin.json',new Blob([JSON.stringify(skin)],{type:'application/json'}),'skin.json')
  form.set(base+'box.png',new Blob([artImage],{type:'image/png'}),'box.png')
  const response=new Response(form),bundle={body:Buffer.from(await response.arrayBuffer()),mediaType:response.headers.get('content-type')}
  const resource={kind:'bundle',identity:'clip-skin-fixture',bundleKey:'skin',revision,ref:{packId:'fixture',kind:'skins',assetId:'skin'}}
  let leases=0
  const snapshot={sessionId:'layout-session',chatId:'layout',cardPath:'fixture.json',from:{turn:1,para:1},
    config:{characters:[{alias:'actor',name:'Actor'}],voice:{enabled:false},stage:{director:false,face:'off',music:false,theme:'aero',skin:{document:skin,resource,entry:'skin.json'}}},
    turns:[{turn:1,body}],paragraphs:[{turn:1,para:1,durationMs:100,text:'Recorded words.'},{turn:1,para:2,durationMs:100,text:narration}]}
  const plan={from:snapshot.from,to:{turn:1,para:2},frames:6,captureFormat:'jpeg',resolution:{width:1920,height:1080}}
  const renderer=await createClipBrowser({snapshot,plan,
    transport:async method=>{switch(method){case 'leaseBundle':leases++;return {ticket:'fixture',revision,url:base+'skin.json',resources:[base+'skin.json',base+'box.png']};case 'releaseLease':return {};case 'getRoundBody':return body;case 'getStageDirection':return {phase:'off',revision:0,generation:0,token:null};case 'getStageModHistory':return {turns:[]};case 'getModStageViews':return {views:[]};case 'getStageMusicTracks':return {tracks:[]};case 'listFonts':return {fonts:[]};case 'getDialogueBubbles':return {config:snapshot.config};default:throw new Error(method)}},
    readAsset:async url=>{if(url.pathname.startsWith('/clip-skin/'))return bundle;const client=await readTavernClientAsset(url.pathname);if(client)return client;const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}}
  });t.after(()=>renderer.close())
  let image
  const first=renderer.timeline.lines[0].frames
  plan.frames=first+renderer.timeline.lines[1].frames
  for(let frame=0;frame<=first;frame++)image=await renderer.capture(frame)
  assert.ok(leases>0,'the real skin bundle must be loaded')
  assert.equal((await renderer.inspect()).caption,narration)
  const root=await mkdtemp(join(tmpdir(),'clip-layout-reference-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const actual=join(root,'actual.jpg'),reference=join(root,'reference.png')
  await writeFile(actual,image);await writeFile(reference,await renderer.reference(first))
  const {stderr}=await clipRun('ffmpeg',['-hide_banner','-i',actual,'-i',reference,'-filter_complex','[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim','-frames:v','1','-f','null','-'])
  const score=Number(/All:([\d.]+)/.exec(stderr)?.[1]);assert.ok(score>=0.98,`first narration frame must use its final native layout: ${score}`)
})

test('paragraph-segment capture replays prefixes and rejoins exact frame order',{timeout:90000,skip:process.platform!=='win32'},async t=>{
  // Each paragraph is several long canonical pages, so the measured timeline (stage auto timing) passes the 600-frame split floor.
  const long=word=>Array.from({length:9},(_,i)=>word+' sentence number '+(i+1)+' keeps the reader on this recorded page for a while.').join(' ')
  const body=roundBody([{kind:'markdown',text:long('First')+'\n\n'+long('Second')}],{chatId:'parallel',turn:1})
  const snapshot={sessionId:'parallel-session',chatId:'parallel',cardPath:'fixture.json',from:{turn:1,para:1},
    config:{characters:[],voice:{enabled:false},stage:{director:false,face:'off',music:false,theme:'classic'}},turns:[{turn:1,body}],
    paragraphs:[{turn:1,para:1,durationMs:20000},{turn:1,para:2,durationMs:20000}]}
  const plan={from:snapshot.from,to:{turn:1,para:2},frames:0,fps:30,captureFormat:'jpeg',resolution:{width:640,height:360}}
  const renderer=await createClipBrowser({snapshot,captureResources:{cpus:16,freeBytes:20*2**30,workers:2},
    plan,
    transport:async method=>{switch(method){case 'getRoundBody':return body;case 'getStageDirection':return {phase:'off',revision:0,generation:0,token:null};case 'getStageModHistory':return {turns:[]};case 'getModStageViews':return {views:[]};case 'getStageMusicTracks':return {tracks:[]};case 'listFonts':return {fonts:[]};case 'getDialogueBubbles':return {config:snapshot.config};default:throw new Error(method)}},
    readAsset:async url=>{const client=await readTavernClientAsset(url.pathname);if(client)return client;const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}}
  })
  const directory=await mkdtemp(join(tmpdir(),'clip-parallel-browser-'))
  t.after(async()=>{await renderer.close();await rm(directory,{recursive:true,force:true})})
  const split=renderer.timeline.lines[0].frames
  plan.frames=split+renderer.timeline.lines[1].frames
  assert.ok(split>=600&&plan.frames-split>=600,JSON.stringify(renderer.timeline.lines))
  await renderer.startCapture({directory})
  assert.deepEqual(renderer.captureBoundaries(),[split-1,split,split+1],'the split falls on the second paragraph, never on a card inside one')
  const samples=new Set([0,split-1,split,split+1,plan.frames-1]),images=new Map()
  for(let frame=0;frame<plan.frames;frame++) {
    const image=await renderer.capture(frame)
    assert.equal(image.readUInt16BE(0),0xffd8)
    if(samples.has(frame))images.set(frame,image)
  }
  const metrics=renderer.metrics()
  assert.equal(metrics.parallel.mode,'replay-prefix')
  assert.deepEqual(metrics.parallel.segments.map(row=>row.frames),[split,plan.frames-split])
  assert.deepEqual(metrics.parallel.passes.map(row=>row.activeFrame),[split-1,plan.frames-1])
  assert.ok(metrics.parallel.passes[1].paragraphs>=2,'the second worker must advance the first paragraph too')
  for(const [frame,image] of images) {
    const actual=join(directory,frame+'.jpg'),reference=join(directory,frame+'.png')
    await writeFile(actual,image);await writeFile(reference,await renderer.reference(frame))
    const {stderr}=await clipRun('ffmpeg',['-hide_banner','-i',actual,'-i',reference,'-filter_complex','[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim','-frames:v','1','-f','null','-'])
    const score=Number(/All:([\d.]+)/.exec(stderr)?.[1]);assert.ok(score>=0.98,`parallel frame ${frame}: ${score}`)
  }
  assert.deepEqual((await renderer.evidence()).nonStageRects,[])
})
