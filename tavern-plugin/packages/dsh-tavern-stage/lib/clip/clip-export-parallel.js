import {open,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {availableParallelism,freemem} from 'node:os'

// Paragraph coordinates and frame lengths come from the measured timeline; a split never falls inside a paragraph.
// This partitions work only; it does not derive any stage or audio state.
export function clipCaptureSegments(timeline,frames,{cpus=availableParallelism(),freeBytes=freemem(),workers=3}={}) {
  const count=Math.min(workers,Math.floor(cpus/4),Math.floor((freeBytes/2**30-8)/1.5),Math.floor(frames/600),timeline.filter(row=>row.card===0&&!row.sub).length)
  if(count<2)return [{start:0,end:frames}]
  const boundaries=timeline.filter(row=>row.card===0&&!row.sub&&row.start>0).map(row=>row.start),starts=[0]
  for(let index=1;index<count;index++) {
    const candidates=boundaries.filter(frame=>frame>starts.at(-1)&&frame<frames)
    if(!candidates.length)break
    starts.push(candidates.reduce((best,frame)=>Math.abs(frame-frames*index/count)<Math.abs(best-frames*index/count)?frame:best))
  }
  return starts.map((start,index)=>({start,end:starts[index+1] ?? frames}))
}

// Parallel producers spool compressed JPEGs, never whole segments in RAM. The
// original encoder consumes one exact ordered stream with its existing backpressure.
export async function createClipFrameSpool({segments,directory,produce}) {
  const rows=[]
  let failure,closing
  const fail=error=>{failure ||= error;for(const row of rows){row.waiter?.reject(failure);row.waiter=null}}
  try {
    for(const [index,segment] of segments.entries()) {
      const path=join(directory,`capture-${index}.mjpg`)
      rows.push({...segment,path,file:await open(path,'w+'),offsets:[],bytes:0,waiter:null})
    }
  } catch(error) {await Promise.all(rows.map(async row=>{await row.file.close();await rm(row.path,{force:true})}));throw error}
  const tasks=rows.map((row,index)=>(async()=>{
    await produce(index,async(frame,bytes)=>{
      if(failure)throw failure
      if(frame!==row.start+row.offsets.length||frame>=row.end)throw new Error('Parallel capture frame order mismatch')
      let offset=0
      while(offset<bytes.length){const {bytesWritten}=await row.file.write(bytes,offset,bytes.length-offset,row.bytes+offset);offset+=bytesWritten}
      row.offsets.push({position:row.bytes,length:bytes.length});row.bytes+=bytes.length
      row.waiter?.resolve();row.waiter=null
    })
    if(row.offsets.length!==row.end-row.start)throw new Error('Parallel capture segment is incomplete')
  })().catch(error=>{fail(error);throw error}))
  for(const task of tasks)void task.catch(()=>{})
  return {
    async read(frame) {
      if(failure)throw failure
      const row=rows.find(row=>frame>=row.start&&frame<row.end),index=frame-row.start
      while(!row.offsets[index]) {
        await new Promise((resolve,reject)=>{row.waiter={resolve,reject}})
        if(failure)throw failure
      }
      const {position,length}=row.offsets[index],bytes=Buffer.allocUnsafe(length)
      let offset=0
      while(offset<length){const {bytesRead}=await row.file.read(bytes,offset,length-offset,position+offset);if(!bytesRead)throw new Error('Parallel capture spool is truncated');offset+=bytesRead}
      return bytes
    },
    metrics:()=>rows.map(({start,end,bytes,offsets})=>({start,end,bytes,frames:offsets.length})),
    finish:()=>Promise.all(tasks),
    close:()=>closing ||= (async()=>{fail(new Error('Parallel capture closed'));await Promise.allSettled(tasks);await Promise.all(rows.map(async row=>{await row.file.close();await rm(row.path,{force:true})}))})()
  }
}
