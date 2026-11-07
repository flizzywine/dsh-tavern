import timing from '../../../../src/client/stage-auto-timing.cjs'

// Measured stage cards are the input boundary. Everything downstream reads this
// immutable 30 fps content clock, including 60 fps capture and 15 fps delivery.
export function createClipTimeline(paragraphs, measured) {
  const {clipParagraphFrames,CLIP_TIMING_FPS:fps}=timing
  let frame=0
  const cards=[],lines=[],voices=[]
  for(const [index,row] of paragraphs.entries()) {
    const pages=measured[index].pages
    if(!pages.length || pages.some(page=>!page.length))throw new Error(`无法读取第 ${row.turn} 轮第 ${row.para} 段的舞台分页`)
    // A narration paragraph (旁白配音) has one voice per page (pageVoices, null = silent); a line one over its first page.
    const pageVoices=row.pageVoices
    const counts=clipParagraphFrames(pages,pageVoices?pages.map((_,page)=>pageVoices[page]?.durationMs || 0):row.voice?.durationMs || 0),startFrame=frame
    for(const [page,items] of pages.entries()) {
      const pageStart=frame,voice=pageVoices?.[page]
      for(const [sub,item] of items.entries()) {
        const start=frame;frame+=counts[page][sub]
        cards.push({turn:row.turn,para:row.para,card:page,sub,text:item.text,voiceAt:item.voiceAt,start,end:frame})
      }
      if(voice)voices.push({id:row.turn+':'+row.para+':'+page,turn:row.turn,para:row.para,page,key:voice.key,startFrame:pageStart,durationMs:voice.durationMs,sourceStartMs:0})
    }
    const id=row.turn+':'+row.para
    lines.push({id,turn:row.turn,para:row.para,startFrame,endFrame:frame,frames:frame-startFrame,durationMs:(frame-startFrame)*1000/fps,
      cards:counts,pageFrames:counts.map(page=>page.reduce((a,b)=>a+b,0)),voice:row.voice || pageVoices?.some(Boolean)?'cached':row.missingVoiceCount?'missing':'none'})
    if(row.voice)voices.push({id,turn:row.turn,para:row.para,key:row.voice.key,startFrame,durationMs:row.voice.durationMs,sourceStartMs:0})
  }
  return {version:1,fps,frames:frame,durationMs:frame*1000/fps,lines,cards,voices}
}

// This is a completeness gate, not a loop over whatever the recorder happened to
// produce. A started-but-truncated line is just as incomplete as a missing one.
export function verifyClipVoiceGraph(expected,tracks,fps=30) {
  for(const voice of expected) {
    const matches=tracks.filter(track=>track.voiceKey===voice.key && Math.abs(track.startFrame-voice.startFrame)<=1)
    if(matches.length!==1)throw new Error(`第 ${voice.turn} 轮第 ${voice.para} 段的配音没有完整播放`)
    const track=matches[0]
    if(Math.abs(track.sourceStartMs || 0)>1000/fps || track.durationMs+1000/fps<voice.durationMs)
      throw new Error(`第 ${voice.turn} 轮第 ${voice.para} 段的配音被提前截断`)
  }
}
