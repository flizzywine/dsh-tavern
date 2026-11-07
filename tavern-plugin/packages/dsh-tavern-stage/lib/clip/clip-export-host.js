import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {Writable} from 'node:stream'
import {join} from 'node:path'
import {createClipExport} from './clip-export.js'
import {clipRange,clipUserError,clipRenderSpec} from '../domain/clip-export.js'
import {createClipTimeline,verifyClipVoiceGraph} from '../domain/clip-export-timeline.js'
import {createClipBrowser,CLIP_ORIGIN} from './clip-export-browser.js'
import {createAssetPackPresentation} from '../domain/asset-pack-presentation.js'
import {createAssetPackSpeech,NARRATOR_VOICE} from '../../../../lib/domain/asset-pack-speech.js'
import {assetVoiceBinding} from '../../../../lib/domain/figure-voice.js'
import {foldAssetPackEntries} from '../domain/stage-asset-pack-director.js'
import {STAGE_PLAYBACK_FIELD} from '../domain/stage-playback.js'
import {readStageProjection} from '../domain/stage-projection.js'
import {TAVERN_CLIENT_ASSET_PREFIX,readTavernClientAsset} from '../../../../lib/domain/tavern-client-assets.js'
import {readStageClientChunk} from '../client-assets.js'
import {resolveTavernRuntimeAsset} from '../../../../lib/domain/tavern-runtime-assets.js'
import {PACK_LEASE_PATH} from '../../../dsh-asset-library/lib/pack-v2/service.js'

// The carrier supplies existing host readers (paragraphSpeech: a paragraph's spoken line, the core's voice selection);
// browser code receives only a frozen export projection.
export function createClipHost(options) {
  const {readChat,readDisplay,readConfig,paragraphSpeech,readWorkspace,readDirection,library,tts,settings,globalPacks,extras,readHostAsset,readStageResource,readWidgets,performanceKinds,exportsRoot,tempRoot,openFolder,checkDisk}=options
  function consumer(snapshot) {
    let allowedPackIds=[...snapshot.allowedPacks]
    const presentation=createAssetPackPresentation({raw:snapshot.raw,getEngine:()=>snapshot.engine.values,getService:library,
      getAllowedPackIds:()=>allowedPackIds,origin:CLIP_ORIGIN,scope:'dsh-browser'})
    allowedPackIds=[...new Set([...(presentation?.extension.assetBindings.boundPackIds || []),...allowedPackIds])]
    // Bind the library before the speech consumer captures its authority epoch.
    // Lazy first binding otherwise invalidates the very first cached-voice read.
    presentation?.available()
    const speech=createAssetPackSpeech({getLibrary:library,presentation,getEngine:()=>snapshot.engine.values,getTts:tts,scope:'dsh-browser',readOnly:true,
      getBinding:(_ref,voice,flags)=>assetVoiceBinding(tts(),voice,flags)})
    return {presentation,speech,allowedPackIds,close(){speech?.dispose();presentation?.dispose()}}
  }
  async function readSnapshot(sessionId,chatId,range,args) {
    const chat=await readChat(sessionId)
    if(!chat || chat.id!==chatId || chat.sessionId!==sessionId)throw clipUserError('对话与所选内容不匹配，请重新打开对话后选择片段')
    const [display,config,workspace]=await Promise.all([readDisplay(chat),readConfig(chat.cardPath),readWorkspace(chat.cardPath)])
    const paragraphs=display.projections.flatMap(({turn,body})=>(body?.paragraphs || []).filter(row=>!row.pending).map(row=>({turn,para:row.para,kind:row.kind,text:row.text,source:row.source,segment:row.segment}))).sort((a,b)=>a.turn-b.turn || a.para-b.para)
    if(!range)return {chatId,paragraphs}
    const selected=clipRange(paragraphs,range)
    if(selected.length>100)throw clipUserError('一次最多导出 100 段，请缩小范围')
    const snapshot={sessionId,chatId,cardPath:chat.cardPath,from:range.from,config,raw:workspace.raw,engine:structuredClone(settings()),allowedPacks:[...globalPacks()],
      turns:[],paragraphs:[],regeneratedDshTurns:chat.regeneratedDshTurns || {},...await extras(chat)}
    const first=display.projections.findIndex(row=>row.turn===range.from.turn)
    for(const projection of display.projections.slice(Math.max(0,first-20)).filter(row=>row.turn<=range.to.turn)) {
      const direction=await readDirection(chat,projection.turn),record=direction.record || direction.preview,widgets={}
      if(readWidgets && record)for(const at of new Set([1,direction.through,...selected.filter(row=>row.turn===projection.turn).map(row=>row.para)])) {
        if(at>0&&at<=direction.through)widgets[at]=await readWidgets({chat,direction,at,state:foldAssetPackEntries(record,at)})
      }
      snapshot.turns.push({turn:projection.turn,body:projection.body,direction,widgets,
        playback:structuredClone(chat.messages?.find(row=>row.role==='assistant'&&Number(row.turn || (row.greeting?1:0))===projection.turn)?.[STAGE_PLAYBACK_FIELD])})
    }
    const own=consumer(snapshot)
    try {
      for(const paragraph of selected) {
        const line=paragraphSpeech(chat,paragraph,config),speech=line?.input,selectionKey=speech?.selectionKey
        let voiceLookup
        const voice=line?await own.speech?.readCached(line.alias,speech,{onLookup:value=>{voiceLookup=value}}):null
        snapshot.paragraphs.push({...paragraph,voiceLookup,
          missingVoiceCount:speech&&!voice?1:0,...(voice?{voice:{key:voice.key,durationMs:voice.durationMs,loudness:voice.loudness,alias:line.alias,input:speech,selectionKey,language:line.language,audio:Buffer.from(voice.audio).toString('base64')}}:{})})
      }
    } finally {own.close()}
    const plan={...clipRenderSpec(args.presets || [args.preset || '1080p'],snapshot.renderResolution),from:range.from,to:range.to}
    const {renderer}=await createRenderer({snapshot,plan,measureOnly:true})
    try {
      snapshot.timeline=renderer.timeline
      // 旁白配音 reads a narration paragraph page by page; the pages are the stage's, known once measured.
      if(snapshot.config?.narrator && await narratorVoices(snapshot,renderer.measured))snapshot.timeline=createClipTimeline(snapshot.paragraphs,renderer.measured)
      for(const line of snapshot.timeline.lines)Object.assign(snapshot.paragraphs.find(row=>row.turn===line.turn&&row.para===line.para),{frames:line.frames,durationMs:line.durationMs,pageFrames:line.pageFrames})
    } finally {await renderer.close()}
    return snapshot
  }
  // Each narration page's cached narrator voice (pageVoices; null = silent, counted missing). True when any is found.
  async function narratorVoices(snapshot,measured) {
    const own=consumer(snapshot)
    let found=false
    try {
      for(const [index,row] of snapshot.paragraphs.entries()) {
        const texts=measured[index].narration
        if(!texts.some(Boolean))continue
        row.pageVoices=[]
        for(const text of texts) {
          const input={text,mood:'default'},voice=text?await own.speech?.readCached(NARRATOR_VOICE,input):null
          row.pageVoices.push(voice?{key:voice.key,durationMs:voice.durationMs,loudness:voice.loudness,alias:NARRATOR_VOICE,narration:true,input,language:'zh',audio:Buffer.from(voice.audio).toString('base64')}:null)
          if(text&&!voice)row.missingVoiceCount=(row.missingVoiceCount || 0)+1
          found||=!!voice
        }
      }
    } finally {own.close()}
    return found
  }
  const clipVoices=paragraphs=>paragraphs.flatMap(row=>[row.voice,...(row.pageVoices || [])]).filter(Boolean)
  async function createRenderer({snapshot,plan,signal,onProgress,measureOnly=false}) {
    await mkdir(tempRoot,{recursive:true})
    const temporary=await mkdtemp(join(tempRoot,'clip-media-')),tickets=new Set()
    let own,closed=false
    const turn=number=>snapshot.turns.find(row=>row.turn===number)
    const close=async()=>{if(closed)return;closed=true;try{for(const ticket of tickets)library()?.releaseLease(ticket);own?.close()}finally{await rm(temporary,{recursive:true,force:true})}}
    try {
      own=consumer(snapshot)
      const fps=plan.fps || 30
      const voices=async()=>Promise.all(snapshot.timeline.voices.map(async voice=>{
        const cached=clipVoices(snapshot.paragraphs).find(row=>row.key===voice.key)
        const path=join(temporary,voice.key+'.wav');await writeFile(path,Buffer.from(cached.audio,'base64'))
        return {...voice,kind:'voice',path,startFrame:voice.startFrame*fps/snapshot.timeline.fps}
      }))
      const readAsset=async url=>{
        if(url.pathname.startsWith('/clip-voice/')) {
          const voice=clipVoices(snapshot.paragraphs).find(row=>row.key===url.pathname.slice('/clip-voice/'.length))
          return voice?{body:Buffer.from(voice.audio,'base64'),mediaType:'audio/wav'}:null
        }
        if(url.pathname.startsWith(PACK_LEASE_PATH))return clipLeaseAsset(library(),url,tickets)
        const client=await readTavernClientAsset(url.pathname);if(client)return client
        // The stage's lazy chunks (the Live2D module, the skin overlay) load from the replayed stage as on the live page.
        if(url.pathname.startsWith(TAVERN_CLIENT_ASSET_PREFIX)){const chunk=await readStageClientChunk(url.pathname.slice(TAVERN_CLIENT_ASSET_PREFIX.length));if(chunk)return chunk}
        const runtime=await resolveTavernRuntimeAsset(url.pathname);if(runtime)return {body:await readFile(runtime.file),mediaType:runtime.mediaType}
        return readHostAsset(url)
      }
      const projections=[]
      const transport=async(method,args={})=>{
        signal?.throwIfAborted()
        switch(method) {
          case 'getRoundBody':return turn(args.turn)?.body || null
          case 'getStageDirection':return turn(args.turn)?.direction || {phase:'off',token:null,revision:0,generation:0}
          case 'getAssetPackPresentation': {
            const result=await readStageProjection({...args,readOnly:false,
            readPlayback:()=>turn(args.turn)?.playback,writePlayback:async(_direction,value)=>{turn(args.turn).playback=value;return value},live2d:snapshot.live2d,spine:snapshot.spine,performanceEnabled:snapshot.performanceEnabled,
            revision:()=>snapshot.engine.revision,readSettings:()=>snapshot.engine,readDirection:()=>turn(args.turn)?.direction || {token:null},readConsumer:()=>own,
            readModSources:({at})=>turn(args.turn)?.widgets[at] || [],
            readCountdown:({direction,at})=>readStageResource('getStageTimer',{sessionId:snapshot.sessionId,turn:args.turn,at,expectedDirectionToken:direction.token,mode:'history'})})
            projections.push({turn:args.turn,at:args.at,status:result.status,error:result.error});if(projections.length>20)projections.shift()
            return result
          }
          case 'leaseMedia':case 'leaseBundle': {
            const lease=await library()[method]({...args,origin:CLIP_ORIGIN,scope:'dsh-browser'});tickets.add(lease.ticket);return lease
          }
          case 'releaseLease':tickets.delete(args.ticket);return library().releaseLease(args.ticket)
          case 'getStagePerformanceKinds':return {kinds:performanceKinds?.() || []}
          case 'getStageModHistory':return {turns:snapshot.turns.filter(row=>row.direction.modPerformances?.length).map(row=>({turn:row.turn,performances:row.direction.modPerformances})),kinds:performanceKinds?.() || []}
          case 'getModStageViews':return {views:[]}
          case 'getMod':return {manifest:{id:args.modId},config:{}}
          case 'getDialogueBubbles':return {config:snapshot.config,cardPath:snapshot.cardPath}
          case 'getSession':return {view:{chatId:snapshot.chatId,card:{path:snapshot.cardPath},replyProjections:snapshot.turns}}
          case 'getStageItems':case 'readStageModMedia':case 'getStagePhoneThreads':
            if(args.turn!==undefined&&!turn(args.turn))throw new Error('Export resource is outside the snapshot')
            if(!readStageResource)throw new Error('Recorded resource reader unavailable')
            return readStageResource(method,{...args,sessionId:snapshot.sessionId})
          // A clip shows a timer as its saved frame (history), never a live writer.
          case 'getStageTimer':
            if(!turn(args.turn))throw new Error('Export resource is outside the snapshot')
            return readStageResource(method,{...args,sessionId:snapshot.sessionId,mode:'history'})
          case 'getStageTimerLooks':return readStageResource(method,{})
          case 'getStageMusicTracks':return {tracks:[]}
          case 'listFonts':return snapshot.fonts
          case 'getLive2dCoreStatus':case 'getLive2dRuntime':return snapshot.live2dStatus
          case 'getSpineRuntimeStatus':return snapshot.spineStatus
          case 'openAssetPackVoice':return {available:false,diagnostics:['export-cache-only']}
          default:throw new Error('Export read is not supported: '+method)
        }
      }
      const {raw,engine,allowedPacks,...browserSnapshot}=snapshot
      browserSnapshot.turns=browserSnapshot.turns.map(({playback,widgets,...row})=>row)
      const withoutAudio=voice=>{if(!voice)return voice;const {audio,...rest}=voice;return rest}
      browserSnapshot.paragraphs=browserSnapshot.paragraphs.map(row=>({...row,...(row.voice?{voice:withoutAudio(row.voice)}:{}),...(row.pageVoices?{pageVoices:row.pageVoices.map(withoutAudio)}:{})}))
      const renderer=await createClipBrowser({snapshot:browserSnapshot,plan,transport,readAsset,signal,onProgress,onClose:close,measureOnly})
      return {renderer,audio:async()=>{
        const events=await renderer.audioEvents(),tracks=[],active=new Map(),sources=new Map()
        for(const event of events) {
          if(event.frame<0 || event.frame>=plan.frames || event.layer==='ui')continue
          if(event.kind==='play'&&event.url) {
            const old=active.get(event.id);if(old)old.endFrame=event.frame
            const track={...event,id:event.id+':'+event.frame,startFrame:event.frame,endFrame:plan.frames,gains:[]}
            tracks.push(track);active.set(event.id,track)
          } else if(event.kind==='stop') {const track=active.get(event.id);if(track)track.endFrame=event.frame;active.delete(event.id)}
          else if(event.kind==='gain') {const track=active.get(event.id);if(track)track.gains.push({frame:event.frame,gain:event.gain})}
        }
        const result=[]
        for(const track of tracks.filter(row=>row.endFrame>row.startFrame)) {
          let path=sources.get(track.url)
          if(!path){path=join(temporary,'media-'+sources.size+'.bin');await writeFile(path,await renderer.audioBlob(track.url));sources.set(track.url,path)}
          result.push({id:track.id,voiceKey:track.voiceKey,kind:track.layer,path,startFrame:track.startFrame,sourceStartMs:(track.offset || 0)*1000,
            durationMs:(track.endFrame-track.startFrame)*1000/fps,gain:track.volume ?? 1,loop:track.loop,loopStart:track.loopStart,loopEnd:track.loopEnd,gains:track.gains})
        }
        const audio=await voices()
        try {verifyClipVoiceGraph(audio,result,fps)} catch(error) {
          error.processDiagnostics={projections,expected:audio.map(({path,...row})=>row),tracks:tracks.map(({url,gains,...row})=>row),replay:await renderer.diagnostics()};throw error
        }
        for(const voice of audio) {
          const track=result.find(row=>row.voiceKey===voice.key&&Math.abs(row.startFrame-voice.startFrame)<=1)
          Object.assign(track,{id:voice.id,path:voice.path,referencePath:voice.path,startFrame:voice.startFrame,sourceStartMs:0,durationMs:voice.durationMs,plannedDurationMs:voice.durationMs,turn:voice.turn,para:voice.para})
        }
        return result
      }}
    } catch(error) {await close();throw error}
  }
  // Save names use the chat's title (the card name until the player renames the chat).
  const readChatTitle=async sessionId=>{const chat=await readChat(sessionId);return chat && chat.sessionId===sessionId ? {chatId:chat.id,title:chat.title || chat.cardName || ''} : null}
  return createClipExport({readSnapshot,readChatTitle,createRenderer,exportsRoot,tempRoot,openFolder,checkDisk})
}

// Match the HTTP lease adapter: skin transfers request multipart bundles, not
// the entry JSON. Omitting these flags makes browser Response.formData() fail.
export async function clipLeaseAsset(library,url,tickets) {
  const [ticket,...parts]=url.pathname.slice(PACK_LEASE_PATH.length).split('/')
  if(!tickets.has(ticket))throw new Error('Export lease is not owned by this job')
  const response=await library.respondLease({ticket,resource:parts.map(decodeURIComponent).join('/'),request:new Request(url,{headers:{'sec-fetch-site':'same-origin'}}),
    bundle:url.searchParams.get('bundle')==='1',deferFonts:url.searchParams.get('deferFonts')==='1'})
  if(!response.ok)throw new Error('Export media unavailable')
  return {body:Buffer.from(await response.arrayBuffer()),mediaType:response.headers.get('content-type')}
}

// Reuse the normal path-validated asset readers without a listening HTTP server or credentials.
export async function clipServedAsset(serve,url) {
  const chunks=[],res=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done()}})
  let status,headers
  res.writeHead=(code,value)=>{status=code;headers=value;res.headersSent=true}
  const served=await serve({url:url.pathname,method:'GET',headers:{}},res)
  if(!served)return null
  if(status!==200)throw new Error('Export asset unavailable')
  return {body:Buffer.concat(chunks),mediaType:headers['Content-Type']}
}
