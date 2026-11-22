import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {createResourceScope} from '../tavern-plugin/lib/domain/resource-scope.js'

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
