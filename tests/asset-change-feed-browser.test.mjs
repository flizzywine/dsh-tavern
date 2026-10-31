import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

test('素材传输闲置不轮询，推送刷新，断线从已接收序号恢复，卸载关闭连接', async () => {
  const requests=[], streams=[], timers=new Map();let id=0
  class Events {
    constructor(url){this.url=url;streams.push(this)}
    close(){this.closed=true}
  }
  const context=vm.createContext({EventSource:Events,AbortController,DOMException,
    setTimeout(fn){const token=++id;timers.set(token,fn);return token},clearTimeout(token){timers.delete(token)},
    fetch:async url=>{requests.push(url);return {ok:true,json:async()=>({apiVersion:2,capabilities:['packs']})}}
  })
  vm.runInContext(readFileSync(new URL('../tavern-plugin/src/client/pack-transport.js',import.meta.url),'utf8')+'\nthis.create=createPackTransport',context)
  const port=context.create(), events=[];port.service.subscribe(event=>events.push(event))
  port.start();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(requests.length,1)
  assert.equal(timers.size,0,'连接成功后没有定期轮询定时器')
  streams[0].onmessage({data:JSON.stringify({sequence:7,reset:false,changes:[{type:'pack',packId:'p',revision:'new'}]})})
  assert.equal(events.at(-1).packId,'p')
  streams[0].onerror();assert.equal(streams[0].closed,true)
  const [token,retry]=[...timers][0];timers.delete(token);retry()
  await new Promise(resolve=>setImmediate(resolve))
  assert.match(streams[1].url,/since=7$/)
  assert.equal(timers.size,0)
  port.dispose();assert.equal(streams[1].closed,true)
  streams[1].onerror();assert.equal(timers.size,0)
})
