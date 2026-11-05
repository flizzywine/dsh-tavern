import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createPluginDataStore } from '../tavern-plugin/lib/domain/plugin-data-store.js'
import { createPluginHandlers } from '../tavern-plugin/lib/rpc/plugins.js'
import { registerTavernHttpRoutes, PLUGIN_DATA_RPC_BODY_LIMIT } from '../tavern-plugin/lib/http/routes.js'

test('plugin global JSON larger than 80 MiB saves and reads through browser RPC; other methods keep their cap', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-large-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  let handler
  const handlers = createPluginHandlers({pluginDataStore:createPluginDataStore({dataRoot:root}),str:value=>String(value||'')})
  let dispatched = 0
  registerTavernHttpRoutes({
    ctx:{get:name=>name==='webServer'?{register(route){if(route.path==='/api/dsh-tavern')handler=route.handler;return()=>{}}}:{requestRejection:()=>undefined},effect(fn){fn()}},
    dispatch:async (method,args)=>{dispatched++;return handlers[method](args)},str:value=>String(value??''),
    performanceDiagnostics:{http(){}},runtimeGeneration:'test',runtimeReadiness:Promise.resolve({ok:true})
  })
  async function post(method, chunks) {
    let body
    await handler({url:'/api/dsh-tavern/'+method,method:'POST',headers:{host:'localhost:3081'},async *[Symbol.asyncIterator](){yield* chunks}}, {writeHead(){},end(value){body=value}})
    return JSON.parse(body)
  }
  const block = Buffer.alloc(1024*1024, 'x')
  function* payload(){yield Buffer.from('{"plugin":"fixture","op":"save","data":{"payload":"');for(let i=0;i<81;i++)yield block;yield Buffer.from('"}}')}
  assert.equal((await post('pluginData',payload())).ok,true)
  const reply = await post('pluginData',[Buffer.from('{"plugin":"fixture","op":"read"}')])
  assert.equal(reply.data.payload.length,81*1024*1024)
  assert.equal(reply.data.payload.slice(-10),'xxxxxxxxxx')
  const prior = dispatched
  assert.match((await post('unrelated',payload())).error,/80 MiB/)
  assert.equal(dispatched,prior)
  function* oversized(){for(let i=0;i<Math.ceil(PLUGIN_DATA_RPC_BODY_LIMIT/block.length)+1;i++)yield block}
  assert.match((await post('pluginData',oversized())).error,/256 MiB/)
  assert.equal(dispatched,prior)
})
