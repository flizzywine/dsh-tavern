// Owner bug 2026-11-11: since the stage runtime runs on its own plugin fiber (83b6afa93), its settings sections were read
// from the stage entry's (empty) config: 舞台设置 › 手机 showed 「全局关闭」 for a phone saved as on, and every stage engine
// setting showed its default. The sections live in the dsh-tavern entry; the stage reads and writes them there.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createManagedModSettingsOwner, MANAGED_MOD_SETTINGS_SECTION} from '../tavern-plugin/lib/mod-system-settings.js'
import {createAssetEngineSettings} from '../tavern-plugin/packages/dsh-tavern-stage/lib/asset-engine.js'
import {createDirectorProbeStore, DIRECTOR_PROBE_SECTION} from '../tavern-plugin/lib/director-probe.js'
import {ENGINE_SECTION, defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import * as stage from '../tavern-plugin/packages/dsh-tavern-stage/lib/index.js'

// A 0.2.1+ native settings provider (describe/mutate per profile entry) over two entries: dsh-tavern holds the saved
// sections, the stage plugin's own entry holds none.
function fixture(saved) {
  const documents = {'dsh-tavern': structuredClone(saved), 'dsh-tavern-stage': {}}, revisions = {'dsh-tavern': 7, 'dsh-tavern-stage': 1}, writes = []
  const provider = {
    describe: () => Object.entries(documents).map(([ns, value]) => ({ns, revision: String(revisions[ns]), value})),
    async mutate(ns, ops, revision) {
      assert.equal(revision, String(revisions[ns]))
      for (const op of ops) documents[ns][op.path[0]] = op.value
      revisions[ns]++; writes.push(ns)
    },
  }
  const entry = id => ({fiber: {entry: {options: {id}}, get config() { return Object.fromEntries(Object.entries(documents[id]).map(([key, value]) => [key, {get: () => value}])) }}})
  const context = id => ({...entry(id), get: name => name === 'settings' ? provider : undefined, inject: (_names, fn) => fn({get: () => provider}), effect() {}, on() {}})
  return {host: context('dsh-tavern'), stage: context('dsh-tavern-stage'), documents, writes}
}

test('the stage reads and writes its settings sections in the dsh-tavern entry, not its own', async () => {
  const engine = {...defaultAssetEngineSettings(), actionCaps: {act: 3, beat: 5}}
  const saved = {[MANAGED_MOD_SETTINGS_SECTION]: {version: 1, mods: {'dsh.phone': true, 'dsh.dice': true}, packs: {}, config: {}, preferences: {}},
    [ENGINE_SECTION]: engine, [DIRECTOR_PROBE_SECTION]: {models: {'["a","b"]': true}}}
  const f = fixture(saved)
  const mods = createManagedModSettingsOwner(f.stage, f.host)
  assert.deepEqual(mods.read(), {revision: '7', value: saved[MANAGED_MOD_SETTINGS_SECTION]})
  await mods.compareAndSwap({expectedRevision: '7', expectedValue: saved[MANAGED_MOD_SETTINGS_SECTION], value: {...saved[MANAGED_MOD_SETTINGS_SECTION], mods: {'dsh.phone': false}}})
  assert.deepEqual(f.writes, ['dsh-tavern'])
  assert.deepEqual(f.documents['dsh-tavern-stage'], {})
  assert.deepEqual(createAssetEngineSettings(f.stage, f.host).read().values.actionCaps, {act: 3, beat: 5})
  assert.deepEqual(createDirectorProbeStore(f.stage, f.host).read(), {'["a","b"]': true})
  // Without an owner a section is its own entry's: the stage's empty entry shows the defaults (the bug).
  assert.deepEqual(createManagedModSettingsOwner(f.stage).read().value.mods, {})
})

test('the stage plugin hands the host context to the runtime as its settings owner', async () => {
  let installed
  const host = {name: 'host'}, own = {get: name => name === 'tavernStageControl' ? {install: async load => { installed = await load() }} : undefined, effect() {}}
  await stage.apply(own)
  let seen
  const factories = {assets: core => { seen = core; throw Object.assign(new Error('stop'), {code: 'STOP'}) }, start() {}, services() {}}
  assert.throws(() => installed.createStageRuntime({ctx: Object.assign(host, {effect() {}, get() {}})}, factories), {code: 'STOP'})
  assert.equal(seen.settingsOwner, host)
})
