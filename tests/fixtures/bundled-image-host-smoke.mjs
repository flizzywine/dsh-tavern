// Explicit local smoke test: uses the installed DSH but an isolated temporary
// Profile, fake credentials and a loopback image response. Never paid generation.
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { installBundledImagePlugin } from '../../bin/bundled-image-plugin.mjs'

const source = fileURLToPath(new URL('../..', import.meta.url))
const root = mkdtempSync(path.join(tmpdir(), 'tavern-image-real-host-'))
const dsh = process.env.DSH_SMOKE_COMMAND || 'dsh'
try {
  const plugin = path.join(root, 'tavern-plugin/packages/dsh-image-gen')
  mkdirSync(path.join(plugin, 'lib'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) cpSync(path.join(source, 'tavern-plugin/packages/dsh-image-gen', file), path.join(plugin, file))
  installBundledImagePlugin({ sourceRoot: root, dsh, host: 'cli' })
  const smoke = spawnSync(process.execPath, [path.join(source, 'tavern-plugin/packages/dsh-image-gen/tests/fixtures/tavern-grok-smoke.mjs')], {
    env: { ...process.env, TAVERN_ROOT: source, IMAGE_PLUGIN_ENTRY: path.join(plugin, 'lib/index.js') }, encoding: 'utf8', timeout: 30000,
  })
  assert.equal(smoke.status, 0, smoke.stderr + smoke.stdout)
  console.log(smoke.stdout.trim())
  const home = path.join(root, 'dsh-home')
  const profile = path.join(home, 'profiles', 'image-smoke')
  mkdirSync(path.join(profile, 'node_modules'), { recursive: true })
  symlinkSync(plugin, path.join(profile, 'node_modules/dsh-image-gen'), process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'image-smoke', private: true, dependencies: { 'dsh-image-gen': `link:${plugin}` }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-image-gen'] } } }))
  writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n')
  const dump = spawnSync(dsh, ['--profile', 'image-smoke', '--dump-config'], { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' })
  assert.equal(dump.status, 0, dump.stderr.slice(-2500))
  // Never print DSH dump output; it may include host configuration.
  assert.match(dump.stdout, /dsh-image-gen/)
  console.log('PASS: isolated real DSH Profile resolves the bundled plugin; no npm install, user Profile or credentials changed')
} finally { rmSync(root, { recursive: true, force: true }) }
