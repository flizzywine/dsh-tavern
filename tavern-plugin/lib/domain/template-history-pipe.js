import {readSync,writeSync} from 'node:fs'
const maxRequest=8192,maxResponse=256*1024*1024
const pause=new Int32Array(new SharedArrayBuffer(4))
function frame(value){const body=Buffer.from(JSON.stringify(value));const head=Buffer.alloc(4);head.writeUInt32BE(body.length);return Buffer.concat([head,body])}
// Dedicated inherited pipe: blocking only the disposable template worker, never
// the host event loop. No filesystem/profile access is granted to templates.
export function createTemplateHistoryPipeClient(fd=4){
 return args=>{
  const request=frame(args)
  if(request.length>maxRequest+4)throw Error('Template history request too large')
  const deadline=Date.now()+120000
  function transfer(buffer,write=false){let offset=0;while(offset<buffer.length){
   if(Date.now()>deadline)throw Error('Template history read timed out')
   try {const size=write?writeSync(fd,buffer,offset,buffer.length-offset):readSync(fd,buffer,offset,buffer.length-offset,null);if(!size)throw Error('Template history pipe closed');offset+=size}
   catch(error){if(error.code!=='EAGAIN' && error.code!=='EWOULDBLOCK')throw error;Atomics.wait(pause,0,0,2)}
  }}
  transfer(request,true)
  const head=Buffer.alloc(4);transfer(head);const size=head.readUInt32BE()
  if(size>maxResponse)throw Error('Template history response too large')
  const body=Buffer.alloc(size);transfer(body);const response=JSON.parse(body)
  if(response.error)throw Error(response.error)
  return response.result
 }
}
export function serveTemplateHistoryPipe(stream,read){
 let buffered=Buffer.alloc(0),tail=Promise.resolve()
 stream.on('error',()=>{})
 stream.on('data',chunk=>{
  buffered=Buffer.concat([buffered,chunk])
  while(buffered.length>=4){
   const size=buffered.readUInt32BE()
   if(size>maxRequest){stream.destroy();return}
   if(buffered.length<size+4)return
   const body=buffered.subarray(4,size+4);buffered=buffered.subarray(size+4)
   tail=tail.then(async()=>{
    let response
    try{response={result:await read(JSON.parse(body))}}catch(error){response={error:String(error.message||error)}}
    let payload=frame(response)
    if(payload.length>maxResponse+4)payload=frame({error:'Template history response too large'})
    if(!stream.destroyed)stream.write(payload)
   }).catch(()=>stream.destroy())
  }
 })
}
