// 选角助理: lore search, its tools (checked only there, errors back to the model), its decisions as
// one write before anything is drawn. Synthetic data only; ids differ from names.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runCastingAssistant, runLookLender, roundStory, AUTO_CAST_TASK, AUTO_CAST_LEND_TASK } from '../tavern-plugin/packages/dsh-tavern-stage/lib/auto-cast-assistant.js'
import {cardLorePieces as lorePieces} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import {castChanges, newSpeakers} from '../tavern-plugin/packages/dsh-tavern-stage/lib/auto-cast.js'
import {emptyAutoCastRecord, noteCasting, castDrawn, lendLooks} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/auto-cast-queue.js'

const PACK = '11111111-1111-4111-8111-111111111111', OWN = '22222222-2222-4222-8222-222222222222', LIB = '33333333-3333-4333-8333-333333333333'
const rows = [{actorKey:'o1', ref:{packId:OWN, figureId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}, name:'晓美焰·麻花辫', aliases:['眼镜焰'], enabled:true, figure:{voice:{voice:'v-homura'}}}]
const raw = {spec:'chara_card_v2', data:{name:'雾港', description:'故事发生在雾港市。\n\n护士是医院里的中年女性。', first_mes:'你醒了。',
  character_book:{entries:[{keys:['佐仓杏子', '杏子'], comment:'佐仓杏子', content:'红色长马尾，红瞳，常穿连帽衫和短裤，爱吃零食。'}]}}}
const speakers = [{name:'晓美焰', aliases:[]}, {name:'护士', aliases:[]}, {name:'雪乃', aliases:[]}]
const library = {figures:[{packId:LIB, packName:'春物', revision:'lr1', ref:{packId:LIB, kind:'figures', figureId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}, name:'雪之下雪乃', aliases:['雪乃'], copyable:true, voice:{voiceId:'v-yukino', name:'雪乃'}},
  {packId:LIB, packName:'旧包', revision:'lr1', ref:{packId:LIB, kind:'figures', figureId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}, name:'雪乃（旧）', aliases:[], copyable:false, voice:null}],
  voices:[{packId:OWN, packName:'雾港', revision:'or1', voiceId:'v-homura', name:'焰', language:'ja', sound:'homura'}, {packId:LIB, packName:'通用', revision:'lr1', voiceId:'v-mid', name:'中年女声', language:'zh', guidance:'适合中年女性', sound:'mid'}]}

test('the tools check their input and answer errors the model can fix', async () => {
  const seen = []
  const calls = [['search_lore', {query:'护士'}], ['same_as', {figure:'晓美焰', existing:'焰'}], ['same_as', {figure:'晓美焰', existing:'眼镜焰'}], ['same_as', {figure:'护士', existing:'眼镜焰'}],
    ['copy_figure', {figure:'雪乃', packId:LIB, figureId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}], ['search_library', {query:'雪乃'}],
    ['copy_figure', {figure:'雪乃', packId:LIB, figureId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}], ['copy_figure', {figure:'雪乃', packId:LIB, figureId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}],
    ['write_appearance', {figure:'路人', face:'x', body:'y'}], ['write_appearance', {figure:'护士', face:'圆脸短发', body:''}], ['write_appearance', {figure:'护士', about:'夜班护士，照顾主角', face:'圆脸短发', body:'微胖，白色护士服', importance:'recurring'}],
    ['assign_voice', {figure:'护士', packId:OWN, voiceId:'v-homura', reason:'她的声音要沉稳'}], ['assign_voice', {figure:'护士', packId:LIB, voiceId:'v-mid', reason:'说话平和的中年女声，适合耐心照料病人的护士'}], ['finish', {}]]
  const run = async input => {
    assert.equal(input.task, AUTO_CAST_TASK); assert.equal(input.ownPrefix, true); assert.match(input.system, /选角助理/)
    assert.deepEqual(JSON.parse(input.taskText).新人物, ['晓美焰', '护士', '雪乃'])
    // a speaker the card never names is described only where it comes on: the round's text goes with the task
    assert.equal(JSON.parse(input.taskText).本轮正文, '玩家：门里站着一个穿蓝色水手服的小女孩。\n\n正文：她赤着脚。\n护士：你醒了。')
    assert.ok(input.tools.some(tool => tool.name === 'copy_figure'))
    assert.equal(input.maxToolCalls, 29, 'the call budget grows with the speakers (the runner\'s default 8 runs out at two)')
    assert.equal(input.tools.find(tool => tool.name === 'finish').countsTowardLimit, false)
    for (const [name, args] of calls) seen.push([name, JSON.parse(await input.onToolCall({name, arguments:args}))])
  }
  const result = await runCastingAssistant({runAgent:run, selection:{}, sessionId:'s', turn:3, speakers, rows, voiceKeys:new Set(['homura']), pieces:lorePieces(raw), search:async () => library,
    story:roundStory({messages:[{role:'user', sourceText:'旧的一轮'}, {role:'assistant', text:'旧'}, {role:'user', sourceText:'门里站着一个穿蓝色水手服的小女孩。', text:'门里站着一个穿蓝色水手服的小女孩。'}, {role:'assistant', text:'…'}]},
      {paragraphs:[{kind:'markdown', text:'她赤着脚。'}, {kind:'line', name:'护士', text:'你醒了。'}]})})
  assert.deepEqual(seen.map(([name, reply]) => name + ':' + reply.ok), ['search_lore:true', 'same_as:false', 'same_as:true', 'same_as:false', 'copy_figure:false', 'search_library:true', 'copy_figure:false', 'copy_figure:true',
    'write_appearance:false', 'write_appearance:false', 'write_appearance:true', 'assign_voice:false', 'assign_voice:true', 'finish:true'])
  assert.match(seen[1][1].error, /晓美焰·麻花辫/, 'the error names the existing figures')
  assert.match(seen[3][1].error, /对不上.*新人物/, 'a figure whose names share nothing with the speaker is no other naming')
  assert.match(seen[4][1].error, /search_library/)
  assert.equal(seen[5][1].voices.find(row => row.voiceId === 'v-homura').inUse, true, 'a voice someone on the card speaks with is marked')
  assert.match(seen[8][1].error, /晓美焰、护士、雪乃/)
  assert.deepEqual(result.same, {晓美焰:rows[0].ref})
  assert.deepEqual(result.copy, {雪乃:{source:{packId:LIB, figureId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}, revision:'lr1'}})
  assert.deepEqual(result.appearance, {护士:{face:'圆脸短发', bodySFW:'微胖，白色护士服'}})
  assert.deepEqual(result.about, {护士:'夜班护士，照顾主角'})
  assert.deepEqual(result.voice, {护士:{from:{packId:LIB, voiceId:'v-mid'}, revision:'lr1', reason:'说话平和的中年女声，适合耐心照料病人的护士'}})
})

test('借用形象: one short call lends every new speaker a 通用人物 立绘 from the candidates, and nothing else', async () => {
  const TEACHER = '44444444-4444-4444-8444-444444444444', ROWDY = '55555555-5555-4555-8555-555555555555', GENERAL = '66666666-6666-4666-8666-666666666666'
  const figures = [{packId:GENERAL, figureId:TEACHER, name:'慵懒熟女教师', heightCm:171}, {packId:GENERAL, figureId:ROWDY, name:'重义不良少年', heightCm:181}]
  const replies = []
  const looks = await runLookLender({selection:{}, sessionId:'s', turn:2, speakers:[{name:'老板娘', aliases:[]}, {name:'牧童', aliases:[]}], figures, story:'正文：胖胖的老板娘在擦杯子。',
    runAgent:async input => {
      assert.equal(input.task, AUTO_CAST_LEND_TASK); assert.equal(input.ownPrefix, true); assert.match(input.system, /通用人物的立绘/)
      const task = JSON.parse(input.taskText)
      assert.deepEqual(task.新人物, ['老板娘', '牧童'])
      assert.deepEqual(task.可借的通用人物, [{figureId:TEACHER, name:'慵懒熟女教师', 身高:171}, {figureId:ROWDY, name:'重义不良少年', 身高:181}], 'by id, name and height')
      assert.equal(task.本轮正文, '正文：胖胖的老板娘在擦杯子。')
      assert.equal(input.maxToolCalls, 4)
      assert.deepEqual(input.tools.map(tool => tool.name), ['lend', 'finish'], 'nothing but the lending')
      const call = async (name, args = {}) => { const reply = JSON.parse(await input.onToolCall({name, arguments:args})); replies.push(reply); return reply }
      assert.match((await call('lend', {figure:'路人', figureId:TEACHER})).error, /老板娘、牧童/)
      assert.match((await call('lend', {figure:'老板娘', figureId:'x'})).error, /可借的通用人物/)
      assert.equal((await call('lend', {figure:'老板娘', figureId:TEACHER})).ok, true)
      assert.equal((await call('lend', {figure:'牧童', figureId:ROWDY})).ok, true)
      await call('finish')
    }})
  assert.deepEqual(looks, {老板娘:{packId:GENERAL, figureId:TEACHER}, 牧童:{packId:GENERAL, figureId:ROWDY}})
  // the lending is 自动素材's record, at once (the director of the round still streaming reads it): not a pack write
  assert.deepEqual(lendLooks(emptyAutoCastRecord(), looks).looks, looks)
})
test('the 选角助理 no longer lends looks: no borrow tool, nothing of a look in its write', async () => {
  const result = await runCastingAssistant({selection:{}, speakers:[{name:'老板娘', aliases:[]}], rows, pieces:[], search:async () => ({figures:[], voices:[]}),
    runAgent:async ({tools}) => assert.ok(!tools.some(tool => /look|borrow/.test(tool.name)))})
  assert.equal(result.look, undefined)
  assert.deepEqual(castChanges([{name:'老板娘', aliases:[]}], result).changes, [{op:'create', kind:'figures', value:{name:'老板娘', aliases:[]}}])
})
test('every library 通用声音 is listed with its name, 使用情景, language, pack and speakers, and one of them can be assigned', async () => {
  const general = {packId:'p-system', packName:'系统设置（请勿删除）', revision:'r1', voiceId:'v-male', name:'通用男性声音的声音', language:'zh', sound:'male', figures:['通用男性声音']}
  const seen = []
  const result = await runCastingAssistant({selection:{}, speakers:[{name:'林澈', aliases:[]}], rows, pieces:[], search:null, libraryVoices:async () => ({voices:[general], more:3}),
    runAgent:async input => {
      for (const [name, args] of [['list_library_voices', {}], ['assign_voice', {figure:'林澈', packId:'p-system', voiceId:'v-male', reason:'说话随和，适合自然的成年男声'}]]) seen.push(JSON.parse(await input.onToolCall({name, arguments:args})))
      seen.offered = input.tools.map(tool => tool.name)
    }})
  assert.deepEqual(seen.offered, ['search_lore', 'same_as', 'write_appearance', 'speaks_language', 'list_library_voices', 'assign_voice', 'finish'])
  assert.deepEqual(seen[0], {ok:true, voices:[{packId:'p-system', voiceId:'v-male', name:'通用男性声音的声音', language:'zh', pack:'系统设置（请勿删除）', figures:['通用男性声音'], inUse:false}], more:3})
  assert.deepEqual(result.voice['林澈'], {from:{packId:'p-system', voiceId:'v-male'}, revision:'r1', reason:'说话随和，适合自然的成年男声'})
})
// 自动素材 › 自动配音 off (主人 11-22): no voice is listed or can be assigned; the new person is created without one.
test('with 自动配音 off the assistant has no voice tools and the library search lists no voices', async () => {
  const voice = {packId:'p-system', packName:'系统设置', revision:'r1', voiceId:'v-male', name:'男声', language:'zh', sound:'male'}
  const seen = {}
  const result = await runCastingAssistant({selection:{}, speakers:[{name:'林澈', aliases:[]}], rows, pieces:[], voices:false,
    search:async () => ({figures:[], voices:[voice]}), libraryVoices:async () => ({voices:[voice], more:0}),
    runAgent:async input => {
      seen.offered = input.tools.map(tool => tool.name)
      seen.search = JSON.parse(await input.onToolCall({name:'search_library', arguments:{query:'男'}}))
      seen.assign = JSON.parse(await input.onToolCall({name:'assign_voice', arguments:{figure:'林澈', packId:'p-system', voiceId:'v-male', reason:'…'}}))
    }})
  assert.deepEqual(seen.offered, ['search_lore', 'search_library', 'same_as', 'copy_figure', 'write_appearance', 'finish'])
  assert.deepEqual(seen.search, {ok:true, figures:[]})
  assert.equal(seen.assign.ok, false)
  assert.deepEqual(result.voice, {})
})

// 先定语言，再按语言挑声音（主人 11-22）: a new speaker speaks 中文 unless the data says otherwise, and is cast only with
// voices of its language; another language's voice is never relabelled to fill in. Library voices of one language each
// (the library filters by castLanguage); fallback = that language's 默认通用声音 (the pack 通用声音 points at), sharable.
const SYSTEM = 'p-system', IDOLS = '77777777-7777-4777-8777-777777777777', RINA = '88888888-8888-4888-8888-888888888888'
const catalogue = [
  {packId:SYSTEM, packName:'系统', revision:'r1', voiceId:'v-ja-male', name:'系统既有男声（日语）', language:'ja', sound:'ja-male', fallback:true},
  {packId:SYSTEM, packName:'系统', revision:'r1', voiceId:'v-zh-female', name:'系统既有年轻女声（中文）', language:'zh', sound:'zh-female', fallback:true},
  {packId:'p-general', packName:'通用角色', revision:'g1', voiceId:'v-zh-male', name:'通用中年男声（沉稳）', language:'zh', guidance:'成熟男性', sound:'zh-male'},
  {packId:'p-general', packName:'通用角色', revision:'g1', voiceId:'v-ja-girl', name:'元气少女（日语）', language:'ja', guidance:'活泼少女', sound:'ja-girl'}]
const byLanguage = async language => ({voices:catalogue.filter(row => row.language === language), more:0})
const casting = (speakers, script, extra = {}) => runCastingAssistant({selection:{}, speakers, rows:[], pieces:[], search:null, libraryVoices:byLanguage, ...extra,
  runAgent:async ({onToolCall}) => script(async (name, args = {}) => JSON.parse(await onToolCall({name, arguments:args})))})

test('王城卫兵, a Chinese card\'s guard: 中文 without being told, so only 中文 voices are listed and a Japanese one is refused', async () => {
  const result = await casting([{name:'王城卫兵', aliases:[]}], async call => {
    assert.deepEqual((await call('list_library_voices')).voices.map(row => row.voiceId), ['v-zh-female', 'v-zh-male'], 'no language given: 中文')
    await call('list_library_voices', {language:'ja'})
    assert.match((await call('assign_voice', {figure:'王城卫兵', packId:SYSTEM, voiceId:'v-ja-male', reason:'低沉稳重'})).error, /说中文.*说日语.*只从中文的声音里挑/)
    assert.equal((await call('assign_voice', {figure:'王城卫兵', packId:'p-general', voiceId:'v-zh-male', reason:'低沉稳重，适合守门的卫兵'})).ok, true)
  })
  assert.deepEqual(result.language, {})
  assert.deepEqual(castChanges([{name:'王城卫兵', aliases:[]}], result).changes[0].voice, {from:{packId:'p-general', voiceId:'v-zh-male'}}, 'the voice speaks its own language: nothing relabelled')
})

test('a person of a Japanese IP pack the library records with a Japanese voice speaks 日语, and gets a Japanese voice', async () => {
  const idol = {packId:IDOLS, packName:'Love Live!', revision:'i1', ref:{packId:IDOLS, kind:'figures', figureId:RINA}, name:'星空凛', aliases:['凛'], copyable:false, voice:{voiceId:'v-rin', name:'凛', language:'ja'}}
  const plain = {...idol, ref:{...idol.ref, figureId:'99999999-9999-4999-8999-999999999999'}, name:'路人偶像', voice:null}
  const result = await casting([{name:'凛', aliases:[]}], async call => {
    await call('search_library', {query:'凛'})
    assert.match((await call('speaks_language', {figure:'凛', language:'ja'})).error, /给出依据/, 'no basis: 中文')
    assert.match((await call('speaks_language', {figure:'凛', language:'ja', packId:IDOLS, figureId:plain.ref.figureId})).error, /没有声音/)
    assert.equal((await call('speaks_language', {figure:'凛', language:'ja', packId:IDOLS, figureId:RINA})).ok, true)
    await call('list_library_voices'); await call('list_library_voices', {language:'ja'})
    assert.match((await call('assign_voice', {figure:'凛', packId:'p-general', voiceId:'v-zh-male', reason:'沉稳'})).error, /说日语.*说中文/)
    assert.equal((await call('assign_voice', {figure:'凛', packId:'p-general', voiceId:'v-ja-girl', reason:'活泼爱笑，适合元气的少女'})).ok, true)
  }, {search:async () => ({figures:[idol, plain], voices:[]})})
  assert.deepEqual(result.language, {凛:'ja'})
  assert.equal(result.voice['凛'].from.voiceId, 'v-ja-girl')
})

test('a new speaker with no language in the data is 中文; a quote of the card that he speaks Japanese makes him 日语; that language\'s 默认通用声音 is shared once the others are taken', async () => {
  const pieces = [{source:'世界书', text:'商人汉斯来自德国，说一口流利的日语。', keys:['汉斯']}]
  const result = await casting([{name:'新来的人', aliases:[]}, {name:'汉斯', aliases:[]}, {name:'哈罗德', aliases:[]}], async call => {
    assert.match((await call('speaks_language', {figure:'新来的人', language:'ja', quote:'他说日语'})).error, /给出依据/, 'a quote the card does not hold is no basis')
    assert.match((await call('speaks_language', {figure:'新来的人', language:'zh'})).error, /默认就是中文/)
    assert.equal((await call('speaks_language', {figure:'汉斯', language:'ja-JP', quote:'说一口流利的日语'})).ok, true)
    assert.equal((await call('speaks_language', {figure:'哈罗德', language:'ja', quote:'说一口流利的日语'})).ok, true)
    await call('list_library_voices', {language:'ja'})
    assert.equal((await call('assign_voice', {figure:'汉斯', packId:SYSTEM, voiceId:'v-ja-male', reason:'沉稳的成年男声，适合走南闯北的商人'})).ok, true)
    assert.equal((await call('assign_voice', {figure:'哈罗德', packId:SYSTEM, voiceId:'v-ja-male', reason:'沉稳的成年男声'})).ok, true, 'a fallback voice is shared')
    await call('list_library_voices')
    assert.equal((await call('assign_voice', {figure:'新来的人', packId:SYSTEM, voiceId:'v-zh-female', reason:'清亮自然'})).ok, true)
  }, {pieces})
  assert.deepEqual(result.language, {汉斯:'ja', 哈罗德:'ja'})
  assert.deepEqual(Object.fromEntries(Object.entries(result.voice).map(([name, row]) => [name, row.from.voiceId])), {汉斯:'v-ja-male', 哈罗德:'v-ja-male', 新来的人:'v-zh-female'})
})

test('a language with no 通用声音 leaves the speaker unvoiced and says so in its 人物介绍: no voice of another language fills in', async () => {
  const pieces = [{source:'人物档案', text:'金秀妍只会说韩语。', keys:['金秀妍']}]
  const result = await casting([{name:'金秀妍', aliases:[]}], async call => {
    assert.equal((await call('speaks_language', {figure:'金秀妍', language:'ko', quote:'只会说韩语'})).ok, true)
    const listed = await call('list_library_voices', {language:'ko'})
    assert.deepEqual(listed.voices, []); assert.match(listed.note, /没有韩语的通用声音/)
    await call('list_library_voices')
    assert.match((await call('assign_voice', {figure:'金秀妍', packId:SYSTEM, voiceId:'v-zh-female', reason:'清亮'})).error, /说韩语.*说中文/)
  }, {pieces})
  assert.deepEqual(result.unvoiced, {金秀妍:'ko'})
  const [change] = castChanges([{name:'金秀妍', aliases:[]}], result).changes
  assert.equal(change.voice, undefined)
  assert.equal(change.value.description, '配音选择：素材库里没有韩语的通用声音，暂未配声音。')
})

test('a new actor cannot take the same sound through another pack in the same casting run', async () => {
  const base = {packId:OWN, voiceId:'v-direct', revision:'r1', name:'干练女声', language:'zh', sound:'direct'}
  const copy = {...base, packId:LIB, voiceId:'copied'}
  const gentle = {...base, voiceId:'v-gentle', name:'温和女声', sound:'gentle'}
  const result = await runCastingAssistant({speakers:[{name:'记者'}, {name:'老师'}], rows:[], pieces:[], search:null,
    libraryVoices:async () => ({voices:[base,copy,gentle], more:0}), runAgent:async ({onToolCall}) => {
      const call = async (name, args = {}) => JSON.parse(await onToolCall({name, arguments:args}))
      const pick = (figure, {packId, voiceId}, reason) => call('assign_voice', {figure, packId, voiceId, reason})
      await call('list_library_voices')
      assert.match((await pick('记者', base, '')).error, /为什么符合人设/)
      assert.equal((await pick('记者', base, '说话利落，句子短')).ok, true)
      assert.deepEqual((await call('list_library_voices')).voices.map(row => row.inUse), [true,true,false])
      assert.match((await pick('老师', copy, '表达平稳')).error, /已有人在用/)
      assert.equal((await pick('老师', gentle, '性格温和，说话轻声细语')).ok, true)
    }})
  assert.equal(result.voice['老师'].from.voiceId, 'v-gentle')
})

test('the decisions become one write: same is not created, a copy takes the speaker\'s name, a new figure brings its voice', () => {
  const decided = {same:{晓美焰:rows[0].ref}, copy:{雪乃:{source:{packId:LIB, figureId:'e1'}, revision:'lr1'}}, appearance:{护士:{face:'圆脸', bodySFW:'护士服'}}, about:{护士:'夜班护士'}, voice:{护士:{from:{packId:LIB, voiceId:'v-mid'}, revision:'lr2', reason:'说话沉稳，适合这位耐心的中年护士'}}}
  const plan = castChanges(speakers, decided)
  assert.deepEqual(plan.changes, [{op:'create', kind:'figures', value:{name:'护士', aliases:[], description:'夜班护士\n\n配音选择：说话沉稳，适合这位耐心的中年护士'}, looks:{face:'圆脸', bodySFW:'护士服'}, voice:{from:{packId:LIB, voiceId:'v-mid'}}},
    {op:'copy', kind:'figures', source:{packId:LIB, figureId:'e1'}, patch:{name:'雪乃', aliases:[]}}])
  assert.deepEqual(plan.sources, [{packId:LIB, revision:'lr2'}, {packId:LIB, revision:'lr1'}])
  assert.deepEqual(plan.entries, [{name:'护士', copied:false, appearance:{face:'圆脸', bodySFW:'护士服'}}, {name:'雪乃', copied:true}])
  assert.deepEqual(castChanges(speakers, null).changes.map(change => change.value.name), ['晓美焰', '护士', '雪乃'], 'no decision: every speaker is created as 自动建人物 would')
  const record = noteCasting(emptyAutoCastRecord(), [{...plan.entries[0], ref:{packId:PACK, figureId:'n1'}}, {...plan.entries[1], ref:{packId:PACK, figureId:'y1'}}], decided.same)
  assert.equal(castDrawn(record, {ref:{packId:PACK, figureId:'y1'}}), false, 'a copy is not drawn')
  assert.deepEqual(record.appearance, {[PACK + '/n1']:{face:'圆脸', bodySFW:'护士服'}})
  const body = {paragraphs:[{paragraphId:'p0', kind:'line', segment:{name:'晓美焰', text:'……'}}, {paragraphId:'p1', kind:'line', segment:{name:'护士', text:'……'}}]}
  assert.deepEqual(newSpeakers(body, {rows}, record, null).map(row => row.name), ['护士'], 'a name found to be an existing figure is not asked about again')
})
