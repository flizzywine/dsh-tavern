import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
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


test('browser stage entry owns deferred startup, unloading and reloading on real Cordis', async () => {
  const require = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const local = createRequire(import.meta.url)
  const {Context} = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const {startStageClientLifetime} = local('../tavern-plugin/packages/dsh-tavern-stage/lib/client/lifetime.cjs')
  const {createStageClientEntry} = local('../tavern-plugin/packages/dsh-tavern-stage/lib/client/entry.cjs')
  let definition
  const styles = new Set()
  const document = {head:{appendChild:style => styles.add(style)}, createElement:() => ({dataset:{},remove() {styles.delete(this)}})}
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client.js', import.meta.url),'utf8'), {
    document, window:{__ModuleLoader__:{load(value) {definition = value}}}
  })
  assert.equal(definition.id, 'dsh-tavern-stage')
  const seen = [], host = createStageClientEntry({startLifetime:startStageClientLifetime, install:[
    () => {seen.push('tab'); return () => seen.push('remove-tab')},
    () => {seen.push('sessions'); return () => seen.push('stop-sessions')},
  ]})
  const ctx = new Context()
  ctx.provide('tavernStageFrontend', {mount:host.mount})
  assert.deepEqual(seen, [], 'core setup does not start the stage')
  assert.equal(styles.size,0)
  const plugin = definition.factory()
  const first = ctx.plugin(plugin); await first.await()
  assert.deepEqual(seen,['tab','sessions'])
  assert.equal(styles.size,1)
  assert.match([...styles][0].textContent, /fork-tc-layer/)
  assert.match([...styles][0].textContent, /fork-widget-source-controls/)
  assert.throws(() => host.mount(), /already mounted/)
  await first.dispose()
  assert.deepEqual(seen,['tab','sessions','stop-sessions','remove-tab'])
  assert.equal(styles.size,0)
  const second = ctx.plugin(plugin); await second.await()
  assert.deepEqual(seen.slice(-2),['tab','sessions'])
  await second.dispose()
  assert.equal(styles.size,0)
  host.dispose()
  assert.throws(() => host.mount(), /disposed/)
  await ctx.fiber.dispose()
})

test('failed browser stage mount rolls back registrations and can be retried', () => {
  const require = createRequire(import.meta.url)
  const {startStageClientLifetime} = require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/lifetime.cjs')
  const {createStageClientEntry} = require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/entry.cjs')
  let count = 0, fail = true
  const host = createStageClientEntry({startLifetime:startStageClientLifetime, install:[
    () => {count++; return () => count--},
    () => {if (fail) throw new Error('startup failed')},
  ]})
  assert.throws(() => host.mount(), /startup failed/)
  assert.equal(count,0)
  fail = false
  const stop = host.mount()
  assert.equal(count,1)
  stop(); stop()
  assert.equal(count,0)
  host.dispose()
})


test('browser stage entry removes its style when mounting fails', async () => {
  const styles = new Set()
  let definition
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client.js', import.meta.url),'utf8'), {
    document:{head:{appendChild:style => styles.add(style)},createElement:() => ({dataset:{},remove() {styles.delete(this)}})},
    window:{__ModuleLoader__:{load(value) {definition = value}}}
  })
  assert.throws(() => definition.factory().apply({get:() => ({mount() {throw new Error('failed')}}),effect:run => run()}), /failed/)
  assert.equal(styles.size,0)
})
