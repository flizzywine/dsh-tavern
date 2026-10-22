import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { workerModuleReadFlags } from '../tavern-plugin/lib/domain/worker-module-permissions.js'
import { createServerTemplateFixture } from './fixtures/server-template-runtime.mjs'

const permission = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission'

test('permission worker reads hoisted dependencies but cannot read profile data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-worker-permissions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const plugin = join(root, 'plugin')
  const nested = join(plugin, 'node_modules', 'nested')
  const hoisted = join(root, 'node_modules', 'hoisted')
  await mkdir(nested, { recursive: true })
  await mkdir(hoisted, { recursive: true })
  await writeFile(join(nested, 'package.json'), '{"main":"index.cjs"}')
  await writeFile(join(nested, 'index.cjs'), "module.exports = require('hoisted')")
  await writeFile(join(hoisted, 'package.json'), '{"main":"index.cjs"}')
  await writeFile(join(hoisted, 'index.cjs'), 'module.exports = 42')
  const privateFile = join(root, 'profile.json')
  await writeFile(privateFile, '{}')
  const worker = join(plugin, 'worker.cjs')
  await writeFile(worker, `const assert = require('node:assert/strict');
assert.equal(require('nested'), 42);
assert.throws(() => require('node:fs').readFileSync(${JSON.stringify(privateFile)}), { code: 'ERR_ACCESS_DENIED' });
console.log('ready');`)
  const run = flags => spawnSync(process.execPath, [permission, '--allow-fs-read=' + plugin, ...flags, worker], {
    env: { NODE_ENV: 'production', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    encoding: 'utf8', timeout: 10000, windowsHide: true
  })
  const old = run(['--allow-fs-read=' + join(plugin, 'node_modules')])
  assert.equal(old.status, 1)
  assert.match(old.stderr, /ERR_ACCESS_DENIED/)
  const fixed = run(workerModuleReadFlags(join(nested, 'package.json')))
  assert.equal(fixed.status, 0, fixed.stderr)
  assert.equal(fixed.stdout.trim(), 'ready')
})

test('real template worker boots with permission flags and renders prose offline', async t => {
  const fixture = createServerTemplateFixture()
  t.after(() => fixture.dispose())
  assert.equal((await fixture.render('Prose <%= 6 * 7 %>')).text, 'Prose 42')
})
