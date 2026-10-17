import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { mergeProfileManifest } from '../bin/profile-configuration.mjs'
import { applyMode, detectMode, planBundles, status } from '../tavern-plugin/packages/dsh-tavern-ui-switch/lib/profile.js'

const BASE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const SWITCH = 'dsh-tavern-ui-switch'

function tavernManifest(overrides = {}) {
  return {
    name: 'dsh-profile-tavern',
    private: true,
    dependencies: { 'dsh-pocket': '2.12.0', 'dsh-tavern-plugin': 'link:./tavern-plugin' },
    dsh: {
      profile: {
        bundles: [...BASE, 'dsh-pocket', 'dsh-tavern-plugin', 'dsh-tavern-remote', SWITCH],
      },
    },
    dshTavern: {
      host: 'desktop',
      managedBundles: [...BASE, 'dsh-pocket', 'dsh-tavern-plugin', 'dsh-tavern-remote', SWITCH],
      managedDependencies: ['dsh-pocket', 'dsh-tavern-plugin'],
      officialBundles: [...BASE, SWITCH],
    },
    ...overrides,
  }
}

function makeHome(name, manifest, profile = 'desktop') {
  const root = mkdtempSync(path.join(os.tmpdir(), `${name}-`))
  const profileDir = path.join(root, 'profiles', profile)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  process.env.DSH_HOME = root
  delete process.env.DSH_PROFILE
  return { root, manifestPath: path.join(profileDir, 'package.json') }
}

const read = (file) => JSON.parse(readFileSync(file, 'utf8'))

test('switching to the original interface and back restores the bundle list', () => {
  const home = makeHome('ui-switch-round-trip', tavernManifest())
  assert.equal(status().mode, 'tavern')

  const official = applyMode('official')
  assert.deepEqual(official.bundles, [...BASE, SWITCH])

  const back = applyMode('tavern')
  assert.deepEqual(back.bundles, [...BASE, 'dsh-pocket', 'dsh-tavern-plugin', 'dsh-tavern-remote', SWITCH])
})

test('switching keeps dependencies, metadata and user bundles untouched', () => {
  const home = makeHome('ui-switch-keep', tavernManifest())
  const before = read(home.manifestPath)
  applyMode('official')
  const after = read(home.manifestPath)

  assert.deepEqual(after.dependencies, before.dependencies)
  assert.deepEqual(after.dshTavern, before.dshTavern)
  assert.equal(after.name, before.name)
})

test('a repeated switch is a no-op and leaves a backup of the previous state', () => {
  const home = makeHome('ui-switch-idempotent', tavernManifest())
  applyMode('official')
  const once = readFileSync(home.manifestPath, 'utf8')
  assert.equal(applyMode('official').changed, false)
  assert.equal(readFileSync(home.manifestPath, 'utf8'), once)

  const backups = readdirSync(path.join(home.root, 'backups', 'ui-switch'))
  assert.equal(backups.length, 1)
  assert.equal(detectMode(read(path.join(home.root, 'backups', 'ui-switch', backups[0]))), 'tavern')
})

test('a corrupted manifest reports an error instead of crashing', () => {
  const home = makeHome('ui-switch-broken', tavernManifest())
  writeFileSync(home.manifestPath, '{ not json', 'utf8')
  const info = status()
  assert.equal(info.mode, 'unknown')
  assert.match(info.error, /无法读取/)
})

test('bundles scattered through the list still switch cleanly', () => {
  const manifest = tavernManifest()
  manifest.dsh.profile.bundles = ['dsh-tavern-plugin', BASE[0], 'dsh-pocket', BASE[1], SWITCH]
  manifest.dshTavern.officialBundles = undefined
  makeHome('ui-switch-scattered', manifest)

  assert.deepEqual(applyMode('official').bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', SWITCH])
  assert.deepEqual(applyMode('tavern').bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'dsh-pocket',
    'dsh-tavern-plugin',
    'dsh-tavern-remote',
    SWITCH,
  ])
})

test('the desktop profile keeps the switch and records the official bundle list', () => {
  const source = {
    name: 'dsh-profile-tavern',
    dsh: { profile: { bundles: [...BASE, 'dsh-pocket', 'dsh-tavern-plugin', SWITCH] } },
    devDependencies: { [SWITCH]: `link:./tavern-plugin/packages/${SWITCH}` },
  }
  const manifest = mergeProfileManifest({
    source,
    current: {},
    pluginPath: path.resolve('tavern-plugin'),
    dataRoot: '/tmp/data',
    host: 'desktop',
    dshVersion: '0.2.1-rc.2',
  })

  assert.ok(manifest.dsh.profile.bundles.includes(SWITCH))
  assert.deepEqual(manifest.dshTavern.officialBundles, [...BASE, SWITCH])
  assert.match(manifest.dependencies[SWITCH], new RegExp(`^link:.*${SWITCH}$`))
  assert.equal(planBundles(manifest, 'official').includes('dsh-tavern-plugin'), false)
})

test('other hosts never receive the switch bundle', () => {
  const source = {
    name: 'dsh-profile-tavern',
    dsh: { profile: { bundles: [...BASE, 'dsh-tavern-plugin', SWITCH] } },
    devDependencies: { [SWITCH]: `link:./tavern-plugin/packages/${SWITCH}` },
  }
  for (const host of ['cli', 'android']) {
    const manifest = mergeProfileManifest({
      source,
      current: {},
      pluginPath: path.resolve('tavern-plugin'),
      dataRoot: '/tmp/data',
      host,
      dshVersion: '0.2.1-rc.2',
    })
    assert.equal(manifest.dsh.profile.bundles.includes(SWITCH), false, `${host} must not load the switch`)
    assert.equal(manifest.dependencies?.[SWITCH], undefined)
    assert.deepEqual(manifest.dshTavern.officialBundles, BASE)
  }
})
