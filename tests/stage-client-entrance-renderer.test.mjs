import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),base='../tavern-plugin/packages/dsh-tavern-stage/src/client/'
const {entrancePlateFrames}=require(base+'entrance-frames.cjs')
const {entranceLoop}=require(base+'entrance-loop.cjs')
const {createStageEntranceRenderer}=require(base+'entrance-runtime.cjs')
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('entrance frame decoder releases partial failures and late bitmaps and stops decoding after disposal',async()=>{
 let closed=0,calls=0,finish
 const frames=entrancePlateFrames({color:['a'],shift:['b']},1,async name=>{calls++;if(name==='b')throw Error('bad shift');return {close(){closed++}}})
 frames.want(0);await flush();assert.equal(closed,1);assert.equal(frames.want(0),null);assert.equal(calls,2);frames.dispose()
 const late=entrancePlateFrames({color:['a']},1,()=>new Promise(resolve=>finish=resolve))
 late.want(0);await Promise.resolve();late.dispose();finish({close(){closed++}});await flush()
 assert.equal(closed,2);assert.equal(late.want(0),null)
})
test('entrance loop clears frame scheduling and context listener when context is lost',()=>{
 const listeners=new Map(),posts=[],cancelled=[];let destroyed=0,draws=0,callback
 const canvas={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}
 const loop=entranceLoop({stageEntranceStart:()=>({})},()=>({size(){},dispose(){destroyed++},draw(){draws++}}),()=>{},
  {canvas,doc:{},size:[100,100],raf(fn){callback=fn;return 7},cancel:id=>cancelled.push(id),post:event=>posts.push(event)})
 listeners.get('webglcontextlost')({preventDefault(){}})
 callback(20);loop.message({type:'stop'});loop.message({type:'size',size:[20,20]})
 assert.equal(destroyed,1);assert.equal(draws,0);assert.equal(listeners.size,0);assert.deepEqual(cancelled,[7]);assert.equal(posts[0].type,'error')
})
test('worker scope revokes URL, terminates all runs and fences retained event callbacks',()=>{
 const workers=[],revoked=[],events=[]
 class Worker{constructor(){workers.push(this);this.messages=[];this.stops=0}postMessage(m){this.messages.push(m)}terminate(){this.stops++}}
 const window={Worker,OffscreenCanvas:class{},WebGL2RenderingContext:class{},Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)}}
 const module=createStageEntranceRenderer({window,contractFactory:()=>({}),renderer:()=>{},frames:()=>{},loop:()=>{}})
 const port=module.start({transferControlToOffscreen:()=>({})},{doc:{},options:{}},[10,10],event=>events.push(event)),worker=workers[0],late=worker.onmessage
 assert.deepEqual(revoked,['blob:test']);late({data:{type:'started'}});module.dispose();late({data:{type:'done'}});port.input({ready:true});port.stop()
 assert.equal(worker.stops,1);assert.equal(worker.messages.length,1);assert.deepEqual(events,[{type:'started'}]);assert.equal(module.supported(),false)
 assert.throws(()=>module.start({},{}),/disposed/)
})
test('worker construction failure revokes URL and falls back to a disposable local loop',()=>{
 let revoked=0,stops=0
 const window={Worker:class{constructor(){throw Error('worker blocked')}},OffscreenCanvas:class{},Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){revoked++}},createImageBitmap(){}}
 const module=createStageEntranceRenderer({window,contractFactory:()=>({}),renderer(){},frames(){},loop:()=>({message(data){if(data.type==='stop')stops++}})})
 const port=module.start({transferControlToOffscreen(){}},{},[1,1],()=>{});port.stop();module.dispose()
 assert.equal(revoked,1);assert.equal(stops,1)
})
