import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {createResourceScope} from '../tavern-plugin/lib/domain/resource-scope.js'
import {createStageRuntime} from '../tavern-plugin/packages/dsh-tavern-stage/lib/runtime.js'
import {createFigureRuntimes} from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-runtimes.js'
import {createStageExtensions} from '../tavern-plugin/packages/dsh-tavern-stage/lib/stage-extensions.js'

function host() {
  const stops=[], listeners=new Set()
  return {stops,listeners,effect(run){const stop=run();stops.push(stop);return stop},on(name,callback){listeners.add(callback);return()=>listeners.delete(callback)},async dispose(){for(const stop of stops.reverse())await stop?.()}}
}

test('real Cordis injection and event effects end with the module scope',async()=>{
  const require=createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const {Context}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const root=new Context(),scope=createResourceScope(root)
  scope.ctx.provide('stageOwnedProbe',{value:1})
  assert.equal(root.get('stageOwnedProbe').value,1)
  let starts=0,stops=0
  scope.ctx.inject(['resourceProbe'],child=>{
    starts++;child.effect(()=>()=>{stops++})
  })
  const first=root.plugin({name:'probe',apply(ctx){ctx.provide('resourceProbe',{})}})
  await first.await();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(starts,1)
  await scope.dispose();assert.equal(stops,1)
  assert.equal(root.get('stageOwnedProbe'),undefined)
  await first.dispose()
  const second=root.plugin({name:'probe2',apply(ctx){ctx.provide('resourceProbe',{})}})
  await second.await();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(starts,1);assert.equal(stops,1)
  await root.fiber.dispose()
})

test('stage runtime assembles private RPC dependencies without exposing them through core',async()=>{
  const root=host(),privateAsset={},privateService={},registry={}
  let coreReads=0
  const runtime=createStageRuntime({ctx:root},{assets:()=>({privateAsset,figureRuntimes:createFigureRuntimes(),stageExtensions:createStageExtensions()}),
    start:async()=>({requests(deps,providedRegistry){
      assert.equal(coreReads,0)
      assert.equal(deps.privateAsset,privateAsset);assert.equal(deps.privateService,privateService)
      assert.equal(deps.coreValue,42);assert.equal(providedRegistry,registry)
    }}),services:()=>({privateService})})
  await runtime.start({cardsActive:()=>true});runtime.services({})
  runtime.requests({get coreValue(){coreReads++;return 42}},registry)
  assert.equal(coreReads,1)
  await runtime.dispose();assert.throws(()=>runtime.requests({},registry),{code:'STAGE_UNAVAILABLE'})
})
