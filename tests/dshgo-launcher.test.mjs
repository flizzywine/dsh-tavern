import { test as nodeTest } from 'node:test'
// dsh-go runs on Android/Termux (POSIX paths, sh and links), which Windows cannot exercise.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest
import assert from 'node:assert/strict'
import { TAVERN_BUNDLES, profileDir, readStatus } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

const HOME = '/root/.dsh'

function reader(files) {
  return (file, encoding) => {
    assert.equal(encoding, 'utf8')
    if (!Object.hasOwn(files, file)) {
      const error = new Error(`ENOENT: no such file or directory, open '${file}'`)
      error.code = 'ENOENT'
      throw error
    }
    return files[file]
  }
}

function manifest(bundles, dependencies = {}) {
  return JSON.stringify({ dsh: { profile: { bundles } }, dependencies })
}

test('readStatus：8 个 bundle 齐 → ready，并读出酒馆版本与 dependencies 登记', () => {
  const dir = profileDir(HOME)
  const files = {
    [`${dir}/package.json`]: manifest(TAVERN_BUNDLES, { 'dsh-tavern-plugin': 'link:../plugins/dsh-tavern' }),
    [`${dir}/node_modules/dsh-tavern-plugin/package.json`]: JSON.stringify({ version: '3.2.0' }),
  }
  const status = readStatus({ home: HOME, read: reader(files) })
  assert.equal(status.phase, 'ready')
  assert.equal(status.profileDir, dir)
  assert.deepEqual(status.missing, [])
  assert.deepEqual(status.installed, [...TAVERN_BUNDLES])
  assert.equal(status.tavernVersion, '3.2.0')
  assert.deepEqual(status.declared, ['dsh-tavern-plugin'])
  assert.deepEqual(status.modules, ['dsh-tavern-plugin'])
  assert.equal(status.missingModules.length, TAVERN_BUNDLES.length - 1)
  assert.equal(status.error, null)
})
