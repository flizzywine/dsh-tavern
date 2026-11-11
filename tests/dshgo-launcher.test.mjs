import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TAVERN_BUNDLES, profileDir, readStatus, resolveDshHome } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

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

test('resolveDshHome：DSH_HOME 优先，空串与空白回落家目录', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '/srv/home' }, '/root'), '/srv/home')
  assert.equal(resolveDshHome({ DSH_HOME: '  /srv/home  ' }, '/root'), '/srv/home')
  assert.equal(resolveDshHome({ DSH_HOME: '' }, '/root'), '/root/.dsh')
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }, '/root'), '/root/.dsh')
  assert.equal(resolveDshHome({}, '/root'), '/root/.dsh')
})

test('profileDir：始终是 profiles/web', () => {
  assert.equal(profileDir(HOME), `${HOME}/profiles/web`)
})

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

test('readStatus：部分 bundle → partial，缺的列在 missing', () => {
  const dir = profileDir(HOME)
  const files = { [`${dir}/package.json`]: manifest(['dsh-tavern-plugin', 'dsh-web-mobile']) }
  const status = readStatus({ home: HOME, read: reader(files) })
  assert.equal(status.phase, 'partial')
  assert.deepEqual(status.installed, ['dsh-web-mobile', 'dsh-tavern-plugin'])
  assert.equal(status.missing.length, TAVERN_BUNDLES.length - 2)
  assert.equal(status.tavernVersion, null)
})

test('readStatus：package.json 存在但无酒馆 bundle → absent', () => {
  const dir = profileDir(HOME)
  const files = { [`${dir}/package.json`]: manifest(['@deepseek-ai/dsh-base']) }
  const status = readStatus({ home: HOME, read: reader(files) })
  assert.equal(status.phase, 'absent')
  assert.deepEqual(status.installed, [])
  assert.equal(status.missing.length, TAVERN_BUNDLES.length)
  assert.deepEqual(status.modules, [])
})

test('readStatus：package.json 读不到或不是 JSON → unreadable，不抛错', () => {
  const dir = profileDir(HOME)
  for (const files of [{}, { [`${dir}/package.json`]: '{ not json' }]) {
    const status = readStatus({ home: HOME, read: reader(files) })
    assert.equal(status.phase, 'unreadable')
    assert.equal(typeof status.error, 'string')
    assert.deepEqual(status.bundles, [])
  }
})

test('readStatus：bundles 里的非字符串项被忽略，不影响判定', () => {
  const dir = profileDir(HOME)
  const files = { [`${dir}/package.json`]: JSON.stringify({ dsh: { profile: { bundles: [...TAVERN_BUNDLES, null, 42] } } }) }
  const status = readStatus({ home: HOME, read: reader(files) })
  assert.equal(status.phase, 'ready')
  assert.equal(status.bundles.length, TAVERN_BUNDLES.length)
})
