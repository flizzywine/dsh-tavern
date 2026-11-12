// 通用声音 / 旁白 only point at a figure of the asset library (tts.reading general / narrator .figure).
// The voices kept in the library's retired reading-voice store move once onto figures they then point at; speech opens a
// pointed figure exactly like a cast member, in that figure's 配音语言. Synthetic pack, fake TTS; no provider is called.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {sealPack,jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {figureRefTtsVoice} from '../tavern-plugin/lib/domain/figure-voice.js'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {setupSystemVoices, ensureSystemPack, systemPackKeeper} from '../tavern-plugin/packages/dsh-tavern-stage/lib/system-pack.js'
import systemPack from '../tavern-plugin/packages/dsh-presentation-protocol/src/system-pack.cjs'
import {validateCardStage} from '../tavern-plugin/lib/domain/card-stage-settings.js'

const {SYSTEM_PACK, SYSTEM_FIGURES} = systemPack

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(),'reading-voices-')), pack = await syntheticPack()
  await sealPack(pack.manifest,pack.files)
  const zip = path.join(root,'fixture.zip'); await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([name,data]) => ({path:name,data}))])
  const assetRoot = path.join(root,'assets'), library = createAssetPackService({assetRoot,authorizeLease:async () => true}); t.after(() => library.dispose())
  const inspection = await library.inspectImport({bytes:await readFile(zip)})
  const {snapshot} = await library.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})
  return {library, snapshot, assetRoot, voiceId:snapshot.figures[FIGURE_ID].voice.voice}
}
// The retired store as live has it: `readings` in voice-templates/index.json, an own voice keeping its clips like a template.
async function legacyStore({library, snapshot, assetRoot, voiceId}, readings) {
  const template = await library.saveVoiceTemplate({expectedRevision:null,packId:PACK_ID,packRevision:snapshot.revision,voiceId,binding:{voice:voiceId,language:'zh'}})
  const file = path.join(assetRoot,'voice-templates','index.json'), data = JSON.parse(await readFile(file,'utf8')), item = data.templates[template.templateId]
  data.readings = Object.fromEntries(Object.entries(readings).map(([id,row]) => [id, row === 'own' ? {id,revision:'r-' + id,voiceSpec:item.voiceSpec,binding:{voice:'voice',language:'zh'},blobs:item.blobs} : {id,revision:'r-' + id,...row}]))
  await writeFile(file,JSON.stringify(data))
}
function fakeTts(reading = {general:{figure:null}, narrator:{enabled:true, figure:null}}) {
  const writes = []
  return {writes, reading:() => structuredClone(reading),
    async setReading(patch) { writes.push(structuredClone(patch)); reading = {...reading, ...Object.fromEntries(Object.entries(patch).map(([k,v]) => [k, {...reading[k], ...v}]))}; return structuredClone(reading) }}
}

test('an own 通用声音 goes onto its figure in the 系统设置包, named after it; 旁白 follows its link; then the store is dropped', async t => {
  const f = await fixture(t), tts = fakeTts()
  await legacyStore(f, {general:'own', narrator:{link:{packId:PACK_ID, figureId:FIGURE_ID}, language:'ja'}})
  const done = await setupSystemVoices({library:f.library, tts}), general = {packId:SYSTEM_PACK.id, figureId:SYSTEM_FIGURES.general.id}
  const made = await f.library.getPackSnapshot({packId:SYSTEM_PACK.id}), figure = made.figures[general.figureId]
  assert.deepEqual(done.created, ['general', 'narrator'])
  assert.equal(made.manifest.name, SYSTEM_PACK.name)
  assert.equal(made.manifest.description, SYSTEM_PACK.description)
  assert.equal(figure.name, '通用声音')
  assert.equal(figure.voice.language, 'zh', 'spoken as before')
  const spec = made.manifest.voiceLibrary.voices[figure.voice.voice], clips = Object.values(spec.sources).flatMap(s => s.references || [])
  assert.equal(spec.name, '通用声音', 'the voice is named after its figure, not the voice it was copied from')
  assert.ok(clips.length > 0)
  for (const ref of clips) assert.ok(made.manifest.blobs[ref.media], 'its clips are copied into the pack')
  assert.deepEqual(tts.writes, [{general:{figure:general}, narrator:{figure:{packId:PACK_ID, figureId:FIGURE_ID}}}])
  assert.deepEqual(await f.library.legacyReadingVoices(), [])
  const index = JSON.parse(await readFile(path.join(f.assetRoot,'voice-templates','index.json'),'utf8'))
  assert.equal('readings' in index || 'readingMedia' in index, false)
  assert.equal(await setupSystemVoices({library:f.library, tts}), null, 'nothing left: nothing written')
  assert.deepEqual(validateCardStage({narrator:{enabled:true, voice:{packId:PACK_ID, figureId:FIGURE_ID}}}).narrator, {enabled:true})
})

test('旁白 never set gets a copy of an own 通用声音 on 旁白声音, so each is edited on its own', async t => {
  const f = await fixture(t), tts = fakeTts()
  await legacyStore(f, {general:'own'})
  await setupSystemVoices({library:f.library, tts})
  const made = await f.library.getPackSnapshot({packId:SYSTEM_PACK.id}), general = made.figures[SYSTEM_FIGURES.general.id], narrator = made.figures[SYSTEM_FIGURES.narrator.id]
  assert.equal(narrator.name, '旁白声音')
  assert.notEqual(narrator.voice.voice, general.voice.voice, 'a voice of its own, not shared')
  const voices = made.manifest.voiceLibrary.voices, sources = s => JSON.stringify(s.sources)
  assert.equal(voices[narrator.voice.voice].name, '旁白声音')
  assert.equal(sources(voices[narrator.voice.voice]), sources(voices[general.voice.voice]), 'sounds the same as 通用声音')
  assert.equal(narrator.voice.language, general.voice.language)
  assert.deepEqual(tts.reading().narrator.figure, {packId:SYSTEM_PACK.id, figureId:SYSTEM_FIGURES.narrator.id})
})

test('旁白 never set points at the figure 通用声音 followed; a pointer already set is kept', async t => {
  const f = await fixture(t), kept = {packId:PACK_ID, figureId:FIGURE_ID}, tts = fakeTts({general:{figure:null}, narrator:{enabled:false, figure:kept}})
  await legacyStore(f, {general:{link:{packId:PACK_ID, figureId:FIGURE_ID}}})
  const done = await setupSystemVoices({library:f.library, tts})
  assert.deepEqual(done.migrated.pointers, {general:kept, narrator:kept})
  assert.deepEqual(tts.writes, [{general:{figure:kept}}], '旁白 already pointed: not rewritten, not moved to the system figure either')
})

test('a fresh library gets the 系统设置包 with both figures speaking the browser voice, and the roles point there', async t => {
  const f = await fixture(t), tts = fakeTts()
  assert.deepEqual((await setupSystemVoices({library:f.library, tts})).pointed, ['general', 'narrator'])
  const made = await f.library.getPackSnapshot({packId:SYSTEM_PACK.id})
  for (const role of ['general', 'narrator']) {
    const figure = made.figures[SYSTEM_FIGURES[role].id], spec = made.manifest.voiceLibrary.voices[figure.voice.voice]
    assert.equal(figure.name, SYSTEM_FIGURES[role].name)
    assert.deepEqual(spec.sources, {main:{kind:'preset', provider:'browser'}})
    assert.equal(spec.language, 'zh')
    assert.deepEqual(tts.reading()[role].figure, {packId:SYSTEM_PACK.id, figureId:SYSTEM_FIGURES[role].id})
  }
  // a role the owner unticked stays unticked across restarts.
  await tts.setReading({narrator:{figure:null}})
  assert.equal(await setupSystemVoices({library:f.library, tts}), null)
  assert.equal(tts.reading().narrator.figure, null)
})

test('a deleted 系统设置包 comes back under the same ids with its defaults, so the pointers still work', async t => {
  const f = await fixture(t), tts = fakeTts()
  await setupSystemVoices({library:f.library, tts})
  let pack = await f.library.getPackSnapshot({packId:SYSTEM_PACK.id})
  assert.deepEqual(await ensureSystemPack(f.library), [], 'whole: nothing written')
  await f.library.removePack({packId:SYSTEM_PACK.id, expectedRevision:pack.revision})
  assert.deepEqual(await ensureSystemPack(f.library), ['general', 'narrator'])
  pack = await f.library.getPackSnapshot({packId:SYSTEM_PACK.id})
  assert.equal(pack.manifest.name, SYSTEM_PACK.name)
  const effective = {serviceId:'browser', serviceRevision:'1', capabilities:{}}
  for (const role of ['general', 'narrator']) assert.ok(await figureRefTtsVoice(f.library, {apiVersion:1, resolveVoiceService:async () => ({effective, issues:[]})}, tts.reading()[role].figure), 'the old pointer speaks again')
})
test('one keeper run at a time; a change during a run asks for exactly one more', async () => {
  let runs = 0, release
  const keep = systemPackKeeper(() => { runs++; return new Promise(resolve => { release = resolve }) })
  const first = keep(); keep(); keep()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(runs, 1)
  release(['x']); assert.deepEqual(await first, ['x'])
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(runs, 2, 'the asks during the run became one more run')
  release([])
})
test('a pointed figure speaks with its own voice in its own 配音语言; none = the browser; one gone = VOICE_NOT_FOUND', async t => {
  const {library, snapshot} = await fixture(t), effective = {serviceId:'local', serviceRevision:'1', capabilities:{}}
  const tts = {apiVersion:1, resolveVoiceService:async () => ({effective, issues:[]})}
  assert.deepEqual(await figureRefTtsVoice(library, tts, null), {browser:''})
  const voice = await figureRefTtsVoice(library, tts, {packId:PACK_ID, figureId:FIGURE_ID})
  assert.equal(voice.revision, snapshot.revision)
  assert.equal(voice.voice.languages[0], 'ja', 'the figure\'s own 配音语言')
  const spec = snapshot.manifest.voiceLibrary.voices[snapshot.figures[FIGURE_ID].voice.voice], hash = Object.values(spec.sources).flatMap(s => s.references || [])[0].media
  assert.ok((await voice.readReference(hash)).length > 0, 'its clips are read from its pack')
  await assert.rejects(figureRefTtsVoice(library, tts, {packId:PACK_ID, figureId:'gone'}), {code:'VOICE_NOT_FOUND'})
})
