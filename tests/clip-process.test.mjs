import test from 'node:test'
import assert from 'node:assert/strict'
import {Writable} from 'node:stream'
import {clipProcess,clipWrite} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-process.js'

test('backpressure releases per-write listeners without attaching to process lifetime',async()=>{
  const input=new Writable({highWaterMark:1,write(bytes,encoding,done){setImmediate(done)}})
  const process={child:{stdin:input},done:{then(){assert.fail('a drain must not attach a process-lifetime reaction')}}}
  for(let frame=0;frame<500;frame++){
    await clipWrite(process,Buffer.alloc(65536,frame%256))
    for(const event of ['drain','error','close'])assert.equal(input.listenerCount(event),0)
  }
  input.end()
})

test('backpressure rejects a closed or failed input and removes its listeners',async()=>{
  for(const failure of [null,new Error('fixture input failed')]){
    const input=new Writable({highWaterMark:1,write(){}})
    const waiting=clipWrite({child:{stdin:input}},Buffer.alloc(65536))
    input.destroy(failure)
    await assert.rejects(waiting,failure || /closed before draining/)
    for(const event of ['drain','error','close'])assert.equal(input.listenerCount(event),0)
    await assert.rejects(clipWrite({child:{stdin:input}},Buffer.alloc(1)),/closed before its last frame/)
  }
})

test('stdout and stderr keep draining while a child consumes backpressured stdin',{timeout:30000},async()=>{
  const script=`const {once}=require('node:events');(async()=>{let frame=0;for await(const bytes of process.stdin){for(const stream of [process.stdout,process.stderr]){if(!stream.write('x'.repeat(16384)+'\\n'))await once(stream,'drain')}process.stdout.write('frame='+ ++frame+'\\n')}})()`
  const process=clipProcess(globalThis.process.execPath,['-e',script],{input:true,onProgress(){}})
  try {
    for(let frame=0;frame<512;frame++)await clipWrite(process,Buffer.alloc(65536,frame%256))
    process.child.stdin.end();await process.done
    const diagnostic=process.diagnostics()
    assert.ok(diagnostic.stdout.bytes>4*1024*1024)
    assert.ok(diagnostic.stderr.bytes>4*1024*1024)
    assert.equal(diagnostic.stdin.writableFinished,true)
    assert.equal(diagnostic.exitCode,0)
  }finally{if(process.child.exitCode===null)process.stop(new Error('test cleanup'));await process.done.catch(()=>{})}
})
