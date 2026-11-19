// Live2D runtime files (dsh-tavern-stage lib/live2d): synthetic API markers only, no proprietary runtime in fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createCubismCore, CUBISM_CORE_DOWNLOAD, CUBISM_CORE_LICENSE } from '../tavern-plugin/packages/dsh-tavern-stage/lib/live2d/cubism-core.js'
import { TAVERN_RUNTIME_ASSET_PREFIX } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'
import { syntheticFixture } from './helpers/synthetic-link-fixture.mjs'

const source = 'var Live2DCubismCore = {Moc: {}, Model: {}, Version: {}, csmGetVersion() {}, csmReviveMocInPlace() {}}; throw new Error("must not execute");'
const input = { name: 'live2dcubismcore.min.js', consent: true, base64: Buffer.from(source).toString('base64') }
async function setup(t) {
  // publishing hard-links its temporary file: one registered synthetic fixture.
  const root = syntheticFixture(t, 'cubism-import-')
  return { root, core: createCubismCore(root) }
}

test('a dropped Core publishes atomically, serves from the runtime-asset route and never replaces the installed file', async t => {
  const { root, core } = await setup(t)
  const initial = await core.status()
  assert.equal(initial.installed, false)
  assert.equal(initial.core, '')
  assert.equal(initial.downloadUrl, CUBISM_CORE_DOWNLOAD)
  assert.equal(initial.licenseUrl, CUBISM_CORE_LICENSE)
  const results = await Promise.all([core.importFile(input), core.importFile(input)])
  assert.ok(results.every(result => result.coreInstalled))
  assert.deepEqual(await readdir(path.join(root, 'core')), ['live2dcubismcore.min.js'])
  assert.equal(await readFile(path.join(root, 'core/live2dcubismcore.min.js'), 'utf8'), source)
  assert.equal((await core.status()).core, TAVERN_RUNTIME_ASSET_PREFIX + 'live2d/live2dcubismcore.min.js')
  await core.importFile({ ...input, name: 'live2dcubismcore.js', base64: Buffer.from(source + '\n// changed').toString('base64') })
  assert.equal(await readFile(path.join(root, 'core/live2dcubismcore.min.js'), 'utf8'), source)
})


const display = 'var PIXI = {live2d: {Live2DModel: {}, CubismModel: {}}}; var Live2DCubismCore; throw new Error("must not execute");'
