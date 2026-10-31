import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { preserveInstallationFonts } from '../bin/preserve-font-assets.mjs'
import { FONT_CATALOG } from '../tavern-plugin/packages/dsh-dream-skin/lib/font-assets.js'
const repo = fileURLToPath(new URL('..', import.meta.url))
const family = FONT_CATALOG.families[0], face = family.files[0]
const relative = `tavern-plugin/fonts/${family.id}/${face.file}`
function fixture(t) {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'tavern-font-adoption-')))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const app = path.join(home, 'apps/tavern'), source = path.join(home, 'source')
  mkdirSync(source, { recursive: true }); writeFileSync(path.join(source, 'package.json'), '{}')
  const dataRoot = path.join(home, 'profile-data/tavern/data')
  const cache = path.join(dataRoot, 'cache/fonts', face.sha256)
  function putFace(root) {
    const destination = path.join(root, relative)
    mkdirSync(path.dirname(destination), { recursive: true })
    copyFileSync(path.join(repo, relative.replace('tavern-plugin/fonts/', 'tavern-plugin/packages/dsh-dream-skin/fonts/')), destination)
    return destination
  }
  function run(script, ...args) {
    return spawnSync(process.execPath, [path.join(repo, 'bin', script), ...args], { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8' })
  }
  return { home, app, source, dataRoot, cache, putFace, run }
}
test('staged CLI preserves old verified fonts before commit removes previous release; cache serves offline', async t => {
  const f = fixture(t), old = f.putFace(f.app + '.previous')
  mkdirSync(f.app, { recursive: true })
  const expected = readFileSync(old)
  const result = f.run('staged-app-install.mjs', 'commit', '--app', f.app)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(f.app + '.previous'), false)
  assert.deepEqual(readFileSync(f.cache), expected)
  const { createFontAssets } = await import('../tavern-plugin/packages/dsh-dream-skin/lib/font-assets.js')
  assert.equal(await createFontAssets({ dataRoot: f.dataRoot, bundledRoots: [], fetchImpl: () => { throw new Error('offline') } }).ensure(family.id, face.file), f.cache)
})
test('new desktop pruner adopts bundled font before removing tracked old binary', t => {
  const f = fixture(t), old = f.putFace(f.app)
  writeFileSync(path.join(f.app, '.dsh-tavern-files.txt'), relative + '\n')
  const result = f.run('prune-installed-files.mjs', f.source, f.app)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(old), false)
  assert.equal(readFileSync(f.cache).length, face.bytes)
})
test('cache write failure leaves old release and font untouched in both cleanup paths', t => {
  for (const staged of [false, true]) {
    const f = fixture(t), old = f.putFace(staged ? f.app + '.previous' : f.app)
    mkdirSync(f.app, { recursive: true })
    mkdirSync(path.join(f.dataRoot, 'cache'), { recursive: true })
    writeFileSync(path.join(f.dataRoot, 'cache/fonts'), 'blocked')
    writeFileSync(path.join(f.app, '.dsh-tavern-files.txt'), relative + '\n')
    const result = staged ? f.run('staged-app-install.mjs', 'commit', '--app', f.app) : f.run('prune-installed-files.mjs', f.source, f.app)
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(old), true)
  }
})
test('Android profile preparation adopts only verified fonts from retained replacement backup', async t => {
  const f = fixture(t)
  const backup = path.join(path.dirname(f.app), '.dsh-tavern-download.ABC123', 'previous-source')
  const original = f.putFace(backup)
  await preserveInstallationFonts(f.app, { dataRoot: f.dataRoot, androidBackups: true })
  assert.deepEqual(readFileSync(f.cache), readFileSync(original))
  assert.equal(existsSync(original), true)
})
