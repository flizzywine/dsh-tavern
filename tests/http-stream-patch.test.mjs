import test from 'node:test'
import assert from 'node:assert/strict'
import {IncomingMessage} from 'node:http'
import {Readable,PassThrough} from 'node:stream'
import {spawnSync} from 'node:child_process'
import {installHttpStreamPatch} from '../tavern-plugin/lib/domain/http-stream-patch.js'
const moduleUrl=new URL('../tavern-plugin/lib/domain/http-stream-patch.js',import.meta.url).href
function message(read) {const source=new IncomingMessage(new PassThrough());source._read=read;return source}
test('HTTP backpressure cancellation cannot enqueue into a closed controller',()=>{
 const code=`import {IncomingMessage} from 'node:http';import {PassThrough,Readable} from 'node:stream';import {installHttpStreamPatch} from ${JSON.stringify(moduleUrl)};
 installHttpStreamPatch();
 for(let i=0;i<40;i++){
  const source=new IncomingMessage(new PassThrough());source._read=function(){this.push(Buffer.alloc(16384));if((this.bytes=(this.bytes||0)+16384)>524288)this.push(null)};
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),2);
  try{await Readable.toWeb(source).pipeTo(new WritableStream({async write(){await new Promise(r=>setTimeout(r,1))}},{highWaterMark:1}),{signal:controller.signal})}catch(error){if(error.name!=='AbortError')throw error}finally{clearTimeout(timer)}
  await new Promise(r=>setImmediate(r));if(!source.destroyed)throw Error('HTTP source leaked');
 }`
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000})
 assert.equal(child.status,0,child.stderr || String(child.error))
})
test('HTTP data and source errors remain visible; non-HTTP streams and nested owners are preserved',async()=>{
 const original=Readable.toWeb,off=installHttpStreamPatch(),other=installHttpStreamPatch()
 try{
  const source=message(function(){this.push(Buffer.from('头像'));this.push(null)})
  assert.equal(await new Response(Readable.toWeb(source)).text(),'头像')
  const broken=message(function(){this.destroy(new Error('source failed'))})
  await assert.rejects(new Response(Readable.toWeb(broken)).text(),/source failed/)
  assert.equal(await new Response(Readable.toWeb(Readable.from([Buffer.from('plain')]))).text(),'plain')
  off();assert.notEqual(Readable.toWeb,original)
 }finally{off();other()}
 assert.equal(Readable.toWeb,original)
})
test('canceling a pending HTTP read destroys it without a late enqueue',async()=>{
 const off=installHttpStreamPatch()
 try{
  const source=message(function(){})
  const reader=Readable.toWeb(source).getReader(),pending=reader.read()
  await reader.cancel();assert.equal((await pending).done,true);assert.equal(source.destroyed,true)
 }finally{off()}
})
test('a data event already queued when HTTP cancellation starts cannot throw',async()=>{
 const source=message(function(){}),off=installHttpStreamPatch()
 try{
  const reader=Readable.toWeb(source).getReader()
  const canceled=reader.cancel()
  assert.doesNotThrow(()=>source.emit('data',Buffer.from('late HTTP chunk')))
  await canceled
 }finally{off()}
})
