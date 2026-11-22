// 自动选角's port against the real asset library: the auto-cast writer's context, the
// whole-library search, a casting write (new figure with a library voice, a copy under the speaker's name) and a landing
// write (人设图 + 立绘). Synthetic data only, in a temporary library.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {createAutoCastLibrary} from '../tavern-plugin/packages/dsh-tavern-stage/lib/auto-cast-library.js'
import {selectPackFigure} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/asset-pack-presentation.js'
import { castChanges, createAutoCast } from '../tavern-plugin/packages/dsh-tavern-stage/lib/auto-cast.js'
import {createMediaStore} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media-store.js'
import {apply as applyAssetLibrary} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/plugin.js'
import {createCardAssetBoundary} from '../tavern-plugin/lib/card-asset-bindings.js'
import {roundBody} from '../tavern-plugin/lib/domain/round-body.js'
import {png} from './fixtures/asset-packs/pack.mjs'

const json = value => Buffer.from(JSON.stringify(value))
const source = {chatId:'chat-a', branchId:'branch-a', revision:3, turn:2, messageId:'message-a', paragraphIds:['p-1']}
const TEMPLATE = 'a1a1a1a1-0000-4000-8000-000000000001'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'auto-cast-stage-')), file = join(root, 'card.json'), preparation = createCardPreparation()
  await writeFile(file, JSON.stringify(preparation.create({kind:'import', payload:{name:'春日学园'}})))
  let tail = Promise.resolve()
  const cards = createCardBundleAdapter({cardPreparation:preparation, authorizeTarget:async () => ({cardId:'card-spring'}),
    readWorkspace:async () => JSON.parse(await readFile(file, 'utf8')), writeWorkspace:async (_path, value) => writeFile(file, JSON.stringify(value)),
    withCardLock:(_id, task) => { const next = tail.then(task); tail = next.catch(() => {}); return next }})
  const service = createAssetPackService({assetRoot:join(root, 'assets'), cardTransactions:cards})
  // A 通用 template with a still and a voice, in a pack the card does not use.
  const created = await service.createPack({name:'通用人物', expectedRevision:null})
  const face = png([240, 200, 120]), hash = createHash('sha256').update(face).digest('hex')
  const sprite = {version:2, kind:'layered-static-sprites', character:{id:'figure', name:'傲娇学姐'}, closedBehavior:'restore-base', emotions:{calm:{stage:{src:'assets/calm.png', width:8, height:8}}}}
  const figure = {schemaVersion:1, id:TEMPLATE, enabled:true, appearance:'sprite', recall:{mode:'keyword'}, heightCm:160, name:'傲娇学姐', aliases:['学姐'], description:'嘴硬心软的高年级学姐',
    emotions:[{id:'calm', label:'平和'}], voice:{voice:'tsundere'}, outfits:[{key:'uniform', label:'制服', enabled:true, sprite:{manifestKey:'uniform', assets:{'assets/calm.png':hash}}}]}
  await service.patchPack({packId:created.snapshot.manifest.id, expectedRevision:created.snapshot.revision,
    patch:{figures:[TEMPLATE], sprites:{uniform:'sprites/uniform/manifest.json'}, blobs:{[hash]:{ext:'png', mime:'image/png', size:face.length}},
      voiceLibrary:{version:1, voices:{tsundere:{name:'傲娇少女声', language:'zh', guidance:'傲娇的少女', defaultSource:'browser', sources:{browser:{kind:'preset', provider:'browser', voiceName:'zh-a'}}}}}},
    fileUpdates:new Map([[`media/${hash}.png`, face], ['sprites/uniform/manifest.json', json(sprite)], [`figures/${TEMPLATE}.json`, json(figure)]])})
  // tts.reading(): which figures 通用声音 / 旁白 point at (none until a test points them).
  const world = {reading:null}
  const port = createAutoCastLibrary({getLibrary:() => service, getReading:() => world.reading, pluginApi:{imageCharacterLibraries:async () => []}})
  t.after(async () => { port.dispose(); await service.dispose(); await rm(root, {recursive:true, force:true}) })
  return {service, port, world, templatePack:created.snapshot.manifest.id}
}

test('the port casts through the library\'s auto-cast writer: a new figure with a library voice, a copy, then 人设图 and 立绘 land', async t => {
  const {service, port, templatePack} = await fixture(t)
  assert.equal(port.writable(), true)
  let cast = await port.readCast('card')
  assert.deepEqual([cast.cardId, cast.packId, cast.figures.length], ['card-spring', null, 0], 'no automatic pack before the first write')
  const found = await port.search('傲娇')
  const voice = found.voices.find(row => row.voiceId === 'tsundere'), template = found.figures.find(row => row.ref.figureId === TEMPLATE)
  assert.ok(voice && template)
  const plan = castChanges([{name:'值班老师', aliases:[]}, {name:'冰川理沙', aliases:['理沙']}],
    {same:{}, copy:{冰川理沙:{source:{packId:templatePack, figureId:TEMPLATE}, revision:template.revision}}, appearance:{}, voice:{值班老师:{from:{packId:templatePack, voiceId:'tsundere'}, revision:voice.revision, reason:'讲话尖锐，适合带点锋芒的女声'}}})
  const written = await port.write({cardPath:'card', changes:plan.changes, sources:plan.sources, source, requestId:'cast-1'})
  assert.equal(written.status, 'committed'); assert.equal(written.refs.length, 2)
  cast = await port.readCast('card')
  const teacher = cast.figures.find(row => row.name === '值班老师'), copy = cast.figures.find(row => row.name === '冰川理沙')
  assert.equal(teacher.emotions.length, 9, 'an automatic figure has the nine standard emotions')
  assert.equal(teacher.defaultEmotion, 'calm', 'a line with no mood asks for this one')
  assert.deepEqual([teacher.settei, teacher.sprites], [false, []])
  assert.deepEqual(copy.sprites, ['calm'], 'the copy brings its pictures')
  assert.ok(cast.rows.some(row => row.name === '冰川理沙'), 'the whole cast resolves the new names')
  assert.deepEqual([...cast.voiceKeys], [voice.sound], 'a copied voice still occupies the original sound')
  assert.equal((await port.libraryVoices()).voices.filter(row => row.sound === voice.sound).length, 1, 'the catalogue lists the same sound and language once')
  assert.equal((await service.getPackSnapshot({packId:cast.packId})).figures[teacher.ref.figureId].description, '配音选择：讲话尖锐，适合带点锋芒的女声')
  // On the stage: before its first 立绘 the figure has no outfit (voice only): it speaks in bubbles (name and initial) and is not placed.
  const shown = async emotion => { const pack = await service.getPackSnapshot({packId:cast.packId}); return selectPackFigure(pack.figures[teacher.ref.figureId], pack.sprites || {}, {emotion}) }
  assert.deepEqual([(await shown('joy')).form, (await shown('joy')).diagnostics], [null, ['voice-only']], 'no picture yet: a voice-only figure, not on the stage')  // landing: one write with the 人设图 and a 立绘
  const landed = await port.write({cardPath:'card', source, requestId:'land-1', images:{i0:png([10, 20, 30]), i1:png([200, 100, 50])},
    changes:[{op:'patch', kind:'figures', ref:{packId:cast.packId, kind:'figures', figureId:teacher.ref.figureId}, settei:{image:'i0'}, sprites:[{emotion:'joy', image:'i1'}]}]})
  assert.equal(landed.status, 'committed')
  const after = (await port.readCast('card')).figures.find(row => row.name === '值班老师')
  assert.equal(after.settei, true); assert.deepEqual(after.sprites, ['joy'])
  const angry = await shown('anger')
  assert.equal(angry.form, 'sprite', 'the first 立绘 puts the figure on the stage')
  assert.equal(angry.state?.id, (await shown('joy')).state?.id, 'an emotion not drawn yet shows the picture the figure has')
  // a landing after the cast was read (another picture) does not stale the read: the hash names the picture
  await port.write({cardPath:'card', source, requestId:'land-2', images:{i0:png([90, 90, 90])}, changes:[{op:'patch', kind:'figures', ref:{packId:cast.packId, kind:'figures', figureId:teacher.ref.figureId}, sprites:[{emotion:'sad', image:'i0'}]}]})
  assert.equal((await port.readMedia({packId:cast.packId, hash:after.setteiHash})).length > 0, true)
})

// 主人 11-15: only 通用声音 (the voice page's switch, else a voice written a 使用情景 before the switch) are offered to the assistant.
test('the assistant\'s voice candidates are 可选声音 「默认」: a 使用情景, or a voice of the pack 通用声音 / 旁白 point at; never by name; the old switch is not read', async t => {
  const {service, port, world, templatePack} = await fixture(t)
  const pack = await service.getPackSnapshot({packId:templatePack}), base = pack.manifest.voiceLibrary.voices.tsundere
  const {guidance:_g, ...plain} = base
  const sources = voiceName => ({browser:{kind:'preset', provider:'browser', voiceName}})
  await service.patchPack({packId:templatePack, expectedRevision:pack.revision, patch:{voiceLibrary:{version:1, voices:{tsundere:base, off:{...base, name:'关掉的', autoCast:false, sources:sources('zh-b')}, own:{...plain, name:'萌宝', autoCast:true}, on:{...plain, name:'通用男性声音', sources:sources('zh-c')}}}}})
  assert.deepEqual((await port.libraryVoices()).voices.map(row => row.name), ['傲娇少女声', '关掉的'], '「通用」 in a name alone is not a 使用情景')
  assert.deepEqual((await port.search('傲娇')).voices.map(row => row.voiceId), ['tsundere', 'off'], 'the search offers the same candidates')
  // a system pack (the one 通用声音 points at): all its voices, with or without a 使用情景
  const system = await service.createPack({name:'系统设置', expectedRevision:null})
  await service.patchPack({packId:system.snapshot.manifest.id, expectedRevision:system.snapshot.revision, patch:{voiceLibrary:{version:1, voices:{male:{...plain, name:'系统既有男声', sources:sources('zh-d')}}}}})
  world.reading = {general:{figure:{packId:system.snapshot.manifest.id, figureId:'f1'}}, narrator:{enabled:false, figure:null}}
  assert.deepEqual((await port.libraryVoices()).voices.map(row => row.name), ['傲娇少女声', '关掉的', '系统既有男声'])
  assert.deepEqual((await port.search('男声')).voices.map(row => row.name), ['系统既有男声'])
  // 先定语言（主人 11-22）: one language's voices only, by the voice's own language (unset = 中文, zh-CN = zh); the system
  // pack's are that language's 默认通用声音 (fallback)
  const current = await service.getPackSnapshot({packId:system.snapshot.manifest.id})
  await service.patchPack({packId:current.manifest.id, expectedRevision:current.revision, patch:{voiceLibrary:{version:1, voices:{male:{...plain, name:'系统既有男声', language:'zh-CN', sources:sources('zh-d')},
    jaMale:{...plain, name:'系统既有男声（日语）', language:'ja', sources:sources('ja-a')}}}}})
  const of = async language => (await port.libraryVoices(language)).voices.map(row => [row.name, row.language, row.fallback ?? false])
  assert.deepEqual(await of('zh'), [['傲娇少女声', 'zh', false], ['关掉的', 'zh', false], ['系统既有男声', 'zh', true]])
  assert.deepEqual(await of('ja'), [['系统既有男声（日语）', 'ja', true]])
  assert.deepEqual(await of('ko'), [], 'a language without a voice lists none: nothing of another language fills it')
  await assert.rejects(service.patchPack({packId:templatePack, expectedRevision:(await service.getPackSnapshot({packId:templatePack})).revision, patch:{voiceLibrary:{version:1, voices:{bad:{...base, autoCast:'yes'}}}}}), {code:'INVALID_INPUT'})
})
test('a committed round through the asset library plugin\'s own service: new speakers are written, counted and drawn', async t => {
  const root = await mkdtemp(join(tmpdir(), 'auto-cast-plugin-')), preparation = createCardPreparation()
  let workspace = preparation.create({kind:'import', payload:{name:'青鸟'}}), tail = Promise.resolve()
  const bindings = createCardAssetBoundary({ctx:{get:() => undefined}, listCards:async () => [{path:'cards/cafe.json'}], readWorkspace:async () => workspace})
  const cards = createCardBundleAdapter({dependencies:request => bindings.dependencies(request), cardPreparation:preparation, authorizeTarget:async () => ({cardId:'card-cafe'}), readWorkspace:async () => workspace,
    writeWorkspace:async (_path, value) => { workspace = value }, withCardLock:(_id, task) => { const next = tail.then(task); tail = next.catch(() => {}); return next }})
  const services = new Map([['tavernAssetCards', {apiVersion:2, ...cards}], ['tavernMediaStore', createMediaStore({root})]]), cleanup = []
  applyAssetLibrary({get:key => services.get(key), provide:(key, value) => services.set(key, value), on() {}, inject() {}, effect:setup => cleanup.push(setup()), logger:{warn() {}}}, {assetRoot:root})
  const files = new Map(), errors = [], drawn = []
  const store = {readJson:async k => files.get(k) ?? null, writeJson:async (k, v) => files.set(k, v), updateJson:async (k, fn) => files.set(k, fn(files.get(k) ?? null)),
    readBytes:async k => files.get(k), writeBytes:async (k, v) => files.set(k, v), remove:async k => files.delete(k)}
  const port = createAutoCastLibrary({getLibrary:() => services.get('assetLibrary')})
  const cast = createAutoCast({store, settings:async () => ({enabled:true, level:'aggressive', sprites:true, voices:true}), library:port, onError:error => errors.push(error),
    images:{status:async () => ({ready:true, model:'m'}), prompt:async input => ({prompt:input.kind, output:{size:'1536x1024', background:'opaque', quality:'high'}}), check:() => ({warnings:[], hasTransparency:false}),
      generate:async input => { drawn.push(input); return {data:new Uint8Array(png([1, 2, 3])), mediaType:'image/png'} }}})
  t.after(async () => { cast.dispose(); for (const dispose of cleanup.reverse()) await dispose?.(); await rm(root, {recursive:true, force:true}) })
  const text = '@bubble:xiaolin|小林|喜悦|[欢迎光临！]\n@bubble:lao_chen|老陈||[拿铁。]'
  const chat = {id:'chat-a', sessionId:'chat-a', cardPath:'cards/cafe.json', macroState:{userName:'玩家'}, timeline:{branchId:'branch-a', revision:2}, messages:[{id:'m2', role:'assistant', turn:2, sourceText:text}]}
  await cast.round('cards/cafe.json', roundBody([{kind:'markdown', text}], {chatId:chat.id, branchId:'branch-a', turn:2}), chat)
  assert.deepEqual(errors, [])
  const read = await port.readCast('cards/cafe.json')
  assert.deepEqual(read.figures.map(row => row.name).sort(), ['小林', '老陈'])
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(drawn.length >= 1, 'a 人设图 is drawn for the figure asked for')
})
