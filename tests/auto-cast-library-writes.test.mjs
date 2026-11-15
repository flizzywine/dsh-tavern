// 自动素材 · 素材库: automatic figures with the standard 差分, the casting writer (copy + rename, voice, 人设图, still images,
// several changes in one write, receipts and undo) and the whole-library search.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {searchLibrary} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/library-search.js'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {cardBubbleConfig} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {bubbleFigureEntries} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {png} from './fixtures/asset-packs/pack.mjs'
import {stageEnabledEngineSettings} from './helpers/stage-enabled-settings.mjs'

const {selectFigureAvatar} = createRequire(import.meta.url)('../tavern-plugin/lib/domain/pack-avatar.cjs')
const LABELS = ['平和','喜悦','愤怒','悲伤','紧张','害羞','嫌弃','爱恋','哭泣']
const browserVoice = (name, voiceName) => ({name, language:'zh', defaultSource:'browser', sources:{browser:{kind:'preset', provider:'browser', voiceName}}})
const json = value => Buffer.from(JSON.stringify(value))
const source = {chatId:'chat-a', branchId:'branch-a', revision:3, turn:2, messageId:'message-a', paragraphIds:['p-1']}

// A hand-made pack in the library: a 通用 template figure with a still sprite and a voice.
async function libraryPack(service, {name, figureId, figure, voices = {}}) {
  const created = await service.createPack({name, expectedRevision:null})
  const face = png([240, 200, 120]), hash = (await import('node:crypto')).createHash('sha256').update(face).digest('hex')
  const sprite = {version:2, kind:'layered-static-sprites', character:{id:'figure', name:figure.name}, closedBehavior:'restore-base', emotions:{calm:{stage:{src:'assets/calm.png', width:8, height:8}}}}
  const document = {schemaVersion:1, id:figureId, enabled:true, appearance:'sprite', recall:{mode:'keyword'}, heightCm:160,
    emotions:[{id:'calm', label:'平和'}, {id:'joy', label:'喜悦'}], ...figure,
    outfits:[{key:'uniform', label:'制服', enabled:true, sprite:{manifestKey:'uniform', assets:{'assets/calm.png':hash}}}]}
  const result = await service.patchPack({packId:created.snapshot.manifest.id, expectedRevision:created.snapshot.revision,
    patch:{figures:[figureId], sprites:{uniform:'sprites/uniform/manifest.json'}, blobs:{[hash]:{ext:'png', mime:'image/png', size:face.length}}, ...(Object.keys(voices).length ? {voiceLibrary:{version:1, voices}} : {})},
    fileUpdates:new Map([[`media/${hash}.png`, face], ['sprites/uniform/manifest.json', json(sprite)], [`figures/${figureId}.json`, json(document)]])})
  return result.snapshot
}

async function fixture(t, {looks = {}} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'auto-cast-library-')), file = join(root, 'card.json')
  const preparation = createCardPreparation()
  await writeFile(file, JSON.stringify(preparation.create({kind:'import', payload:{name:'春日学园'}})))
  let tail = Promise.resolve()
  const lock = (_id, task) => { const next = tail.then(task); tail = next.catch(() => {}); return next }
  const cards = createCardBundleAdapter({cardPreparation:preparation, authorizeTarget:async () => ({cardId:'card-spring'}),
    readWorkspace:async () => JSON.parse(await readFile(file, 'utf8')), writeWorkspace:async (_path, value) => writeFile(file, JSON.stringify(value)), withCardLock:lock})
  const service = createAssetPackService({assetRoot:join(root, 'assets'), cardTransactions:cards,
    figureImageExtras:async ({figureIds}) => Object.fromEntries(figureIds.filter(id => looks[id]).map(id => [id, looks[id]]))})
  const speakers = service.registerAutomaticWriter({writerId:'auto-figure', plan:({context}) => context.changes})
  const caster = service.registerAutomaticWriter({writerId:'auto-cast', plan:({context}) => context.changes})
  t.after(async () => { speakers.dispose(); caster.dispose(); await service.dispose(); await rm(root, {recursive:true, force:true}) })
  let n = 0
  async function write(writer, changes, images) {
    const context = await writer.readContext({path:'card'}), all = (await service.listPackSummaries())
    const rows = Array.isArray(all) ? all : all.packs
    const input = {path:'card', expectedCardRevision:context.card.revision, target:context.target,
      catalogueRevisions:rows.map(row => ({packId:row.packId, revision:row.revision})), requestId:'request-' + ++n,
      source:{kind:'test', occurrenceId:'occurrence-' + n}, changes, ...(images ? {images} : {})}
    return service.writeAutomaticItems(input, writer.authorize(input, source, {changes}))
  }
  return {service, cards, speakers, caster, write}
}

test('an automatic speaker comes with the nine standard 差分 and the speaker roster offers them', async t => {
  const f = await fixture(t), written = await f.write(f.speakers, [{op:'create', kind:'figures', value:{name:'值班老师', aliases:['老师']}}])
  const pack = await f.service.getPackSnapshot({packId:written.packId}), figure = pack.figures[written.refs[0].figureId]
  assert.deepEqual(figure.emotions.map(row => row.label), LABELS)
  assert.equal(figure.appearance, 'avatar')
  const card = await f.cards.snapshot({path:'card'})
  const config = cardBubbleConfig(card.raw, stageEnabledEngineSettings(), [pack])
  const [roster] = bubbleFigureEntries(config)
  assert.match(roster.content, /值班老师/)
  for (const label of LABELS) assert.ok(roster.content.includes(label), label + ' is offered')
})

test('the casting writer copies a template from any installed pack under the NPC name, voice and 外貌 included, and undo removes it all', async t => {
  const templateId = 'a1a1a1a1-0000-4000-8000-000000000001'
  const f = await fixture(t, {looks:{[templateId]:{views:{front:'金发双马尾'}}}})
  const template = await libraryPack(f.service, {name:'通用人物', figureId:templateId,
    figure:{name:'傲娇学姐', aliases:['学姐'], description:'嘴硬心软的高年级学姐', voice:{voice:'tsundere'}}, voices:{tsundere:browserVoice('傲娇少女声', 'zh-a')}})
  const copied = await f.write(f.caster, [{op:'copy', kind:'figures', source:{packId:template.manifest.id, figureId:templateId}, patch:{name:'冰川理沙', aliases:['理沙']}}])
  assert.equal(copied.status, 'committed')
  const pack = await f.service.getPackSnapshot({packId:copied.packId}), figure = pack.figures[copied.refs[0].figureId]
  assert.notEqual(copied.packId, template.manifest.id)
  assert.equal(pack.manifest.name, '春日学园 · 自动素材')
  assert.equal(figure.name, '冰川理沙'); assert.deepEqual(figure.aliases, ['理沙'])
  assert.equal(figure.description, '嘴硬心软的高年级学姐')
  assert.equal(figure.outfits[0].sprite.assets['assets/calm.png'], template.figures[templateId].outfits[0].sprite.assets['assets/calm.png'])
  assert.equal(pack.manifest.voiceLibrary.voices[figure.voice.voice].name, '傲娇少女声')
  assert.deepEqual(figure.extensions['dsh.image-character'], {views:{front:'金发双马尾'}})
  assert.deepEqual(figure.extensions.dsh_tavern.copiedFrom, {packId:template.manifest.id, figureId:templateId})
  assert.equal(figure.extensions['dsh.automatic-write'].writerId, 'auto-cast')
  // the template is untouched; a copy without a new name keeps the original one
  assert.equal((await f.service.getPackSnapshot({packId:template.manifest.id})).revision, template.revision)
  const same = await f.write(f.caster, [{op:'copy', kind:'figures', source:{packId:template.manifest.id, figureId:templateId}}])
  const plain = (await f.service.getPackSnapshot({packId:copied.packId})).figures[same.refs[0].figureId]
  assert.equal(plain.name, '傲娇学姐')
  assert.equal(plain.voice.voice, 'tsundere-2', 'each copy owns its voice, as an ordinary copy does')
  // the host moving the carried 外貌 into the 配图 record is not an edit: undo still works
  const {'dsh.image-character':_look, ...kept} = figure.extensions
  const moved = await f.service.patchFigure({packId:copied.packId, expectedRevision:same.revision, figureId:figure.id, patch:{extensions:kept}})
  const undone = await f.service.undoAutomaticWrite({packId:copied.packId, expectedRevision:moved.snapshot.revision, writeId:copied.writeId})
  assert.equal(undone.status, 'undone')
  const after = await f.service.getPackSnapshot({packId:copied.packId})
  assert.deepEqual(Object.values(after.figures).map(row => row.name), ['傲娇学姐'])
  const last = await f.service.undoAutomaticWrite({packId:copied.packId, expectedRevision:after.revision, writeId:same.writeId})
  const empty = await f.service.getPackSnapshot({packId:copied.packId})
  assert.equal(last.status, 'undone')
  assert.deepEqual(empty.manifest.figures, []); assert.deepEqual(empty.manifest.sprites, {}); assert.deepEqual(empty.manifest.blobs, {})
  assert.deepEqual(empty.manifest.voiceLibrary.voices, {})
})

test('one write creates figures with a voice, a 人设图 and their first still; later writes add a 差分 by its Chinese name; undo restores each step', async t => {
  const f = await fixture(t)
  const first = await f.write(f.caster, [
    {op:'create', kind:'figures', value:{name:'猫耳少女', aliases:['猫耳'], description:'活泼的路人观众'}, voice:{spec:browserVoice('元气少女', 'zh-b'), language:'zh'},
      settei:{image:'settei'}, sprites:[{emotion:'calm', image:'calm'}]},
    {op:'create', kind:'figures', value:{name:'狐狸面具摊主', aliases:[]}}
  ], {settei:png([10, 20, 30]), calm:png([200, 100, 50])})
  assert.equal(first.refs.length, 2)
  let pack = await f.service.getPackSnapshot({packId:first.packId})
  const cat = pack.figures[first.refs[0].figureId], stall = pack.figures[first.refs[1].figureId]
  assert.equal(cat.appearance, 'sprite'); assert.equal(stall.appearance, 'avatar')
  assert.deepEqual(cat.voice, {voice:'auto-voice', language:'zh'})
  assert.equal(pack.manifest.voiceLibrary.voices['auto-voice'].name, '元气少女')
  assert.ok(pack.manifest.blobs[cat.identitySettei.board])
  const outfit = cat.outfits[0]
  assert.deepEqual([outfit.key, outfit.label, outfit.enabled, outfit.defaultEmotion], ['default', '默认', true, undefined])
  const avatar = selectFigureAvatar(cat, pack.sprites)
  assert.equal(avatar.hash, Object.values(outfit.sprite.assets)[0], 'the avatar is the still image\'s top crop')
  assert.ok(avatar.crop)
  // a later round: the joy image lands (asked for by its label), the second figure's first still is joy, in one write
  const second = await f.write(f.caster, [
    {op:'patch', kind:'figures', ref:first.refs[0], patch:{guidance:'只在观众席出现'}, sprites:[{emotion:'喜悦', image:'joy'}]},
    {op:'patch', kind:'figures', ref:first.refs[1], sprites:[{emotion:'喜悦', image:'joy'}]}
  ], {joy:png([255, 220, 0])})
  pack = await f.service.getPackSnapshot({packId:first.packId})
  const sprite = pack.sprites[pack.figures[cat.id].outfits[0].sprite.manifestKey]
  assert.deepEqual(Object.keys(sprite.emotions).sort(), ['calm', 'joy'])
  assert.equal(pack.figures[cat.id].guidance, '只在观众席出现')
  assert.equal(pack.figures[stall.id].outfits[0].defaultEmotion, 'joy', 'until 平和 is drawn the first still is the default face')
  assert.equal(pack.figures[stall.id].appearance, 'sprite')
  const undoSecond = await f.service.undoAutomaticWrite({packId:first.packId, expectedRevision:second.revision, writeId:second.writeId})
  pack = await f.service.getPackSnapshot({packId:first.packId})
  assert.deepEqual(Object.keys(pack.sprites[pack.figures[cat.id].outfits[0].sprite.manifestKey].emotions), ['calm'])
  assert.equal(pack.figures[cat.id].guidance, undefined)
  assert.equal(pack.figures[stall.id].appearance, 'avatar'); assert.deepEqual(pack.figures[stall.id].outfits, [])
  assert.equal(Object.keys(pack.manifest.blobs).length, 2, 'the joy image left with its write')
  await f.service.undoAutomaticWrite({packId:first.packId, expectedRevision:undoSecond.revision, writeId:first.writeId})
  pack = await f.service.getPackSnapshot({packId:first.packId})
  assert.deepEqual(pack.manifest.figures, []); assert.deepEqual(pack.manifest.blobs, {}); assert.deepEqual(pack.manifest.voiceLibrary.voices, {})
})

test('the write entry checks its input once and says what to fix', async t => {
  const f = await fixture(t)
  const made = await f.write(f.caster, [{op:'create', kind:'figures', value:{name:'护士', aliases:[]}, sprites:[{emotion:'平和', image:'calm'}]}], {calm:png([1, 2, 3])})
  const ref = made.refs[0]
  await assert.rejects(f.write(f.caster, [{op:'patch', kind:'figures', ref, sprites:[{emotion:'joy', image:'bad'}]}], {bad:Buffer.from('GIF89a not a png')}), /PNG/)
  await assert.rejects(f.write(f.caster, [{op:'patch', kind:'figures', ref, sprites:[{emotion:'惊讶', image:'x'}]}], {x:png([4, 5, 6])}), error => error.code === 'MISSING_DEPENDENCY' && /平和/.test(error.message))
  await assert.rejects(f.write(f.caster, [{op:'patch', kind:'figures', ref, sprites:[{emotion:'calm', image:'x'}]}], {x:png([4, 5, 6])}), {code:'DUPLICATE_ID'})
  const other = await libraryPack(f.service, {name:'别的包', figureId:'b2b2b2b2-0000-4000-8000-000000000002', figure:{name:'流浪汉', aliases:[]}})
  await assert.rejects(f.write(f.caster, [{op:'patch', kind:'figures', ref:{packId:other.manifest.id, kind:'figures', figureId:'b2b2b2b2-0000-4000-8000-000000000002'}, patch:{name:'改名'}}]), {code:'NOT_AUTHORIZED_WRITER'})
  // the speaker writer only names new speakers
  await assert.rejects(f.write(f.speakers, [{op:'copy', kind:'figures', source:{packId:other.manifest.id, figureId:'b2b2b2b2-0000-4000-8000-000000000002'}}]), {code:'NOT_AUTHORIZED_WRITER'})
  await assert.rejects(f.write(f.speakers, [{op:'create', kind:'figures', value:{name:'甲', aliases:[]}}], {x:png([1, 1, 1])}), {code:'NOT_AUTHORIZED_WRITER'})
})

test('a speaker created before the standard 差分 existed gets them with its next casting change', async t => {
  const f = await fixture(t), made = await f.write(f.speakers, [{op:'create', kind:'figures', value:{name:'面包店的老奶奶', aliases:['老奶奶']}}])
  const old = await f.service.patchFigure({packId:made.packId, expectedRevision:made.revision, figureId:made.refs[0].figureId, patch:{emotions:[]}})
  assert.deepEqual(old.snapshot.figures[made.refs[0].figureId].emotions, [])
  await f.write(f.caster, [{op:'patch', kind:'figures', ref:made.refs[0], sprites:[{emotion:'紧张', image:'a'}]}], {a:png([9, 9, 9])})
  const figure = (await f.service.getPackSnapshot({packId:made.packId})).figures[made.refs[0].figureId]
  assert.deepEqual(figure.emotions.map(row => row.label), LABELS)
  assert.equal(figure.outfits[0].defaultEmotion, 'anxious')
})

test('the library search finds people and voices in every installed pack and lists every figure a name belongs to', async t => {
  const f = await fixture(t)
  const a = await libraryPack(f.service, {name:'春物 Oregairu', figureId:'c3c3c3c3-0000-4000-8000-000000000003', figure:{name:'雪之下雪乃', aliases:['雪乃', 'Yukino'], description:'毒舌的侍奉部部长', voice:{voice:'yukino'}}, voices:{yukino:browserVoice('雪乃的声音', 'ja-a')}})
  await libraryPack(f.service, {name:'通用人物', figureId:'d4d4d4d4-0000-4000-8000-000000000004', figure:{name:'通用学姐', aliases:['学姐']}})
  await libraryPack(f.service, {name:'校园日常', figureId:'e5e5e5e5-0000-4000-8000-000000000005', figure:{name:'学生会长', aliases:['学姐']}})
  const yukino = await f.caster.searchLibrary({query:'雪乃'})
  assert.deepEqual(yukino.identity, {status:'resolved', ref:{packId:a.manifest.id, figureId:'c3c3c3c3-0000-4000-8000-000000000003'}})
  assert.deepEqual(yukino.figures.map(row => [row.name, row.packName, row.outfits, row.emotions, row.stage, row.copyable, row.match]), [['雪之下雪乃', '春物 Oregairu', 1, 2, true, true, 'exact']])
  assert.equal(yukino.figures[0].voice.name, '雪乃的声音')
  assert.equal(yukino.figures[0].revision, a.revision)
  assert.deepEqual(yukino.voices, [], 'her own voice is no 通用声音')
  const senpai = await f.caster.searchLibrary({query:'学姐'})
  assert.equal(senpai.identity.status, 'ambiguous')
  assert.deepEqual(senpai.figures.map(row => row.name).sort(), ['学生会长', '通用学姐'])
  assert.deepEqual((await f.caster.searchLibrary({query:'毒舌'})).figures.map(row => [row.name, row.match]), [['雪之下雪乃', 'text']])
  // a figure's own voice (no 使用情景, switch never set) is no candidate: not listed, not found.
  assert.deepEqual((await f.caster.listLibraryVoices()).voices, [])
})

test('a voice\'s 使用情景 is saved, found by the library search and survives export and import', async t => {
  const f = await fixture(t)
  const pack = await libraryPack(f.service, {name:'通用声音', figureId:'f6f6f6f6-0000-4000-8000-000000000006', figure:{name:'大叔', aliases:[], voice:{voice:'uncle'}}, voices:{uncle:browserVoice('沉稳大叔', 'zh-c')}})
  const saved = await f.service.savePackVoice({packId:pack.manifest.id, expectedRevision:pack.revision, figureId:'f6f6f6f6-0000-4000-8000-000000000006', voiceId:'uncle', voiceSpec:{...browserVoice('沉稳大叔', 'zh-c'), guidance:'适合中年男性'}})
  await assert.rejects(f.service.savePackVoice({packId:pack.manifest.id, expectedRevision:saved.snapshot.revision, figureId:'f6f6f6f6-0000-4000-8000-000000000006', voiceId:'uncle', voiceSpec:{...browserVoice('沉稳大叔', 'zh-c'), guidance:'长'.repeat(61)}}), {code:'INVALID_INPUT'})
  assert.deepEqual((await f.caster.searchLibrary({query:'中年'})).voices.map(row => row.guidance), ['适合中年男性'])
  // 通用声音: a 使用情景 from before the switch counts as on; the switch off hides it and keeps the words.
  assert.deepEqual((await f.caster.listLibraryVoices()).voices.map(row => row.name), ['沉稳大叔'])
  const off = await f.service.savePackVoice({packId:pack.manifest.id, expectedRevision:saved.snapshot.revision, figureId:'f6f6f6f6-0000-4000-8000-000000000006', voiceId:'uncle', voiceSpec:{...browserVoice('沉稳大叔', 'zh-c'), guidance:'适合中年男性', autoCast:false}})
  assert.deepEqual([(await f.caster.listLibraryVoices()).voices, (await f.caster.searchLibrary({query:'中年'})).voices], [[], []])
  assert.equal(off.snapshot.manifest.voiceLibrary.voices.uncle.guidance, '适合中年男性')
  await f.service.savePackVoice({packId:pack.manifest.id, expectedRevision:off.snapshot.revision, figureId:'f6f6f6f6-0000-4000-8000-000000000006', voiceId:'uncle', voiceSpec:{...browserVoice('沉稳大叔', 'zh-c'), guidance:'适合中年男性'}})
  const {readSmallArchive} = await import('./fixtures/asset-packs/pack.mjs')
  const bytes = await readSmallArchive(await f.service.exportPack({packId:pack.manifest.id, expectedRevision:(await f.service.getPackSnapshot({packId:pack.manifest.id})).revision}))
  const otherRoot = await mkdtemp(join(tmpdir(), 'auto-cast-library-import-')), other = createAssetPackService({assetRoot:otherRoot})
  t.after(async () => { await other.dispose(); await rm(otherRoot, {recursive:true, force:true}) })
  const preview = await other.inspectImport({bytes})
  const installed = await other.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision:'install'})
  assert.equal(installed.snapshot.manifest.voiceLibrary.voices.uncle.guidance, '适合中年男性')
})

test('the library search reads a voice\'s 使用场景', () => {
  const pack = {revision:'r1', manifest:{id:'pack-voices', name:'通用声音', figures:['figure-uncle'], voiceLibrary:{version:1, voices:{
    uncle:{...browserVoice('沉稳大叔', 'zh-c'), guidance:'适合中年男性'}, girl:{...browserVoice('甜妹', 'zh-d'), guidance:'傲娇金发少女的声音'}}}},
  figures:{'figure-uncle':{id:'figure-uncle', name:'大叔', enabled:true, emotions:[], outfits:[], voice:{voice:'uncle'}}}}
  const found = searchLibrary([pack], {query:'中年'})
  assert.deepEqual(found.voices.map(row => [row.voiceId, row.name, row.guidance, row.figures]), [['uncle', '沉稳大叔', '适合中年男性', ['大叔']]])
  assert.deepEqual(found.figures.map(row => [row.name, row.voice.guidance]), [['大叔', '适合中年男性']])
  assert.deepEqual(searchLibrary([pack], {query:'傲娇 少女'}).voices.map(row => row.voiceId), ['girl'])
  assert.deepEqual(searchLibrary([pack], {query:'大叔', limit:1}).more, {figures:0, voices:0})
})
