// The caller supplies host-owned paragraphs and replay-clock durations, never UI segmentation.
export const CLIP_MAX_BYTES = 8_388_608
export const CLIP_FPS = 30
export const CLIP_AUDIO_BPS = 96_000
export const CLIP_PRESETS = ['quality','1080p','discord','gif']
export const CLIP_GIF_MAX_MS = 15_000
const MUX_RESERVE = 192 * 1024
const VIDEO_BUDGET = CLIP_MAX_BYTES - MUX_RESERVE
export const CLIP_1080_BPS = 8_000_000
export const CLIP_DISCORD_AUDIO_BPS = 160_000
export const CLIP_QUALITY_FLOORS = {1080:0.040,720:0.045}
export const clipQualityFloor = height => Math.ceil((height===1080?1920:1280)*height*CLIP_FPS*CLIP_QUALITY_FLOORS[height])

// Only deliberate, actionable messages cross the player-facing RPC boundary.
export const clipUserError = message => Object.assign(new Error(message), {clipUserMessage:message})

const CLIP_PRESET_LABELS = {quality:'最高画质','1080p':'1080p',discord:'Discord',gif:'GIF'}
// The file name a player is offered when saving an export: title, round range, preset.
// Exports from before the metadata existed have no range or preset; their date stands in.
export function clipSaveName({title, from, to, preset, ext, index = 0, count = 1, date}) {
  const range = !from || !to ? ''
    : from.turn === to.turn ? `第${from.turn}轮` + (from.para === to.para ? `${from.para}段` : `${from.para}-${to.para}段`)
    : `第${from.turn}轮${from.para}段-第${to.turn}轮${to.para}段`
  const when = !range && date ? `${date.getMonth() + 1}月${date.getDate()}日${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}` : ''
  const base = [String(title || '片段').trim().slice(0, 40), range || when, CLIP_PRESET_LABELS[preset] || ''].filter(Boolean).join(' ')
  return base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/[. ]+$/, '') + (count > 1 && !range ? ` (${index + 1})` : '') + '.' + ext
}

export function clipRange(paragraphs, range) {
  if (!range || typeof range.chatId !== 'string' || !range.chatId || ![range.from, range.to].every(point => Number.isSafeInteger(point?.turn) && point.turn > 0 && Number.isSafeInteger(point?.para) && point.para > 0)) throw clipUserError('请选择有效的起止段落')
  const at = point => paragraphs.findIndex(row => row.turn === point.turn && row.para === point.para)
  const from = at(range.from), to = at(range.to)
  if (from < 0 || to < from) throw clipUserError('所选范围已不可用，请重新选择起止段落')
  return paragraphs.slice(from, to + 1)
}

export function clipVideoBitrate(frames) {
  return Math.floor(VIDEO_BUDGET * 8 * CLIP_FPS / frames - CLIP_DISCORD_AUDIO_BPS)
}

export function clipDiscordSettings(frames) {
  const available=clipVideoBitrate(frames)
  const step=available>=CLIP_1080_BPS?1:available>=clipQualityFloor(1080)?2:3
  const resolution=step===3?{width:1280,height:720}:{width:1920,height:1080}
  const videoBitrate=Math.min(available,step===3?4_000_000:CLIP_1080_BPS)
  return {step,resolution,videoBitrate,bpppf:videoBitrate/(resolution.width*resolution.height*CLIP_FPS),belowQualityFloor:videoBitrate<clipQualityFloor(resolution.height)}
}

export function clipRenderSpec(presets=['1080p'],native={width:1920,height:1080}) {
  const quality=presets.includes('quality'),gif=presets.length===1&&presets[0]==='gif'
  const scale=Math.min(1,2560/native.width,1440/native.height)
  return {captureFormat:quality?'png':'jpeg',fps:quality?60:30,resolution:quality?{width:Math.floor(native.width*scale/2)*2,height:Math.floor(native.height*scale/2)*2}:gif?{width:720,height:Math.round(720*native.height/native.width/2)*2}:{width:1920,height:1080}}
}

export function planClipExport(paragraphs, range, preset = '1080p', native = {width:1920,height:1080}) {
  if (!CLIP_PRESETS.includes(preset)) throw clipUserError('请选择一种导出格式')
  const selected = clipRange(paragraphs, range)
  const counts = selected.map(row => {
    if (!Number.isFinite(row.durationMs) || row.durationMs <= 0) throw clipUserError('所选内容还不能导出，请等这一轮结束后重试')
    return row.frames ?? Math.ceil(row.durationMs * CLIP_FPS / 1000)
  })
  const totalFrames = counts.reduce((a,b) => a+b,0)
  if (preset === 'gif' && totalFrames * 1000 / CLIP_FPS > CLIP_GIF_MAX_MS) throw clipUserError('GIF 最多 15 秒，请缩小所选段落范围')
  const scale = Math.min(1,2560/native.width,1440/native.height)
  const renderResolution = {width:Math.floor(native.width*scale/2)*2,height:Math.floor(native.height*scale/2)*2}
  const files = []
  let group = [], frames = 0, startFrame = 0
  const seal = () => {
    if (!group.length) return
    const fps = preset === 'quality' ? 60 : preset === 'gif' ? 15 : CLIP_FPS
    const discord=clipDiscordSettings(frames)
    const resolution = preset === 'discord' ? discord.resolution : preset === 'quality' ? renderResolution : preset === 'gif' ? {width:720,height:Math.round(720*renderResolution.height/renderResolution.width/2)*2} : {width:1920,height:1080}
    const videoBitrate = preset === 'quality' ? (resolution.height>1080?32_000_000:20_000_000) : preset === '1080p' ? 8_000_000 : preset === 'gif' ? 4_000_000 : discord.videoBitrate
    const audioBitrate = preset === 'quality' ? 192_000 : preset === 'gif' ? 0 : CLIP_DISCORD_AUDIO_BPS
    const outputFrames = Math.ceil(frames * fps / CLIP_FPS)
    files.push({preset,...(preset==='discord'?discord:{}),format:preset === 'gif' ? 'gif' : 'mp4',maxBytes:preset === 'discord' ? CLIP_MAX_BYTES : null,
      from:{turn:group[0].turn,para:group[0].para},to:{turn:group.at(-1).turn,para:group.at(-1).para},resolution,fps,frames:outputFrames,startFrame,sourceFrames:frames,
      durationMs:outputFrames * 1000 / fps,videoBitrate,audioBitrate,estBytes:Math.ceil((videoBitrate + audioBitrate) * outputFrames / fps / 8 + MUX_RESERVE)})
    startFrame += frames; group = []; frames = 0
  }
  selected.forEach((paragraph,index) => {
    const count = counts[index]
    if (preset === 'discord') {
      if (clipVideoBitrate(count) <= 0) throw clipUserError(`第 ${paragraph.turn} 轮第 ${paragraph.para} 段太长，无法存为 8 MB 以内的文件，请改选 1080p 导出`)
      // Positive durations and a fixed floor make maximal-prefix packing the fewest contiguous files.
      if (group.length && clipVideoBitrate(frames + count) < clipQualityFloor(720)) seal()
      group.push(paragraph); frames += count
      if (clipVideoBitrate(count) < clipQualityFloor(720)) seal()
    } else { group.push(paragraph); frames += count }
  })
  seal()
  const missingVoiceCount = selected.reduce((sum, row) => sum + (row.missingVoiceCount || 0), 0)
  const warnings=preset==='gif'?[]:missingVoiceCount?[`${missingVoiceCount} 处对白或旁白还没有配音，导出时将保持静音`]:[]
  if(files.some(row=>row.belowQualityFloor))warnings.push('单个段落较长，已保留完整内容并缩小文件，文字可能不够清晰')
  return {preset,...(preset==='discord'?{step:files.length>1?4:files[0].step,qualityFloors:CLIP_QUALITY_FLOORS}:{}),maxDurationMs:preset === 'gif' ? CLIP_GIF_MAX_MS : null,durationMs:totalFrames * 1000 / CLIP_FPS,missingVoiceCount,
    warnings,plannedFiles:files,
    renderPlan:{...clipRenderSpec([preset],native),from:files[0].from,to:files.at(-1).to,frames:totalFrames*(preset==='quality'?2:1),durationMs:totalFrames*1000/CLIP_FPS}}
}

// Batch delivery shares one master; its GIF uses the first complete paragraphs within the limit.
export function planClipExportBatch(paragraphs, range, presets, native) {
  if (!Array.isArray(presets) || !presets.length || presets.length>CLIP_PRESETS.length || new Set(presets).size!==presets.length || presets.some(value=>!CLIP_PRESETS.includes(value))) throw clipUserError('请选择一种导出格式')
  const full=planClipExport(paragraphs,range,presets.includes('quality')?'quality':'1080p',native), selected=clipRange(paragraphs,range)
  const plans=presets.map(preset=>{
    if(preset!=='gif')return planClipExport(paragraphs,range,preset,native)
    let frames=0, last
    for(const row of selected){const count=row.frames ?? Math.ceil(row.durationMs*CLIP_FPS/1000);if((frames+count)*1000/CLIP_FPS>CLIP_GIF_MAX_MS)break;frames+=count;last=row}
    if(!last)throw clipUserError('首段超过 GIF 的 15 秒限制，请换选更短的内容或改选视频导出')
    return planClipExport(paragraphs,{...range,to:{turn:last.turn,para:last.para}},preset,native)
  })
  return {...full,renderPlan:{...full.renderPlan,...clipRenderSpec(presets,native)},preset:'multiple',plannedFiles:plans.flatMap(plan=>plan.plannedFiles)}
}

export function verifyClipProbe(probe, plan, bytes) {
  const video = probe.streams?.filter(row => row.codec_type === 'video') || []
  const audio = probe.streams?.filter(row => row.codec_type === 'audio') || []
  const maxBytes = plan.maxBytes === undefined ? CLIP_MAX_BYTES : plan.maxBytes
  if (bytes <= 0 || maxBytes && bytes > maxBytes) throw new Error('导出文件超过 8 MB 或为空')
  const v = video[0], a = audio[0], fps = plan.fps || CLIP_FPS
  if (plan.format === 'gif') {
    if (video.length !== 1 || audio.length || v.codec_name !== 'gif' || probe.format?.format_name !== 'gif') throw new Error('导出格式不符合无声 GIF 要求')
    if (v.width !== plan.resolution.width || v.height !== plan.resolution.height || Number(v.nb_read_frames) !== plan.frames || Math.abs(Number(probe.format.duration)-plan.durationMs/1000)>0.02) throw new Error('GIF 分辨率、帧数或时长不符合计划')
  } else {
    if (video.length !== 1 || audio.length !== 1 || v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p' || a.codec_name !== 'aac') throw new Error('导出格式不符合 H.264 / AAC 要求：'+video.map(row=>row.codec_name+'/'+row.pix_fmt).join(',')+'; audio='+audio.map(row=>row.codec_name).join(','))
    if (v.width !== plan.resolution.width || v.height !== plan.resolution.height || v.height < 720 || v.r_frame_rate !== fps+'/1' || v.avg_frame_rate !== fps+'/1') throw new Error('导出分辨率或帧率不符合计划')
    if (Number(v.nb_read_frames) !== plan.frames || Math.abs(Number(v.duration) - plan.frames / fps) > 0.001) throw new Error('导出帧数不完整')
    if (Math.abs(Number(v.start_time)) > 1 / fps || Math.abs(Number(a.start_time)) > 1 / fps) throw new Error('导出音画起点未对齐')
    if (Math.abs(Number(a.duration) - plan.frames / fps) > 1 / fps) throw new Error('导出音轨时长未对齐')
    if (!probe.format?.format_name?.split(',').includes('mp4')) throw new Error('导出容器不是 MP4')
  }
  return {bytes,frames:plan.frames,width:v.width,height:v.height,fps,durationMs:plan.durationMs}
}
