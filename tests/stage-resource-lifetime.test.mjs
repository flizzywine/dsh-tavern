import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {createResourceScope} from '../tavern-plugin/lib/domain/resource-scope.js'
import {createStageRuntime} from '../tavern-plugin/lib/stage-runtime.js'

function host() {
  const stops=[], listeners=new Set()
  return {stops,listeners,effect(run){const stop=run();stops.push(stop);return stop},on(name,callback){listeners.add(callback);return()=>listeners.delete(callback)},async dispose(){for(const stop of stops.reverse())await stop?.()}}
}

test('explicit stage cleanup is reverse ordered and idempotent with later host disposal',async()=>{
  const root=host(),seen=[],errors=[],scope=createResourceScope(root,{onError:error=>errors.push(error.message)})
  scope.ctx.effect(()=>()=>seen.push('first'))
  scope.ctx.on('event',()=>{})
  scope.ctx.effect(()=>()=>{seen.push('second');throw Error('cleanup')})
  scope.ctx.effect(()=>async()=>{seen.push('third')})
  await scope.dispose();await root.dispose()
  assert.deepEqual(seen,['third','second','first']);assert.deepEqual(errors,['cleanup']);assert.equal(root.listeners.size,0)
  assert.throws(()=>scope.ctx.effect(()=>{}),{code:'MODULE_UNAVAILABLE'})
})

test('failed stage startup releases early assets and partial module effects',async()=>{
  const root=host(),seen=[]
  const runtime=createStageRuntime({ctx:root},{
    assets({ctx}) {ctx.effect(()=>()=>seen.push('assets'));return {}},
    async start({ctx}) {ctx.effect(()=>()=>seen.push('module'));throw Error('init')},
    services(){assert.fail('must not reach services')}
  })
  await assert.rejects(runtime.start({cardsActive:()=>true}),/init/)
  assert.equal(runtime.status(),'failed');assert.deepEqual(seen,['module','assets'])
  await root.dispose();assert.deepEqual(seen,['module','assets'])
})

test('stage disposed during initialization cannot publish a late runtime or write cards',async()=>{
  const root=host();let resolve,canWrite
  const gate=new Promise(done=>resolve=done)
  const runtime=createStageRuntime({ctx:root},{assets:()=>({}),start:async({cardsActive})=>{canWrite=cardsActive;await gate;return {}},services:()=>({})})
  const starting=runtime.start({cardsActive:()=>true})
  assert.equal(canWrite(),true)
  await runtime.dispose();assert.equal(canWrite(),false);resolve()
  await assert.rejects(starting,{code:'STAGE_UNAVAILABLE'})
  assert.equal(runtime.status(),'disposed')
})

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
