import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { parse } from 'acorn'

function assertNoAmbientDocument(source) {
  function visit(node, parameters = new Set()) {
    if (!node || typeof node !== 'object') return
    if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
      parameters = new Set(parameters)
      for (const parameter of node.params) if (parameter.type === 'Identifier') parameters.add(parameter.name)
    }
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'document') {
      assert.ok(parameters.has('document'), 'ambient browser document is forbidden')
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, parameters))
      else if (value && typeof value === 'object') visit(value, parameters)
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }))
}

test('inertness check distinguishes schema document parameters from the browser global', () => {
  assertNoAmbientDocument('function validate(document) { return document.overlay }')
  assert.throws(() => assertNoAmbientDocument('function validate() { return document.overlay }'), /ambient browser/)
  assert.throws(() => assertNoAmbientDocument('function validate(document) {} document.body'), /ambient browser/)
})
import skinContract from '../src/stage-skin.cjs'
import skinSchema from '../schema/skin.schema.json' with { type: 'json' }

test('skin source kinds describe provenance, with specific attribution in notes', () => {
  assert.deepEqual(skinContract.STAGE_SKIN_SOURCE_KINDS, ['official-asset', 'ai-generated', 'original'])
  assert.deepEqual(skinSchema.$defs.license.properties.derived.items.enum, skinContract.STAGE_SKIN_SOURCE_KINDS)
  const skin = { ...structuredClone(skinContract.BUILTIN_STAGE_SKINS.classic), license: { privateUse: true, derived: ['official-asset'], notes: ['Source work and attribution'] } }
  for (const kind of skinContract.STAGE_SKIN_SOURCE_KINDS) {
    skin.license.derived = [kind]
    assert.doesNotThrow(() => skinContract.validateStageSkin(skin))
  }
  skin.license.derived = ['specific-work-title']
  assert.throws(() => skinContract.validateStageSkin(skin), { code: 'INVALID_SKIN' })
})
import * as protocol from '../src/index.js'
import { canonicalJson, assertJson } from '../src/json.js'
const fixture = async name => JSON.parse(await readFile(new URL('../../../../tests/fixtures/presentation/' + name + '.json', import.meta.url), 'utf8'))
const clone = value => structuredClone(value)
const { playback: p, config: c, figure, soundscape } = protocol
const record = await fixture('playback-v3'), config = await fixture('config-v1'), golden = await fixture('reducers')
const rejects = fn => assert.throws(fn, { code: 'INVALID_PRESENTATION' })

test('golden extracted physical, soundscape and lighting results agree', () => {
  for (const item of golden.figure) assert.equal(figure.figureDisplayCm(item.height, 180), item.displayCm)
  for (const item of golden.soundscape) assert.deepEqual(soundscape.soundscapeReplay(golden.start, golden.entries, item.at), item.state)
  assert.deepEqual(p.stageLightingReplay(golden.start, golden.entries), golden.lighting)
})

// baseline retains ambience/train mappings and day/dusk/night-only time looks.
// no per-file source digest golden; the reducer results above pin the shared algorithms' behaviour.

test('existing asset extraction uses content hashes while retaining the lease URL guard', () => {
  // be437602 changed this source before P0; its frozen hash fixture was stale.
  const hash = 'a'.repeat(64), url = '/api/dsh-asset-library/v1/media?ticket=fixture'
  const input = figure.figureInput({ heightCm: 158 }, { kind: 'static', images: { calm: url }, imageSources: { calm: hash } }, 'calm')
  assert.equal(input.source, hash)
  assert.equal(input.sourceUrl, url)
})

test('browser source and Node exports share algorithms without overwriting factory exports', async () => {
  for (const [file, api, expression] of [
    ['figure-scale.cjs', figure, 'figureDisplayCm(152, 180)'],
    ['stage-soundscape.cjs', soundscape, 'soundscapeReplay({scene:"room"}, [], 1)']
  ]) {
    const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8')
    const module = { exports: { sentinel: true } }, ctx = { window: {}, module }
    vm.runInNewContext(source + ';this.result=' + expression, ctx)
    const names = Object.keys(api).filter(key => typeof api[key] === 'function')
    assert.ok(names.length > 2); assert.deepEqual(module.exports, { sentinel: true })
    const nodeResult = Function(...names, 'return ' + expression)(...names.map(key => api[key]))
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.result)), nodeResult)
  }
})

test('package import graph is closed, inert and independent of Tavern/plugin implementations', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.sideEffects, false); assert.equal(manifest.dependencies, undefined); assert.equal(manifest.dsh, undefined)
  assert.deepEqual(Object.keys(manifest.exports), ['.', './asset-packs', './asset-pack-stage', './config', './playback', './figure', './soundscape'])
  for (const file of await readdir(new URL('../src/', import.meta.url))) {
    if (!/\.(?:js|cjs)$/.test(file)) continue
    const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8')
    for (const match of source.matchAll(/(?:from\s+|require\()['"]([^'"]+)['"]/g)) {
      // Package-owned JSON schemas are inert data, not an implementation dependency.
      assert.match(match[1], /^(?:\.\/[^/]+\.(?:cjs|js)|\.\.\/schema\/[\w.-]+\.schema\.json)$/)
      const dependency = await readFile(new URL('../src/' + match[1], import.meta.url), 'utf8')
      if (match[1].endsWith('.json')) assert.equal(typeof JSON.parse(dependency), 'object')
    }
    assertNoAmbientDocument(source)
    assert.doesNotMatch(source, /\b(?:fetch|setTimeout|setInterval|requestAnimationFrame)\s*\(|\b(?:localStorage|process)\.|node:|@deepseek-ai|export\s+function\s+apply\b/)
  }
})

test('current config validates without rewriting unknown fields or inferring bindings', () => {
  const checked = c.validateCurrentStageConfig(config)
  assert.deepEqual(checked, config); assert.notEqual(checked, config)
  checked.unknownExtension.preserved = false; assert.equal(config.unknownExtension.preserved, true)
  for (const path of ['voice', 'voiceLang', 'offstage']) {
    const invalid = clone(config); delete invalid.characters[0][path]; rejects(() => c.validateCurrentStageConfig(invalid))
  }
  const badVersion = clone(config); badVersion.version = 2
  assert.throws(() => c.validateCurrentStageConfig(badVersion), { code: 'MIGRATION_REQUIRED' })
  for (const path of ['protagonist', 'worldview']) {
    const invalid = clone(config); invalid.stage[path] = 'old'
    assert.throws(() => c.validateCurrentStageConfig(invalid), { code: 'MIGRATION_REQUIRED' })
  }
})

test('every schema owner is explicit and cannot replace another owner or claim wildcards', () => {
  const paths = Object.values(c.CONFIG_OWNER_PATHS).flat()
  assert.equal(paths.length, new Set(paths).size)
  assert.equal(c.configFieldOwner('characters[].voice'), 'dialogue'); assert.equal(c.configFieldOwner('characters[].offstage'), 'gal')
  assert.equal(c.configFieldOwner('stage.widgetTuning'), 'widgets')
  for (const key of ['backgrounds', 'music', 'sfx', 'ambience', 'looks', 'widgets']) {
    for (const leaf of ['card', 'libraries']) assert.equal(c.configFieldOwner(`stage.sources.${key}.${leaf}`), 'assets')
  }
  for (const path of ['stage.*', 'characters.*', 'characters', 'stage', 'moods', 'pack', 'characters[].figure', 'stage.protagonist', 'voice', '__proto__']) assert.equal(c.configFieldOwner(path), null)
  for (const path of paths) {
    const parts = path.replace('characters[]', 'characters.0').split('.')
    let field = config
    for (const part of parts) field = field?.[part]
    assert.notEqual(field, undefined, path + ' must match current schema fixture')
  }
})

test('current config rejects invalid bounded fields and unsafe JSON', () => {
  for (const mutate of [v => v.characters.push(clone(v.characters[0])), v => v.characters[0].heightCm = -1,
    v => v.characters[0].avatar = 'javascript:alert(1)', v => v.stage.directorBudget.maxOpsPerCall = 257,
    v => v.stage.widgetTuning.bad = { note: '', scale: 5 }, v => v.stage.sources.music.libraries = ['../escape'],
    v => v.injection.template = 'missing required placeholders']) {
    const bad = clone(config); mutate(bad); assert.throws(() => c.validateCurrentStageConfig(bad))
  }
  assert.deepEqual(c.normalizeStageBudget({ maxToolCalls: 100, maxOpsPerCall: -1 }), { maxToolCalls: 64, maxBeatsPerCall: 8, maxOpsPerCall: 32 })
})

test('v3 codec is deterministic, digest bound and does not mutate input', async () => {
  const before = clone(record), encoded = await p.encodePlaybackRecord(record)
  assert.equal(encoded.recordDigest, createHash('sha256').update(encoded.json).digest('hex'))
  const expected = { target: record.target, publicationDigest: record.publicationDigest, recordDigest: encoded.recordDigest }
  assert.deepEqual(await p.decodePlaybackRecord(encoded.json, expected), record)
  assert.deepEqual(await p.encodePlaybackRecord(JSON.parse(encoded.json)), encoded)
  assert.deepEqual(record, before)
  await assert.rejects(() => p.decodePlaybackRecord(encoded.json, { ...expected, recordDigest: '0'.repeat(64) }), { code: 'DIGEST_MISMATCH' })
  await assert.rejects(() => p.decodePlaybackRecord(encoded.json, { ...expected, target: { ...record.target, revision: 2 } }), { code: 'STALE_TARGET' })
  await assert.rejects(() => p.decodePlaybackRecord(encoded.json, { ...expected, publicationDigest: '0'.repeat(64) }), { code: 'STALE_TARGET' })
})

test('compact state points; seeking never dispatches events and backward replay is silent', () => {
  const duplicate = clone(record); duplicate.changes.push({ at: 3, state: clone(duplicate.changes[0].state) })
  assert.deepEqual(p.compactPlaybackRecord(duplicate), record)
  assert.deepEqual(p.seekPlayback(record, 1), record.start)
  assert.deepEqual(p.seekPlayback(record, 4), record.changes[0].state)
  assert.deepEqual(p.seekPlayback(record, 0), record.start)
  assert.deepEqual(p.playbackEventsBetween(record, 0, 2), record.events)
  assert.deepEqual(p.playbackEventsBetween(record, 2, 2), [])
  assert.deepEqual(p.playbackEventsBetween(record, 4, 1), [])
  assert.equal(p.playbackEventId(record.publicationDigest, 2, 0), record.events[0].id)
  rejects(() => p.seekPlayback(record, 5))
})

test('v3 rejects old formats, malformed bounds, duplicated events, prose copies and metadata leaks', () => {
  for (const version of [undefined, 1, 2, 4]) assert.throws(() => p.validatePlaybackRecord({ ...record, version }), version === undefined ? undefined : { code: 'MIGRATION_REQUIRED' })
  for (const mutate of [v => v.changes[0].at = 5, v => v.changes.push(clone(v.changes[0])), v => v.events.push(clone(v.events[0])),
    v => v.start.phone.messages.push({ text: 'invented' }), v => v.start.order = [], v => v.metadata.prompt = 'secret',
    v => v.start.soundscape.tags = ['open', 'sealed'], v => v.events[0].event.op = 'generate', v => v.units = Infinity]) {
    const bad = clone(record); mutate(bad); rejects(() => p.validatePlaybackRecord(bad))
  }
  const imported = clone(record); imported.canonicalEffectDigest = null
  rejects(() => p.validatePlaybackRecord(imported))
  imported.provenance = { kind: 'offline-import', sourceDigest: record.target.sourceDigest }
  assert.deepEqual(p.validatePlaybackRecord(imported), imported)
})

test('index v3 records bind targets/digests/origin and never accept filesystem paths', async () => {
  const { recordDigest } = await p.encodePlaybackRecord(record)
  const index = { version: 3, records: [{ recordKey: '2-recordhash', target: record.target, publicationDigest: record.publicationDigest, recordDigest, origin: 'canonical-effect' }] }
  assert.deepEqual(index, await fixture('index-v3')) // digest tracks the replay-only record without figure locks
  assert.deepEqual(p.decodePlaybackIndex(p.encodePlaybackIndex(index)), index)
  for (const recordKey of ['../escape', 'C:/record', '/absolute', 'record.json?token=x']) rejects(() => p.validatePlaybackIndex({ ...index, records: [{ ...index.records[0], recordKey }] }))
  assert.throws(() => p.decodePlaybackIndex('{"version":2,"records":[]}'), { code: 'MIGRATION_REQUIRED' })
})

test('standalone state validators reject non-JSON and retain bounded logical widgets', () => {
  const state = clone(record.start)
  state.widgetState.widgets = [{ widgetId: 'note1', type: 'note', props: { text: 'Saved note' }, slot: 'corner-left',
    lifetime: { until: 'explicit' }, bornStoryTime: 0, deadline: null, originKey: record.target.sourceKey, instanceId: 'note1-instance', bornAt: 1, order: 0 }]
  assert.deepEqual(p.validatePlaybackState(state), state)
  const saved = clone(record); saved.start = state
  assert.deepEqual(p.seekPlayback(saved, 0).widgetState, state.widgetState)
  state.widgetState.widgets[0].props.callback = () => {}
  rejects(() => p.validatePlaybackState(state))
  const target = { ...record.target, secret: () => {} }; rejects(() => p.validateTargetRef(target))
})

test('persisted semantic inputs reject media URLs, malformed figure locks and invalid event values', () => {
  for (const mutate of [v => v.start.assetRefs = { scene: { source: 'card', id: 'room', url: 'https://example.invalid/ticket' } },
    v => v.figureCatalog.friend[''][0].heightCm = -1, v => v.start.figureScale = {version:2},
    v => v.soundscapeScenes[0].soundscape.exposure = 'unknown', v => v.events[0].event = { op: 'act', id: 'friend', value: 'unknown' },
    v => v.events[0].id = 'random', v => v.metadata.origin = 'offline-import']) {
    const bad = clone(record); mutate(bad); rejects(() => p.validatePlaybackRecord(bad))
  }
})

test('bounded JSON rejects cycles, dangerous keys, non-JSON values and deep/large documents', () => {
  for (const value of [undefined, NaN, { key: undefined }, new Date(), JSON.parse('{"__proto__":{}}'), Array(3), { f() {} }]) rejects(() => assertJson(value))
  const cyclic = {}; cyclic.self = cyclic; rejects(() => assertJson(cyclic))
  let deep = {}; for (let i = 0; i < 34; i++) deep = { deep }; rejects(() => assertJson(deep))
  rejects(() => assertJson('x'.repeat(2 * 1024 * 1024)))
  assert.equal(canonicalJson({ b: 1, a: { z: 2, c: 3 } }), '{"a":{"c":3,"z":2},"b":1}')
})
