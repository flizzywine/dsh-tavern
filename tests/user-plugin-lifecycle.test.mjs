import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { guardSource } from '../tavern-plugin/lib/domain/user-plugins.js'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'

for (const behavior of ['sync-failure', 'async-failure', 'success']) test('插件子作用域初始化与清理：' + behavior, async t => {
  const asyncApply = behavior === 'async-failure'
  const require = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const root = new Context()
  const fibers = []
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  let api
  const provider = root.plugin({ name: 'tavern', apply(ctx) {
    api = createTavernPluginApi({ ctx, resolveGame: async () => ({ chatId: 'c', sessionId: 's' }) })
    ctx.provide('tavern', api.service)
    ctx.provide('probe', { active: 0 })
  } })
  fibers.push(provider)
  await provider.await()
  const dir = await mkdtemp(path.join(tmpdir(), 'plugin-lifecycle-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path.join(dir, 'plugin.mjs'), `export const inject=['tavern','probe']; export ${asyncApply ? 'async ' : ''}function apply(ctx) {
    ctx.tavern.promptSection({name:'partial',text:'should disappear'});
    ctx.effect(() => { ctx.probe.active++; return () => {ctx.probe.active--} });
    ${asyncApply ? 'await Promise.resolve();' : ''}${behavior === 'success' ? '' : "throw Error('startup failed');"}
  }`)
  await writeFile(path.join(dir, 'guard.mjs'), guardSource({ folder: 'broken', name: 'broken', main: './plugin.mjs' }))
  const guard = await import(pathToFileURL(path.join(dir, 'guard.mjs')).href)
  const loaded = root.plugin(guard)
  fibers.push(loaded)
  await loaded.await()
  if (behavior === 'success') {
    assert.equal((await api.promptSections({ gameId: 's' })).length, 1)
    assert.equal(root.probe.active, 1)
    await loaded.dispose()
    fibers.pop()
  }
  assert.deepEqual(await api.promptSections({ gameId: 's' }), [])
  assert.equal(root.probe.active, 0)
})
