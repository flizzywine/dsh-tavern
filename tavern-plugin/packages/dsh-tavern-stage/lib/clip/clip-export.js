import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { CLIP_FPS, CLIP_MAX_BYTES, CLIP_PRESETS, CLIP_GIF_MAX_MS, clipSaveName, clipUserError, clipRange, planClipExport, planClipExportBatch } from '../domain/clip-export.js'
import { encodeClip, renderClip } from './clip-export-encode.js'

export const CLIP_EXPORT_METHODS = ['getClipExportParagraphs','estimateClipExport','startClipExport','getClipExportJob','cancelClipExport','openClipExportFolder','listClipExports']
const CLIP_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CLIP_FILE_NAME = /^clip-\d{2}\.(?:mp4|gif)$/
// The job folder's own record of what it holds (written once the export completes); names survive restarts.
const CLIP_RECORD = '.clip.json'

export async function checkClipDisk(volume) {
  const disk = await statfs(volume,{bigint:true})
  if (disk.bavail * disk.bsize < 100n * 1024n ** 3n) throw clipUserError('I: 剩余空间不足，请先腾出至少 100 GB 空间再导出')
}

// All adapters are host-owned. RPC arguments can never select a path, process, URL or render script.
export function createClipExport({readSnapshot,readChatTitle,createRenderer,exportsRoot,tempRoot,openFolder,checkDisk,encode = encodeClip,render = renderClip,prepareTimeoutMs = 120000,progressTimeoutMs = 30000}) {
  const jobs = new Map()
  let chain = Promise.resolve(), disposed = false
  const get = (sessionId, jobId) => {
    const job = jobs.get(jobId)
    if (!job || job.sessionId !== sessionId) throw clipUserError('找不到这次导出，请重新选择片段并导出')
    return job
  }
  const publicJob = job => structuredClone({jobId:job.jobId,state:job.state,progress:job.progress,result:job.result,error:job.error,timings:job.timings})
  async function snapshot(args) {
    if (typeof args?.sessionId !== 'string' || !args.sessionId) throw clipUserError('请先打开要导出的对话')
    const value = await readSnapshot(args.sessionId, args.range?.chatId || args.chatId, args.range,args)
    if (!value || value.chatId !== (args.range?.chatId || args.chatId)) throw clipUserError('所选范围与当前对话不匹配，请重新选择片段')
    return structuredClone(value)
  }
  // One chat's export folder, for the session that owns the chat (a session reads only its own chat's exports).
  async function chatFolder(sessionId) {
    const chat = typeof sessionId === 'string' && sessionId ? await readChatTitle(sessionId) : null
    if (!chat) throw clipUserError('请先打开要导出的对话')
    return {...chat, folder:join(exportsRoot,'chat-' + encodeURIComponent(chat.chatId))}
  }
  // Finished exports on disk, newest first: this process's jobs and older ones alike. Each file carries the name a
  // save offers and the URL it streams from (GET /dsh-tavern-stage/clip-file, clip-export-stage.js).
  async function listExports(sessionId) {
    const {title, folder} = await chatFolder(sessionId)
    const rows = []
    for (const jobId of await readdir(folder).catch(() => [])) {
      if (!CLIP_JOB_ID.test(jobId) || jobs.get(jobId) && jobs.get(jobId).state !== 'completed') continue
      const dir = join(folder, jobId)
      const names = (await readdir(dir).catch(() => [])).filter(name => CLIP_FILE_NAME.test(name)).sort()
      if (!names.length) continue
      // Exports from before the folder record existed: the run's receipt, when it is still in the temp root.
      let record = await readFile(join(dir, CLIP_RECORD), 'utf8').then(JSON.parse, () => null)
      if (!record) {
        const receipt = await readFile(join(tempRoot, `clip-${jobId}.json`), 'utf8').then(JSON.parse, () => null)
        if (receipt && receipt.state !== 'completed') continue
        record = receipt ? {...receipt.request, files:(receipt.result?.files || []).map(file => ({...file, file:basename(file.path || '')}))} : {}
      }
      const files = []
      for (const name of names) {
        const info = await stat(join(dir, name))
        const own = record.files?.find(file => file.file === name) || {}
        files.push({file:name, bytes:info.size, mtime:info.mtimeMs, from:own.from || record.from, to:own.to || record.to, preset:own.preset || record.preset})
      }
      const date = new Date(Math.max(...files.map(file => file.mtime)))
      rows.push({jobId, finishedAt:date.toISOString(), files:files.map((file, index) => ({
        file:file.file, name:clipSaveName({title, from:file.from, to:file.to, preset:file.preset, ext:extname(file.file).slice(1), index, count:files.length, date}),
        bytes:file.bytes, type:file.file.endsWith('.gif') ? 'image/gif' : 'video/mp4',
        url:'/dsh-tavern-stage/clip-file?' + new URLSearchParams({sessionId, jobId, file:file.file})}))})
    }
    return rows.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  }
  const planFor=(value,args)=>args.presets ? planClipExportBatch(value.paragraphs,args.range,args.presets,value.renderResolution) : planClipExport(value.paragraphs,args.range,args.preset,value.renderResolution)
  async function run(job, value, plan) {
    const {signal} = job.abort
    let rendered, ownedRenderer, rendering, encoding, stallTimer, terminalState='failed', lastProgressAt=Date.now(), phase='prepare', step='prepare'
    const startedAt=lastProgressAt
    job.timings={startedAt:new Date(startedAt).toISOString(),phaseMs:{},stepMs:{},totalMs:0}
    let checkpointAt=0,checkpointWrite=Promise.resolve()
    const checkpoint=state=>{
      checkpointAt=Date.now()
      const text=JSON.stringify({...publicJob(job),request:{chatId:value.chatId,from:plan.renderPlan.from,to:plan.renderPlan.to,preset:plan.preset},...(job.diagnostic?{diagnostic:job.diagnostic}:{}),...(state?{state}:{})},null,2),path=join(tempRoot,`clip-${job.jobId}.json`)
      // Serialize atomic receipts so a restart cannot erase the last phase or
      // let an older in-flight write replace the terminal result.
      checkpointWrite=checkpointWrite.then(async()=>{await mkdir(tempRoot,{recursive:true});await writeFile(path+'.tmp',text);await rename(path+'.tmp',path)}).catch(()=>{})
      return checkpointWrite
    }
    const record=()=>{
      const now=Date.now(),delta=now-lastProgressAt
      job.timings.phaseMs[phase]=(job.timings.phaseMs[phase] || 0)+delta
      job.timings.stepMs[step]=(job.timings.stepMs[step] || 0)+delta
      job.timings.totalMs=now-startedAt;lastProgressAt=now
    }
    const progress=value=>{
      if(signal.aborted)return
      const phaseChanged=value.phase!==job.progress.phase
      const moved=phaseChanged || value.step!==job.progress.step || value.frame!==job.progress.frame
      record();phase=value.phase || phase;step=phase+':'+(value.step || '')
      job.progress={...job.progress,...value,updatedAt:new Date().toISOString()}
      if(phaseChanged || Date.now()-checkpointAt>=5000)void checkpoint()
      if(moved){
        clearTimeout(stallTimer)
        const timeout=phase==='prepare'||step.startsWith('verify:reference-prepare-')?prepareTimeoutMs:progressTimeoutMs
        stallTimer=setTimeout(()=>job.abort.abort(Object.assign(new Error(`导出${{prepare:'准备',render:'渲染',encode:'编码',verify:'校验'}[phase]}连续 ${Math.round(timeout/1000)} 秒没有进展，已终止并清理；请重试导出`),{code:'CLIP_PROGRESS_TIMEOUT'})),timeout)
      }
    }
    const wait=async task=>{
      let abort
      try{return await Promise.race([task,new Promise((resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})])}
      finally{signal.removeEventListener('abort',abort)}
    }
    try {
      signal.throwIfAborted()
      await checkDisk()
      job.state = 'running'
      await mkdir(job.folder,{recursive:true})
      let prepareTimer, abortPreparation
      const preparing = Promise.resolve().then(() => createRenderer({snapshot:value,plan:plan.renderPlan,signal,
        onProgress:progress}))
      // An adapter can complete after cancellation; it must never leave an orphan browser behind.
      void preparing.then(value => {if(signal.aborted)return value.renderer.close()},()=>{}).catch(()=>{})
      let prepared
      try {
        prepared = await Promise.race([preparing,new Promise((resolve,reject)=>{
          abortPreparation=()=>reject(signal.reason)
          signal.addEventListener('abort',abortPreparation,{once:true})
          if(signal.aborted)return abortPreparation()
          prepareTimer=setTimeout(()=>job.abort.abort(Object.assign(new Error('舞台准备超时，请重试导出；若仍失败，请查看本地导出诊断'),{code:'CLIP_PREPARE_TIMEOUT'})),prepareTimeoutMs)
        })])
      } finally {clearTimeout(prepareTimer);signal.removeEventListener('abort',abortPreparation)}
      const {renderer,audio} = prepared
      ownedRenderer=renderer
      const files = [], verification = [], warnings = [...plan.warnings]
      const referenceFrames = [0]
      for(const card of value.timeline?.cards || [])for(const frame of [card.start-1,card.start,card.start+1]) {
        if(frame>=0&&frame<value.timeline.frames)referenceFrames.push(frame*plan.renderPlan.fps/value.timeline.fps)
      }
      for (const part of plan.plannedFiles) for (const frame of [Math.floor(part.frames/2),part.frames-1]) {
        referenceFrames.push(part.startFrame*plan.renderPlan.fps/CLIP_FPS+frame*plan.renderPlan.fps/part.fps)
      }
      progress({phase:'render',step:'capture',frame:0,totalFrames:plan.renderPlan.frames})
      rendering=render({plan:plan.renderPlan,plannedFiles:plan.plannedFiles,renderer,audio,tempRoot,signal,referenceFrames,onProgress:progress})
      void rendering.then(value=>{if(signal.aborted)return value.close()},()=>{}).catch(()=>{})
      rendered = await wait(rendering)
      // Encode the duration/size-budget plan directly; only measured overflow replans it.
      for (let index=0;index<plan.plannedFiles.length;index++) {
        const part=plan.plannedFiles[index]
        signal.throwIfAborted()
        await checkDisk()
        progress({phase:'encode',step:'prepare',frame:0,totalFrames:part.frames,file:index,totalFiles:plan.plannedFiles.length})
        let result
        try {
          encoding=encode({plan:part,rendered,outputPath:join(job.folder,`clip-${String(index + 1).padStart(2,'0')}.${part.format}`),tempRoot,signal,onProgress:progress})
          result = await wait(encoding)
        } catch(error) {
          if(error.code!=='CLIP_SIZE_REPLAN' || part.preset!=='discord' || signal.aborted)throw error
          const rows=clipRange(value.paragraphs,{chatId:value.chatId,from:part.from,to:part.to})
          if(rows.length<2)throw clipUserError('这一段无法存为 8 MB 以内的文件，请改选 1080p 导出')
          const split=planClipExport(rows,{chatId:value.chatId,from:part.from,to:part.to},'discord').plannedFiles
          if(split.length===1){
            const tail=rows.at(-1),head=rows.slice(0,-1)
            split.splice(0,1,...[head,[tail]].flatMap(group=>planClipExport(group,{chatId:value.chatId,from:group[0],to:group.at(-1)},'discord').plannedFiles))
          }
          let startFrame=part.startFrame
          for(const item of split){item.startFrame=startFrame;startFrame+=item.sourceFrames}
          plan.plannedFiles.splice(index,1,...split)
          warnings.push('已根据文件实测大小重新编码或按段拆分');index--;continue
        }
        files.push(result.file);verification.push(result.verification);warnings.push(...result.warnings)
      }
      signal.throwIfAborted()
      await rendered.close();rendered=null
      job.result = {preset:plan.preset,files,folder:job.folder,timeline:value.timeline,missingVoiceCount:plan.missingVoiceCount,warnings:[...new Set(warnings)],verification}
      await writeFile(join(job.folder,CLIP_RECORD),JSON.stringify({from:plan.renderPlan.from,to:plan.renderPlan.to,preset:plan.preset,
        files:plan.plannedFiles.map((part,index)=>({file:`clip-${String(index + 1).padStart(2,'0')}.${part.format}`,preset:part.preset,from:part.from,to:part.to}))}))
      terminalState = 'completed'
    } catch (error) {
      try {const capture=ownedRenderer?.metrics?.();if(capture)job.progress.capture={...job.progress.capture,...capture}} catch { /* Diagnostics must not hide the failure. */ }
      if(signal.aborted && signal.reason?.name!=='AbortError')error=signal.reason
      const cancelled = signal.aborted && signal.reason?.name === 'AbortError'
      job.diagnostic=cancelled?null:{message:error.message,code:error.code || null,details:error.processDiagnostics || null}
      const detail=error.clipUserMessage || (job.progress.phase==='prepare'
        ? '画面还没准备好，请稍后重试导出'
        : '这次没能做好视频，请重试导出；若仍失败，请换选较短的片段')
      job.error = cancelled ? null : '导出未完成：' + detail
      // Keep bounded local diagnostics outside the deleted output folder, never expose media paths in RPC errors.
      try {
        if(!cancelled)await mkdir(tempRoot,{recursive:true})
          .then(()=>writeFile(join(tempRoot,`clip-${job.jobId}.error.log`),JSON.stringify(job.progress)+'\n'+String(error.stack || error).slice(-16000)+'\n'+JSON.stringify(error.processDiagnostics || null)))
          .catch(()=>{}) // A diagnostic write must not hide the original failure or block cleanup.
        await Promise.allSettled([rendering?.cleanup,encoding?.cleanup])
        await rm(job.folder,{recursive:true,force:true})
      } finally {terminalState = cancelled ? 'cancelled' : 'failed'}
    } finally {
      clearTimeout(stallTimer)
      if(rendered)await rendered.close()
      await ownedRenderer?.close?.()
      record();job.timings.finishedAt=new Date().toISOString()
      await checkpoint(terminalState)
      job.state=terminalState
    }
  }
  return {
    activity() {
      const activeJobs=[...jobs.values()].filter(job=>['queued','running'].includes(job.state)).length
      return {busy:activeJobs>0,activeJobs}
    },
    async call(method, args = {}) {
      try {
      if (disposed) throw clipUserError('导出暂时不可用，请重新打开应用后再试')
      switch (method) {
        case 'getClipExportParagraphs': {
          const value = await snapshot(args)
          return {chatId:value.chatId,paragraphs:value.paragraphs.map(({turn,para,text}) => ({turn,para,text})),maxBytes:CLIP_MAX_BYTES,fps:CLIP_FPS,presets:CLIP_PRESETS,gifMaxDurationMs:CLIP_GIF_MAX_MS}
        }
        case 'estimateClipExport': {
          const value = await snapshot(args)
          return {...planFor(value,args),timeline:value.timeline,voiceLookups:value.paragraphs.filter(row=>row.voiceLookup).map(row=>({turn:row.turn,para:row.para,...row.voiceLookup})),voiceCache:{chatId:value.chatId,keys:[...new Set(clipRange(value.paragraphs,args.range).flatMap(row=>[row.voice?.key,...(row.pageVoices || []).map(voice=>voice?.key)]).filter(Boolean))]}}
        }
        case 'startClipExport': {
          const value = await snapshot(args), plan = planFor(value,args)
          await checkDisk()
          // Admission is synchronous after the disk read, including concurrent RPC requests.
          if ([...jobs.values()].filter(job => ['queued','running'].includes(job.state)).length >= 3) throw clipUserError('正在导出的片段较多，请等当前任务完成后再试')
          const jobId = randomUUID(), folder = join(exportsRoot,'chat-' + encodeURIComponent(value.chatId),jobId)
          const job = {jobId,sessionId:args.sessionId,folder,state:'queued',progress:{phase:'prepare',frame:0,totalFrames:0,file:0,totalFiles:plan.plannedFiles.length},result:null,error:null,abort:new AbortController()}
          for (const [id, old] of jobs) { if (jobs.size < 20) break; if (!['queued','running'].includes(old.state)) jobs.delete(id) }
          jobs.set(jobId,job)
          chain = chain.then(() => run(job,value,plan)).catch(error => { job.state = 'failed';job.diagnostic={message:error.message};job.error = '导出未完成，请稍后重新导出' })
          return {jobId}
        }
        case 'getClipExportJob': return publicJob(get(args.sessionId,args.jobId))
        case 'listClipExports': return {exports:await listExports(args.sessionId)}
        case 'cancelClipExport': {
          const job = get(args.sessionId,args.jobId)
          if (['queued','running'].includes(job.state)) job.abort.abort(new DOMException('Cancelled','AbortError'))
          return {cancelled:true}
        }
        case 'openClipExportFolder': {
          const job = get(args.sessionId,args.jobId)
          if (job.state !== 'completed') throw clipUserError('请等导出完成后再打开文件夹')
          await openFolder(job.folder)
          return {opened:true}
        }
        default: throw new Error('Unknown clip export operation')
      }
      } catch(error) {
        throw new Error('无法导出：'+(error.clipUserMessage || (method==='openClipExportFolder'
          ? '文件夹没能打开，请稍后再试'
          : '暂时无法完成操作，请关闭导出面板后重新选择片段')),{cause:error})
      }
    },
    // GET /dsh-tavern-stage/clip-file: one finished file of this session's chat, by job id and file name only.
    async file({sessionId, jobId, file}) {
      if (!CLIP_JOB_ID.test(String(jobId)) || !CLIP_FILE_NAME.test(String(file))) return null
      const {folder} = await chatFolder(sessionId)
      const found = (await listExports(sessionId)).find(item => item.jobId === jobId)?.files.find(item => item.file === file)
      return found ? {path:join(folder, jobId, file), size:found.bytes, name:found.name, mediaType:found.type} : null
    },
    async dispose() {
      disposed = true
      for (const job of jobs.values()) if (['queued','running'].includes(job.state)) job.abort.abort(new DOMException('Disposed','AbortError'))
      await chain
    }
  }
}
