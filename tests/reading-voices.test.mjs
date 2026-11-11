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
import {migrateReadingVoices} from '../tavern-plugin/packages/dsh-tavern-stage/lib/reading-voice-migration.js'
import {validateCardStage} from '../tavern-plugin/lib/domain/card-stage-settings.js'

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

test('an own 通用声音 becomes a voice-only figure in a new unlit pack, 旁白 follows its figure, then the store is dropped', async t => {
  const f = await fixture(t), tts = fakeTts()
  await legacyStore(f, {general:'own', narrator:{link:{packId:PACK_ID, figureId:FIGURE_ID}, language:'ja'}})
  const done = await migrateReadingVoices({library:f.library, tts})
  const made = await f.library.getPackSnapshot({packId:done.pack}), figureId = done.pointers.general.figureId, figure = made.figures[figureId]
  assert.equal(made.manifest.name, '专用声音')
  assert.equal(figure.name, '通用声音')
  assert.equal(figure.voice.language, 'zh', 'spoken as before')
  const spec = made.manifest.voiceLibrary.voices[figure.voice.voice], clips = Object.values(spec.sources).flatMap(s => s.references || [])
  assert.ok(clips.length > 0)
  for (const ref of clips) assert.ok(made.manifest.blobs[ref.media], 'its clips are copied into the pack')
  assert.deepEqual(tts.writes, [{general:{figure:{packId:done.pack, figureId}}, narrator:{figure:{packId:PACK_ID, figureId:FIGURE_ID}}}])
  assert.deepEqual(await f.library.legacyReadingVoices(), [])
  const index = JSON.parse(await readFile(path.join(f.assetRoot,'voice-templates','index.json'),'utf8'))
  assert.equal('readings' in index || 'readingMedia' in index, false)
  assert.equal(await migrateReadingVoices({library:f.library, tts}), null, 'nothing left: nothing written')
  assert.deepEqual(validateCardStage({narrator:{enabled:true, voice:{packId:PACK_ID, figureId:FIGURE_ID}}}).narrator, {enabled:true})
})

test('旁白 never set points at 通用声音\'s figure; a pointer already set is kept', async t => {
  const f = await fixture(t), kept = {packId:PACK_ID, figureId:FIGURE_ID}, tts = fakeTts({general:{figure:null}, narrator:{enabled:false, figure:kept}})
  await legacyStore(f, {general:{link:{packId:PACK_ID, figureId:FIGURE_ID}}})
  const done = await migrateReadingVoices({library:f.library, tts})
  assert.equal(done.pack, null, 'a link needs no new pack')
  assert.deepEqual(done.pointers, {general:kept, narrator:kept})
  assert.deepEqual(tts.writes, [{general:{figure:kept}}], '旁白 already pointed: not rewritten')
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
