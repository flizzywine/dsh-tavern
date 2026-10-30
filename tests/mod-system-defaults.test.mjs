import test from 'node:test'
import assert from 'node:assert/strict'
import { firstPartyDistributions } from '../tavern-plugin/lib/mod-system-distributions.js'
import { emptyCardMods, emptyGlobalMods } from '../tavern-plugin/lib/domain/mod-system-contract.js'
import { resolveMods, resolveSwitch } from '../tavern-plugin/lib/domain/mod-system.js'
import { defaultModSettings } from '../tavern-plugin/lib/mod-owners.js'
import { createManagedModManager } from '../tavern-plugin/lib/domain/mod-system-manager.js'

const distributions = await firstPartyDistributions()
const manifests = distributions.map(row => row.manifest)

test('first-party distributions are packaged but a fresh profile enables none', () => {
  assert.equal(manifests.length, 5)
  assert.deepEqual(defaultModSettings().global.enabledModIds, [])
  assert.deepEqual(resolveMods({ manifests }).enabled, [])
  for (const row of distributions) {
    assert.equal(row.manifest.experimental, true)
    const entry = row.entries.find(file => file.path === 'plugins/' + row.folder + '/' + row.manifest.entry)
    assert.ok(entry.data.length > 0)
  }
})

test('fresh-profile manager exposes experimental mods off and an explicit global choice enables one', async () => {
  const global = emptyGlobalMods()
  const manager = createManagedModManager({
    authorize: async () => 'test-owner',
    installations: { read: async () => ({ revision: 1, value: { releases: manifests.map(manifest => ({ manifest, active: true, installed: true, authorized: true })) } }) },
    settings: { read: async () => ({ revision: 1, value: global }) },
  })
  const fresh = await manager.call('managedModsList')
  assert.equal(fresh.mods.length, 5)
  assert.ok(fresh.mods.every(row => row.experimental && !row.switches.global && !row.switches.effective))
  global.mods['dsh.dice'] = true
  const enabled = await manager.call('managedModsList')
  assert.deepEqual(enabled.mods.filter(row => row.switches.effective).map(row => row.id), ['dsh.dice'])
})

test('four switch states preserve explicit card-off over global-on', () => {
  for (const [global, card, enabled] of [
    [false, undefined, false], [true, undefined, true],
    [false, 'on', true], [true, 'on', true],
    [false, 'off', false], [true, 'off', false],
  ]) assert.equal(resolveSwitch(global, card), enabled)
  const global = emptyGlobalMods(), card = emptyCardMods()
  global.mods['dsh.dice'] = true
  assert.deepEqual(resolveMods({ manifests, global, card }).enabled, ['dsh.dice'])
  card.mods['dsh.dice'] = 'off'
  assert.deepEqual(resolveMods({ manifests, global, card }).enabled, [])
})

test('an unavailable required dependency with error policy blocks execution', () => {
  const manifest = structuredClone(manifests.find(row => row.id === 'dsh.dice'))
  manifest.dependencies = [{ id: 'example.required', range: '^1.0.0', onMissing: 'error' }]
  const global = emptyGlobalMods()
  global.mods[manifest.id] = true
  const result = resolveMods({ manifests: [manifest], global })
  assert.deepEqual(result.enabled, [])
  assert.deepEqual(result.blocked, [manifest.id])
  assert.equal(result.dependencies[manifest.id][0].reason, 'missing')
})
