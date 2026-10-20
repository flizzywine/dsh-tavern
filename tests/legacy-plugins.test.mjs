import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { listLegacyPlugins } from '../tavern-plugin/lib/domain/legacy-plugins.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-legacy-plugins-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = path.join(root, 'profiles/tavern')
  const packages = {
    alpha: { version: '1.2.3', description: 'first plugin', dsh: { bundle: {} } },
    beta: { version: '2.0.0', description: 'linked plugin', dsh: { bundle: {} } },
    gamma: { version: '0.1.0', dsh: { bundle: {} } },
    lodash: { version: '4.17.21' },
    missing: null,
    managed: { version: '3.0.0' },
    'dsh-tavern-plugin': { version: '3.0.1' },
    'dsh-plugin': { version: '2.0.4', dsh: { bundle: {} } },
    '@deepseek-ai/dsh-base': { version: '0.2.1' },
  }
  for (const [name, pkg] of Object.entries(packages)) {
    if (!pkg) continue
    const dir = path.join(profile, 'node_modules', ...name.split('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, ...pkg }))
  }
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: {
      alpha: '1.2.3',
      beta: 'link:C:/plugins/beta',
      missing: '9.9.9',
      lodash: '4.17.21',
      managed: '3.0.0',
      'dsh-tavern-plugin': '3.0.1',
      'dsh-plugin': '2.0.4',
      '@deepseek-ai/dsh-base': '0.2.1',
    },
    devDependencies: { gamma: 'file:C:/plugins/gamma' },
    dsh: { profile: { bundles: ['alpha', 'hoisted', 'missing', 'outside', 'managed', 'dsh-tavern-plugin', '@deepseek-ai/dsh-base'] } },
    dshTavern: { managedBundles: ['managed'] },
  }))
  const hoisted = path.join(root, 'profiles/node_modules/hoisted')
  await mkdir(hoisted, { recursive: true })
  await writeFile(path.join(hoisted, 'package.json'), JSON.stringify({ name: 'hoisted', version: '0.4.0', dsh: { bundle: {} } }))
  return { profile }
}

test('lists Profile bundles and DSH plugin dependencies; hides libraries, DSH, Tavern and managed bundles', async (t) => {
  const { profile } = await fixture(t)
  const { profile: reported, plugins } = listLegacyPlugins(profile)
  assert.equal(reported, profile)
  assert.deepEqual(plugins.map(plugin => plugin.name), ['alpha', 'beta', 'dsh-plugin', 'gamma', 'hoisted', 'missing', 'outside'])
  const hoisted = plugins.find(plugin => plugin.name === 'hoisted')
  assert.deepEqual({ version: hoisted.version, status: hoisted.status }, { version: '0.4.0', status: 'bundle' })
  const byName = Object.fromEntries(plugins.map(plugin => [plugin.name, plugin]))
  assert.deepEqual(
    { version: byName.alpha.version, kind: byName.alpha.kind, status: byName.alpha.status, bundle: byName.alpha.bundle, description: byName.alpha.description },
    { version: '1.2.3', kind: 'registry', status: 'bundle', bundle: true, description: 'first plugin' },
  )
  assert.deepEqual(
    { version: byName.beta.version, kind: byName.beta.kind, status: byName.beta.status, bundle: byName.beta.bundle },
    { version: '2.0.0', kind: 'link', status: 'dependency', bundle: false },
  )
  assert.deepEqual(
    { version: byName.missing.version, kind: byName.missing.kind, status: byName.missing.status, bundle: byName.missing.bundle },
    { version: null, kind: 'registry', status: 'missing', bundle: true },
  )
  assert.deepEqual(
    { kind: byName.gamma.kind, status: byName.gamma.status, bundle: byName.gamma.bundle },
    { kind: 'file', status: 'dependency', bundle: false },
  )
  assert.deepEqual(
    { version: byName.outside.version, kind: byName.outside.kind, status: byName.outside.status, bundle: byName.outside.bundle },
    { version: null, kind: null, status: 'missing', bundle: true },
  )
})

test('returns an empty list when the Profile has no package.json', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-legacy-empty-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(listLegacyPlugins(path.join(root, 'profiles/tavern')), { profile: path.join(root, 'profiles/tavern'), plugins: [] })
})
