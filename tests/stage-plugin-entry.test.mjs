import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import * as stage from '../tavern-plugin/packages/dsh-tavern-stage/lib/index.js'

test('independent stage plugin follows real Cordis load, unload and reload',async()=>{
  const require=createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const {Context}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const ctx=new Context(),seen=[]
  ctx.provide('tavernStageControl',{enable:async()=>seen.push('enable'),disable:async()=>seen.push('disable')})
  const first=ctx.plugin(stage);await first.await()
  assert.deepEqual(seen,['enable'])
  await first.dispose();assert.deepEqual(seen,['enable','disable'])
  const second=ctx.plugin(stage);await second.await()
  assert.deepEqual(seen,['enable','disable','enable'])
  await ctx.fiber.dispose();assert.deepEqual(seen,['enable','disable','enable','disable'])
})
