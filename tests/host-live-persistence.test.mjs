import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultHostRequire } from '../tavern-plugin/lib/domain/host-session-patch.js'

test('host resolution recognizes the actual installed JSONL service', async t => {
  // The suite's package redirection would hide the casing bug by making the
  // plugin fallback resolve the right module. Reproduce the desktop loader.
  if (!process.env.TAVERN_UNHOOKED_HOST_PROBE) {
    const env = { ...process.env, NODE_OPTIONS: '', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), TAVERN_UNHOOKED_HOST_PROBE: '1' }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], {
      env,
      encoding: 'utf8', windowsHide: true,
    })
    assert.equal(child.status, 0, child.stdout + child.stderr)
    assert.match(child.stdout, /host resolution recognizes/)
    return
  }
  const require = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const jsonl = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const root = await mkdtemp(join(tmpdir(), 'host-live-persistence-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(typeof jsonl.apply === 'function' ? jsonl : jsonl.default, { root, compression: 'none' }).await()
  const selected = await defaultHostRequire(ctx.sessionPersistence, {
    env: { DSH_DESKTOP_DSH_BOOTSTRAP: process.env.DSH_BOOT_MODULE }, argv: [],
  })
  assert.equal(selected.resolve('@deepseek-ai/dsh-session'), require.resolve('@deepseek-ai/dsh-session'))
  if (process.platform === 'win32') {
    const lowercase = await defaultHostRequire(ctx.sessionPersistence, {
      env: { DSH_DESKTOP_DSH_BOOTSTRAP: process.env.DSH_BOOT_MODULE.toLowerCase() }, argv: [],
    })
    assert.equal(await load('@deepseek-ai/dsh-session'), await import(pathToFileURL(lowercase.resolve('@deepseek-ai/dsh-session')).href))
    const alternateJsonl = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl').toLowerCase()).href)
    const alternate = new Context()
    t.after(() => alternate.fiber.dispose())
    await alternate.plugin(alternateJsonl, { root: join(root, 'lowercase'), compression: 'none' }).await()
    await defaultHostRequire(alternate.sessionPersistence, {
      env: { DSH_DESKTOP_DSH_BOOTSTRAP: process.env.DSH_BOOT_MODULE.toLowerCase() }, argv: [],
    })
  }
})
