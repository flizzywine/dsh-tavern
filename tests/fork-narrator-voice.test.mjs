// 旁白配音: host display units decide; the stage voice handles speak them.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import bubbleLine from '../tavern-plugin/src/client/bubble-line.cjs'
import {createStageTextIndex, nativeNode, textHelpers} from './helpers/stage-session-harness.mjs'
import {voiceFixture, tick} from './fixtures/native-voice-player.mjs'
import {effectiveNarrator, validateCardStage} from '../tavern-plugin/lib/domain/card-stage-settings.js'
import {defaultAssetEngineSettings, patchAssetEngineSettings, validateAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {cardBubbleConfig} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import {createAssetPackSpeech, NARRATOR_VOICE} from '../tavern-plugin/lib/domain/asset-pack-speech.js'
import {stageEnabledEngineSettings} from './helpers/stage-enabled-settings.mjs'
import {createStageRuntimeHarness, runtimeSource, runtimeText, runtimePage, runtimeDirection} from './helpers/stage-runtime-harness.mjs'
import {roundBody, voiceBackfillLines, voiceBackfillKept} from '../tavern-plugin/lib/domain/round-body.js'
import {voiceBackfillTaskText} from '../tavern-plugin/packages/dsh-tavern-stage/lib/voice-backfill.js'

const {bubbleCharacter, characterVoiceLanguage, packSpeechInput} = bubbleLine
const stagePart = name => createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/' + name)
const chat = nodes => ({nodes:new Map(nodes.map(node => [node.id, node]))})
// The alias and the shown name differ from the figure's canonical name; moods are Chinese.
const TEXT = [
  '## 第一章',
  '雨下了一整夜。**街灯**亮着。',
  '@bubble:f_a1|小圆|开心|[早上好！]',
  '@bubble:f_b2|路人|平静|[让一让。]',
  '@bubble:f_a1|小圆|害怕|[*他在看我吗*]',
  '---'
].join('\n\n')
// The host projects an HTML block as its own part (reply-presentation.js); the stage never reads inside it.
const PARTS = [{kind:'markdown', text:TEXT}, {kind:'html', text:'<div class="status">\n\n状态栏\n\n</div>'}, {kind:'markdown', text:'广播里传来「列车即将进站」的声音。'}]
const config = (narrator, extra = {}) => ({voice:{enabled:true}, ...(narrator ? {narrator} : {}),
  characters:[{alias:'f_a1', name:'鹿目圆', aliases:['小圆'], voice:'voice/a', voiceKey:'key-a', voiceLanguage:'zh'},
    {alias:'f_b2', name:'路人甲', aliases:['路人'], voice:'', voiceKey:null}], ...extra})

function pages(parts = PARTS) {
  const index = createStageTextIndex(textHelpers())
  return index.reconcile({chat:chat([nativeNode(3, 'x')]), view:{mode:'story', replyProjections:[{version:2, turn:3, parts}]}, branchId:'b'}).get(3).text.pages
}
async function handles() {
  // The stage's speech module (speech.cjs), wired as gal-stage.js hands it the core's player, speech input and resolver.
  const f = voiceFixture()
  const speech = stagePart('speech.cjs').createStageSpeech({player:f.player, available:() => !!f.client.available(),
    speechInput:(segment, cfg) => packSpeechInput(segment, cfg, bubbleCharacter(cfg, segment), null), character:bubbleCharacter, language:characterVoiceLanguage,
    open:async (id, args) => { f.opened = [...(f.opened || []), args]; return f.descriptor }})
  return {f, handle:(page, cfg) => speech.handle('s', page.voice, cfg, page.anchor.paragraphId, true)}
}
test('segmentation: narration units read as narration, bubbles and thoughts keep the character voice, dividers and HTML are skipped', () => {
  const rows = pages()
  assert.deepEqual(rows.map(page => [page.kind, page.text]), [
    ['narration', '第一章'], ['narration', '雨下了一整夜。街灯亮着。'],
    ['line', '早上好！'], ['line', '让一让。'], ['line', '（他在看我吗）'],
    ['narration', '广播里传来「列车即将进站」的声音。']])
  const narration = rows.filter(page => page.kind === 'narration')
  assert.ok(narration.every(page => page.voice.narration === true && page.voice.text === page.text), 'Markdown is stripped before synthesis')
  assert.ok(rows.filter(page => page.kind === 'line').every(page => !page.voice.narration && page.voice.alias))
  assert.equal(rows[4].voice.thought, true, 'a thought keeps its own (character) voice')
})

test('a voiceless speaker is not read by the narrator, and no sentence is voiced twice', async t => {
  const {f, handle} = await handles(); t.after(() => f.player.dispose())
  const rows = pages(), cfg = config({voiceKey:'narrator-key'})
  const spoken = rows.map(page => handle(page, cfg)).filter(Boolean)
  assert.deepEqual(spoken.map(row => [row.narration === true, row.text]), [
    [true, '第一章'], [true, '雨下了一整夜。街灯亮着。'], [false, '早上好！'], [false, '他在看我吗'], [true, '广播里传来「列车即将进站」的声音。']])
  assert.equal(new Set(spoken.map(row => row.id)).size, spoken.length)
  assert.ok(!spoken.some(row => row.text.includes('让一让')), 'the voiceless bubble stays silent')
  for (const row of spoken) await row.prefetch()
  await tick()
  assert.deepEqual(f.opened.filter(args => args.narrator).length, 3, 'narration opens the narrator voice')
  const texts = f.synths.map(row => row.input.text)
  assert.equal(new Set(texts).size, texts.length, 'every sentence is synthesized once')
})

test('旁白配音 off: nothing extra is synthesized', async t => {
  const {f, handle} = await handles(); t.after(() => f.player.dispose())
  const spoken = pages().map(page => handle(page, config(null))).filter(Boolean)
  for (const row of spoken) await row.prefetch()
  await tick()
  assert.deepEqual(f.synths.map(row => row.input.text), ['早上好！', '他在看我吗'])
})

test('an old turn without bubbles is read whole by the narrator', async t => {
  const {f, handle} = await handles(); t.after(() => f.player.dispose())
  const rows = pages([{kind:'markdown', text:'第一段。\n\n第二段，*很长*的叙述。'}])
  assert.deepEqual(rows.map(page => handle(page, config({voiceKey:'k'}))?.text), ['第一段。', '第二段，很长的叙述。'])
})

test('settings: the card layer\'s switch wins over the global one (tts.reading.narrator); default off; the voice is no setting', () => {
  // the engine settings hold no narrator; a stale stored key is dropped on read.
  const engine = validateAssetEngineSettings({...defaultAssetEngineSettings(), narrator:{enabled:true, voice:null}})
  assert.equal(Object.hasOwn(engine, 'narrator'), false)
  assert.throws(() => patchAssetEngineSettings(engine, {narrator:{enabled:true}}))
  assert.deepEqual(effectiveNarrator({stage:{}}, undefined), {enabled:false})
  assert.deepEqual(effectiveNarrator({stage:{}}, {enabled:true}), {enabled:true})
  assert.deepEqual(effectiveNarrator({stage:{narrator:{enabled:false}}}, {enabled:true}), {enabled:false})
  assert.deepEqual(effectiveNarrator({stage:{narrator:{enabled:true}}}, {enabled:false}), {enabled:true})
  assert.deepEqual(validateCardStage({narrator:{enabled:true, voice:{browser:'Xiaoxiao'}}}).narrator, {enabled:true}, 'the retired card voice is dropped')
  assert.throws(() => validateCardStage({narrator:{speed:2}}))
})

// 旁白 speaks with the figure tts.reading().narrator.figure points at (any installed pack), in that figure's 配音语言.
const VOICES = '33333333-3333-4333-8333-333333333333'
const voicePack = {revision:'vp-1', manifest:{id:VOICES, voiceLibrary:{version:1, voices:{
  ja:{name:'旁白', language:'ja', defaultSource:'s', sources:{s:{kind:'preset', provider:'minimax', voiceName:'narrator-voice'}}},
  zh:{name:'旁白', language:'zh', defaultSource:'s', sources:{s:{kind:'preset', provider:'minimax', voiceName:'narrator-voice'}}}}}},
  figures:{ja:{id:'ja', name:'旁白', voice:{voice:'ja'}}, zh:{id:'zh', name:'旁白', voice:{voice:'zh'}}, mute:{id:'mute', name:'不配音', voice:{voice:'zh', source:null}}}}
const pointedAt = figureId => ({narrator:figureId ? {ref:{packId:VOICES, figureId}, pack:voicePack, figure:voicePack.figures[figureId]} : null})
test('config.narrator: present only while it speaks on this card; config.voice and the prompt inputs unchanged', () => {
  const pack = {manifest:{id:'pack-1', figures:['fig-1'], voiceLibrary:{voices:{v1:{language:'ja', defaultSource:'s', sources:{s:{provider:'fish-audio'}}}}}, assets:[]},
    figures:{'fig-1':{name:'旁白姐', enabled:true, voice:{voice:'v1'}, outfits:[], emotions:[]}}}
  const raw = stage => ({extensions:{dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:['pack-1']}, stage}}})
  const engine = validateAssetEngineSettings(stageEnabledEngineSettings())
  const project = (stage, global = null, pointed = {}, settings = engine) => cardBubbleConfig(raw(stage), settings, [pack], [], [], undefined, global, pointed)
  const off = project({})
  assert.equal(off.narrator, undefined)
  assert.deepEqual(project({narrator:{enabled:true}}).narrator, {voiceKey:'browser:', language:'zh'}, 'none chosen: the browser\'s default voice, in 中文')
  const card = project({narrator:{enabled:true}}, null, pointedAt('ja'))
  assert.match(card.narrator.voiceKey, /^[0-9a-f]+$/)
  assert.equal(card.narrator.language, 'ja', 'its figure\'s 配音语言 comes with it (配音补译)')
  assert.equal(card.narrator.wholeParagraph, true, 'another language: whole translated paragraphs')
  assert.equal(project({narrator:{enabled:true}}, null, pointedAt('zh')).narrator.wholeParagraph, undefined, '中文 reads page by page')
  assert.notEqual(card.narrator.voiceKey, project({narrator:{enabled:true}}, null, pointedAt('zh')).narrator.voiceKey, 'another figure, another voice')
  assert.deepEqual(card.voice, off.voice)
  // the global layer on, the card layer unset: narration speaks; 本卡关闭 silences it.
  assert.ok(project({}, {enabled:true}, pointedAt('ja')).narrator)
  assert.equal(project({narrator:{enabled:false}}, {enabled:true}, pointedAt('ja')).narrator, undefined)
  assert.equal(project({narrator:{enabled:true}}, null, pointedAt('mute')).narrator, undefined, '不配音')
  assert.equal(project({narrator:{enabled:true}}, null, pointedAt('gone')).narrator, undefined, 'a figure gone is silent')
  const voiceOff = patchAssetEngineSettings(engine, {stageToggles:{voice:false}})
  assert.equal(project({narrator:{enabled:true}}, null, pointedAt('ja'), voiceOff).narrator, undefined, '配音 off silences the narrator too')
})

test('host speech: the narrator key opens the figure it points at and never a cast name', async () => {
  let extension = {schemaVersion:1, assetBindings:{boundPackIds:[]}, stage:{narrator:{enabled:true}}}, figure = null
  const presentation = {get extension() { return extension }, subscribe:() => () => {},
    resolveName:async () => assert.fail('the narrator is not a name'), resolveFigure:async () => assert.fail('a pointed figure is read from the library')}
  const library = {getPackSnapshot:async ({packId}) => packId === VOICES ? voicePack : null}
  const engine = validateAssetEngineSettings(stageEnabledEngineSettings()), registered = []
  const tts = {apiVersion:1, subscribe:() => () => {}, reading:() => ({general:{figure:null}, narrator:{enabled:false, figure:figure && {packId:VOICES, figureId:figure}}, readAloud:{voice:null, auto:false}}),
    resolveVoiceService:async () => ({effective:{serviceId:'svc-1', serviceRevision:'1', capabilities:{}}, issues:[]}),
    registerVoiceSource:input => { registered.push(input); return {dispose() {}} }, grantConsumer:() => ({grant:{}, dispose() {}})}
  const speech = createAssetPackSpeech({presentation, getEngine:() => engine, getTts:() => tts, getLibrary:() => library, scope:'dsh-browser'})
  assert.deepEqual(await speech.open(NARRATOR_VOICE), {available:true, browser:{voice:''}, voiceId:'browser', language:'zh', scope:'dsh-browser', diagnostics:[]}, 'none chosen: the browser default')
  extension = {...extension, stage:{narrator:{enabled:false}}}
  assert.deepEqual(await speech.open(NARRATOR_VOICE), {available:false, diagnostics:['voice-unbound']})
  extension = {...extension, stage:{}}
  assert.deepEqual(await speech.open(NARRATOR_VOICE), {available:false, diagnostics:['voice-unbound']}, 'neither layer on: no narration synthesis')
  // the figure it points at, in that figure's 配音语言.
  extension = {...extension, stage:{narrator:{enabled:true}}}
  figure = 'ja'
  speech.refresh()
  const opened = await speech.open(NARRATOR_VOICE)
  assert.equal(opened.available, true)
  assert.equal(opened.language, 'ja')
  assert.deepEqual(registered.map(row => [row.bindings, row.voices[0].languages, row.sourceId.startsWith('figure:' + VOICES + ':ja:')]), [[{voice:'svc-1'}, ['ja'], true]])
  speech.dispose()
})
test('stage runtime: each narration page is one automatic voice event while the narrator speaks, none while it is off', t => {
  const run = narrator => {
    const h = createStageRuntimeHarness(), source = runtimeSource(); t.after(() => h.dispose())
    h.dispatch({type:'SESSION_INPUTS', settings:{config:narrator ? {narrator:{voiceKey:'k'}} : {}}})
    h.dispatch({type:'STAGE_OPEN', opened:true})
    const said = (offset, text) => runtimePage(1, offset, {kind:'narration', text, voice:{narration:true, paragraphId:'paragraph-1', lineIdentity:[1, 0, offset], text}})
    h.dispatch({type:'TURN_CHANGED', source, text:runtimeText(1, [said(0, '第一页。'), said(5, '第二页。')])})
    h.dispatch({type:'DIRECTOR_SNAPSHOT', source, envelope:runtimeDirection(1, 1, {phase:'done', complete:true})})
    for (const intent of h.oneShots.values()) h.readyOneShot(intent.token)
    h.dispatch({type:'PAGE', index:1})
    for (const intent of h.oneShots.values()) h.readyOneShot(intent.token)
    return h.effects('play-one-shot').filter(call => call.descriptor.kind === 'voice').map(call => call.descriptor.text)
  }
  assert.deepEqual(run(true), ['第一页。', '第二页。'], 'two pages of one paragraph each speak their own text')
  assert.deepEqual(run(false), [])
})
// 履历 (gal-backlog.js): a narration row replays its narrator voice; an earlier round's row is its whole paragraph, its pages
// played one after another under the row's one id.
async function backlog({voicePlayer}) {
  // the 履历 rows are the stage's backlog-rows.cjs (stageHistoryEntries) and its replay backlog-voice.cjs (narration).
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/backlog-rows.cjs', import.meta.url), 'utf8')
  const scope = {stageVoiceDescriptor:() => null}
  vm.runInNewContext(source.slice(source.indexOf('function stageHistoryEntries'), source.indexOf('// ---------- Performance rows')), scope)
  scope.galBacklogNarration = stagePart('backlog-voice.cjs').createStageBacklogVoice({player:voicePlayer}).narration
  return scope
}test('履历: an earlier round\'s narration row carries its pages\' narrator voices and plays them in order under one id', async t => {
  const {f, handle} = await handles(); t.after(() => f.player.dispose())
  const scope = await backlog({voicePlayer:f.player})
  const text = Array.from({length:3}, (_, n) => `第${n + 1}页的旁白。`)
  const cards = text.map((page, n) => ({kind:'narration', text:page, voice:{narration:true, paragraphId:'p1', lineIdentity:[3, 0, n * 10], text:page}, anchor:{paragraphId:'p1', para:1, offset:n * 10}}))
  const index = new Map([[3, {units:[{kind:'narration', para:1, paragraphId:'p1', text:text.join(''), cards}, {kind:'line', para:2, paragraphId:'p2', text:'台词', segment:{alias:'f_a1'}}]}]])
  const rows = scope.stageHistoryEntries(index, 4, [], 0, {}).filter(row => row.type === 'page')
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => row.descriptors?.map(descriptor => descriptor.text) ?? null))), [text, null], 'only a narration unit lists its page voices')
  const cfg = config({voiceKey:'narrator-key'})
  assert.equal(scope.galBacklogNarration(rows[0].descriptors.map(descriptor => handle({voice:descriptor, anchor:{paragraphId:'p1'}}, config(null))).filter(Boolean)), null, 'silent while the narrator is off')
  const row = scope.galBacklogNarration(rows[0].descriptors.map(descriptor => handle({voice:descriptor, anchor:{paragraphId:'p1'}}, cfg)))
  row.click()
  const played = []
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 5; i++) await tick()
    const current = f.player.get()
    assert.equal(current?.id, row.id, 'every page plays under the row\'s id (one button state)')
    played.push(f.synths.at(-1).input.text)
    current.audio.ended = true; current.audio.onended()
  }
  assert.deepEqual(played, text)
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(f.player.get(), null, 'the last page ends the row')
})

test('履历: stopping a narration row ends it; the next page is not played', async t => {
  const {f, handle} = await handles(); t.after(() => f.player.dispose())
  const scope = await backlog({voicePlayer:f.player})
  const cfg = config({voiceKey:'narrator-key'})
  const row = scope.galBacklogNarration(['甲页。', '乙页。'].map((text, n) => handle({voice:{narration:true, paragraphId:'p1', lineIdentity:[3, 0, n], text}, anchor:{paragraphId:'p1'}}, cfg)))
  row.click()
  for (let i = 0; i < 5; i++) await tick()
  f.player.stop()
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(f.player.get(), null)
  assert.deepEqual(f.synths.map(row => row.input.text), ['甲页。'])
})
// 旁白 in another language (owner 11-11, r2 A): each narration paragraph is translated whole by 配音补译 and read from its
// first page; page turns inside the paragraph do not cut it.
const JA = {voiceKey:'narrator-ja', language:'ja', wholeParagraph:true}
test('配音补译 asks for whole narration paragraphs while 旁白 reads another language, and the record lands on the paragraph', () => {
  const parts = [{kind:'markdown', text:'雨下了一整夜。\n街灯亮着。\n\n@bubble:f_a1|小圆|开心|[早上好！]|[おはよう！]'}]
  const body = roundBody(parts, {chatId:'c', turn:1})
  const lines = voiceBackfillLines(body.paragraphs, {voice:{enabled:true}, narrator:JA})
  assert.deepEqual(lines.map(({name, language, text}) => [name, language, text]), [['旁白', 'ja', body.paragraphs[0].text]])
  assert.match(voiceBackfillTaskText(lines), /^1\. 旁白〔日语〕：雨下了一整夜。 ?街灯亮着。$/, 'one numbered line')
  assert.deepEqual(voiceBackfillLines(body.paragraphs, {voice:{enabled:true}, narrator:{voiceKey:'zh', language:'zh'}}), [], '中文: nothing to translate')
  const key = lines[0].key
  assert.equal(roundBody(parts, {chatId:'c', turn:1, voiceBackfill:{status:'pending', keys:[key], lines:{}}}).paragraphs[0].voiceHold, true)
  const done = roundBody(parts, {chatId:'c', turn:1, voiceBackfill:{status:'done', keys:[key], lines:{[key]:'一晩中雨が降った。'}}})
  assert.equal(done.paragraphs[0].speech, '一晩中雨が降った。')
  assert.deepEqual(voiceBackfillKept(done.paragraphs), {[key]:'一晩中雨が降った。'})
  assert.equal(voiceBackfillLines(done.paragraphs, {voice:{enabled:true}, narrator:JA}).length, 0, 'translated once')
  assert.equal(roundBody(parts, {chatId:'c', turn:1, voiceBackfill:{status:'failed', keys:[key], lines:{}}}).paragraphs[0].voiceFallback, true)
})

test('stage voice: in another language only a paragraph\'s first page speaks, the whole voice text, held while it is translated', async t => {
  const {f, handle} = await handles(); t.after(() => f.player.dispose())
  const card = (offset, extra = {}) => ({voice:{narration:true, paragraphId:'p1', lineIdentity:[1, 0, offset], text:offset ? '第二页。' : '第一页。', paragraphText:'第一页。第二页。', ...extra}, anchor:{paragraphId:'p1'}})
  const first = handle(card(0, {speech:'一ページ目。二ページ目。', voiceBackfilled:true}), config(JA))
  assert.equal(first.text, '一ページ目。二ページ目。')
  assert.equal(JSON.parse(first.cacheKey)[0][3], 'ja', 'cached under its language')
  assert.equal(handle(card(5, {speech:'一ページ目。二ページ目。', voiceBackfilled:true}), config(JA)), null, 'later pages carry no voice of their own')
  assert.equal(handle(card(0, {voiceHold:true}), config(JA)), null, 'waits for its translation')
  assert.equal(handle(card(0, {voiceFallback:true}), config(JA)).text, '第一页。第二页。', 'a failed translation reads the paragraph as written')
  assert.equal(handle(card(5), config({voiceKey:'narrator-key'})).text, '第二页。', '中文 still reads page by page')
})

test('stage runtime: a whole translated paragraph goes on across its own later pages and stops at the next paragraph', t => {
  const run = narrator => {
    const h = createStageRuntimeHarness(), source = runtimeSource(); t.after(() => h.dispose())
    h.dispatch({type:'SESSION_INPUTS', settings:{config:{narrator}}})
    h.dispatch({type:'STAGE_OPEN', opened:true})
    const said = (para, offset, text) => runtimePage(para, offset, {kind:'narration', text, voice:{narration:true, paragraphId:'paragraph-' + para, lineIdentity:[1, para - 1, offset], text}})
    h.dispatch({type:'TURN_CHANGED', source, text:runtimeText(1, [said(1, 0, '第一页。'), said(1, 5, '第二页。'), said(2, 0, '下一段。')])})
    h.dispatch({type:'DIRECTOR_SNAPSHOT', source, envelope:runtimeDirection(1, 2, {phase:'done', complete:true})})
    for (const intent of h.oneShots.values()) h.readyOneShot(intent.token)
    const voice = h.effects('play-one-shot').find(call => call.descriptor.kind === 'voice')
    h.dispatch({type:'PAGE', index:1})
    const inside = h.last('cancel-playback')
    h.dispatch({type:'PAGE', index:2})
    return {voice, inside, next:h.last('cancel-playback')}
  }
  const ja = run(JA)
  assert.equal(ja.inside.keep, ja.voice.token.id, 'the page turn inside the paragraph keeps its voice')
  assert.equal(ja.next.keep, undefined, 'the next paragraph cuts it')
  assert.equal(run({voiceKey:'k'}).inside.keep, undefined, '中文 pages cut their own voice')
})
