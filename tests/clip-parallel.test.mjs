import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {clipCaptureSegments,createClipFrameSpool} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-parallel.js'

const headroom={cpus:32,freeBytes:20*2**30}
test('parallel capture partitions only canonical paragraph starts, not cards',()=>{
  const timeline=Array.from({length:12},(_,index)=>({start:index*200,card:index%2}))
  const segments=clipCaptureSegments(timeline,2400,headroom)
  assert.deepEqual(segments,[{start:0,end:800},{start:800,end:1600},{start:1600,end:2400}])
  for(const limits of [{cpus:4},{freeBytes:9*2**30},{workers:1}])assert.deepEqual(clipCaptureSegments(timeline,2400,{...headroom,...limits}),[{start:0,end:2400}])
  assert.deepEqual(clipCaptureSegments(timeline.slice(0,2),400,headroom),[{start:0,end:400}])
})

test('a split never falls on a text box card inside a paragraph',()=>{
  // Paragraph starts at 0 and 1300; the cards at 700 and 1000 are pages of the first paragraph's line.
  const timeline=[{start:0,card:0,sub:0},{start:700,card:0,sub:1},{start:1000,card:0,sub:2},{start:1300,card:0,sub:0}]
  assert.deepEqual(clipCaptureSegments(timeline,2000,{...headroom,workers:2}),[{start:0,end:1300},{start:1300,end:2000}])
})

test('out-of-order segment completion yields the exact ordered bytes and cleans compressed spools',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'clip-spool-'));t.after(()=>rm(directory,{recursive:true,force:true}))
  let release
  const gate=new Promise(resolve=>{release=resolve}),completed=[]
  const spool=await createClipFrameSpool({directory,segments:[{start:0,end:2},{start:2,end:4}],produce:async(index,write)=>{
    if(index===0)await gate
    for(let frame=index*2;frame<index*2+2;frame++)await write(frame,Buffer.alloc(70001+frame,frame))
    completed.push(index)
    if(index===1)release()
  }})
  t.after(()=>spool.close())
  for(let frame=0;frame<4;frame++)assert.deepEqual(await spool.read(frame),Buffer.alloc(70001+frame,frame))
  await spool.finish()
  assert.deepEqual(completed,[1,0])
  assert.deepEqual(spool.metrics().map(row=>row.frames),[2,2])
  await spool.close()
  assert.deepEqual(await readdir(directory),[])
})

test('producer failure rejects waiting consumers and never publishes a partial segment',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'clip-spool-fail-'));t.after(()=>rm(directory,{recursive:true,force:true}))
  let reject
  const gate=new Promise((_resolve,fail)=>{reject=fail})
  const spool=await createClipFrameSpool({directory,segments:[{start:0,end:1}],produce:()=>gate})
  const pending=spool.read(0)
  reject(new Error('capture failed'))
  await assert.rejects(pending,/capture failed/)
  await assert.rejects(spool.finish(),/capture failed/)
  await spool.close()
  assert.deepEqual(await readdir(directory),[])
})
