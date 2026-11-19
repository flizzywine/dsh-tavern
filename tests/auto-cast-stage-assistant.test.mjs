// 选角助理: lore search, its tools (checked only there, errors back to the model), its decisions as
// one write before anything is drawn. Synthetic data only; ids differ from names.
import test from 'node:test'
import assert from 'node:assert/strict'
import {searchLore, runCastingAssistant, AUTO_CAST_TASK} from '../tavern-plugin/packages/dsh-tavern-stage/lib/auto-cast-assistant.js'
import {cardLorePieces as lorePieces} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import {castChanges, newSpeakers, createAutoCast} from '../tavern-plugin/packages/dsh-tavern-stage/lib/auto-cast.js'
import {emptyAutoCastRecord, noteCasting, castDrawn} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/auto-cast-queue.js'

const PACK = '11111111-1111-4111-8111-111111111111', OWN = '22222222-2222-4222-8222-222222222222', LIB = '33333333-3333-4333-8333-333333333333'
const rows = [{actorKey:'o1', ref:{packId:OWN, figureId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}, name:'晓美焰·麻花辫', aliases:['眼镜焰'], enabled:true, figure:{voice:{voice:'v-homura'}}}]
const raw = {spec:'chara_card_v2', data:{name:'雾港', description:'故事发生在雾港市。\n\n护士是医院里的中年女性。', first_mes:'你醒了。',
  character_book:{entries:[{keys:['佐仓杏子', '杏子'], comment:'佐仓杏子', content:'红色长马尾，红瞳，常穿连帽衫和短裤，爱吃零食。'}]}}}
const speakers = [{name:'晓美焰', aliases:[]}, {name:'护士', aliases:[]}, {name:'雪乃', aliases:[]}]
const library = {figures:[{packId:LIB, packName:'春物', revision:'lr1', ref:{packId:LIB, kind:'figures', figureId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}, name:'雪之下雪乃', aliases:['雪乃'], copyable:true, voice:{voiceId:'v-yukino', name:'雪乃'}},
  {packId:LIB, packName:'旧包', revision:'lr1', ref:{packId:LIB, kind:'figures', figureId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}, name:'雪乃（旧）', aliases:[], copyable:false, voice:null}],
  voices:[{packId:OWN, packName:'雾港', revision:'or1', voiceId:'v-homura', name:'焰', language:'ja', sound:'homura'}, {packId:LIB, packName:'通用', revision:'lr1', voiceId:'v-mid', name:'中年女声', language:'zh', guidance:'适合中年女性', sound:'mid'}]}

test('lore search covers the card fields, each world book entry by its keys, and the game\'s 人物档案', () => {
  const pieces = lorePieces(raw, {characterDesignDocument:{characters:[{name:'老板', appearance:'光头'}]}})
  assert.deepEqual(searchLore(pieces, '杏子').map(row => row.source), ['世界书：佐仓杏子'])
  assert.deepEqual(searchLore(pieces, '护士').map(row => row.source), ['卡描述'])
  assert.deepEqual(searchLore(pieces, '老板').map(row => row.source), ['人物档案：老板'])
  assert.deepEqual(searchLore(pieces, ''), [])
})

test('the tools check their input and answer errors the model can fix', async () => {
  const seen = []
  const calls = [['search_lore', {query:'护士'}], ['same_as', {figure:'晓美焰', existing:'焰'}], ['same_as', {figure:'晓美焰', existing:'眼镜焰'}], ['same_as', {figure:'护士', existing:'眼镜焰'}],
    ['copy_figure', {figure:'雪乃', packId:LIB, figureId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}], ['search_library', {query:'雪乃'}],
    ['copy_figure', {figure:'雪乃', packId:LIB, figureId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}], ['copy_figure', {figure:'雪乃', packId:LIB, figureId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}],
    ['write_appearance', {figure:'路人', face:'x', body:'y'}], ['write_appearance', {figure:'护士', face:'圆脸短发', body:''}], ['write_appearance', {figure:'护士', about:'夜班护士，照顾主角', face:'圆脸短发', body:'微胖，白色护士服'}],
    ['assign_voice', {figure:'护士', packId:OWN, voiceId:'v-homura', reason:'她的声音要沉稳'}], ['assign_voice', {figure:'护士', packId:LIB, voiceId:'v-mid', reason:'说话平和的中年女声，适合耐心照料病人的护士'}], ['finish', {}]]
  const run = async input => {
    assert.equal(input.task, AUTO_CAST_TASK); assert.equal(input.ownPrefix, true); assert.match(input.system, /选角助理/)
    assert.deepEqual(JSON.parse(input.taskText).新人物, ['晓美焰', '护士', '雪乃'])
    assert.ok(input.tools.some(tool => tool.name === 'copy_figure'))
    assert.equal(input.maxToolCalls, 29, 'the call budget grows with the speakers (the runner\'s default 8 runs out at two)')
    assert.equal(input.tools.find(tool => tool.name === 'finish').countsTowardLimit, false)
    for (const [name, args] of calls) seen.push([name, JSON.parse(await input.onToolCall({name, arguments:args}))])
  }
  const result = await runCastingAssistant({runAgent:run, selection:{}, sessionId:'s', turn:3, speakers, rows, voiceKeys:new Set(['homura']), pieces:lorePieces(raw), search:async () => library})
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

test('without the library, its tools are not offered; a 配音后端 voice is never offered', async () => {
  let offered
  const run = async input => { offered = input.tools.map(tool => tool.name) }
  await runCastingAssistant({runAgent:run, selection:{}, speakers, rows, pieces:[], search:null})
  assert.deepEqual(offered, ['search_lore', 'same_as', 'write_appearance', 'finish'])
  await runCastingAssistant({runAgent:run, selection:{}, speakers, rows, pieces:[], search:null, libraryVoices:async () => ({voices:[], more:0})})
  assert.deepEqual(offered, ['search_lore', 'same_as', 'write_appearance', 'list_library_voices', 'assign_voice', 'finish'])
})

test('every library 通用声音 is listed with its name, 使用情景, language, pack and speakers, and one of them can be assigned', async () => {
  const general = {packId:'p-system', packName:'系统设置（请勿删除）', revision:'r1', voiceId:'v-male', name:'通用男性声音的声音', language:'zh', sound:'male', figures:['通用男性声音']}
  const seen = []
  const result = await runCastingAssistant({selection:{}, speakers:[{name:'林澈', aliases:[]}], rows, pieces:[], search:null, libraryVoices:async () => ({voices:[general], more:3}),
    runAgent:async input => {
      for (const [name, args] of [['list_library_voices', {}], ['assign_voice', {figure:'林澈', packId:'p-system', voiceId:'v-male', reason:'说话随和，适合自然的成年男声'}]]) seen.push(JSON.parse(await input.onToolCall({name, arguments:args})))
      seen.offered = input.tools.map(tool => tool.name)
    }})
  assert.deepEqual(seen.offered, ['search_lore', 'same_as', 'write_appearance', 'list_library_voices', 'assign_voice', 'finish'])
  assert.deepEqual(seen[0], {ok:true, voices:[{packId:'p-system', voiceId:'v-male', name:'通用男性声音的声音', language:'zh', pack:'系统设置（请勿删除）', figures:['通用男性声音'], inUse:false}], more:3})
  assert.deepEqual(result.voice['林澈'], {from:{packId:'p-system', voiceId:'v-male'}, revision:'r1', reason:'说话随和，适合自然的成年男声'})
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

test('a round with new speakers: the assistant decides, one write creates them, then the round counts', async () => {
  const writes = [], figures = []
  const lib = {writable:() => true,
    readCast:async () => ({cardId:'card-1', packId:figures.length ? PACK : null, revision:'r', raw, rows:[...rows, ...figures.map(f => ({actorKey:f.ref.figureId, ref:f.ref, name:f.name, aliases:[], enabled:true}))], figures:structuredClone(figures)}),
    write:async input => { writes.push(input); const refs = input.changes.map((change, i) => ({packId:PACK, figureId:'n' + i}))
      input.changes.forEach((change, i) => figures.push({ref:refs[i], name:change.value?.name || change.patch.name, aliases:[], emotions:[{id:'joy', label:'喜悦'}], settei:false, sprites:[]})); return {refs} }}
  const files = new Map(), store = {readJson:async k => files.get(k) ?? null, writeJson:async (k, v) => files.set(k, v), updateJson:async (k, fn) => files.set(k, fn(files.get(k) ?? null))}
  let asked
  const cast = createAutoCast({store, settings:async () => ({enabled:true, level:'late'}), library:lib, images:{status:async () => ({ready:false})}, idle:async () => {},
    cast:async input => { asked = input.speakers.map(row => row.name); return {same:{晓美焰:rows[0].ref}, copy:{}, appearance:{护士:{face:'圆脸', bodySFW:'护士服'}}, voice:{}} }})
  const body = {paragraphs:[{paragraphId:'p0', kind:'line', segment:{name:'晓美焰', text:'……'}}, {paragraphId:'p1', kind:'line', segment:{name:'护士', mood:'喜悦', text:'……'}}]}
  const chat = {id:'c1', timeline:{branchId:'b', revision:1}, messages:[{role:'assistant', turn:4, id:'m4'}]}
  await cast.round('cards/c.json', body, chat)
  assert.deepEqual(asked, ['晓美焰', '护士'])
  assert.deepEqual(writes.map(w => w.changes.map(c => c.op + ':' + (c.value?.name))), [['create:护士']])
  assert.equal(writes[0].source.turn, 4)
  const record = [...files].find(([key]) => key.endsWith('.json') && !key.endsWith('index.json'))[1]
  assert.deepEqual(record.misses, {[PACK + '/n0']:{joy:1}}, 'the new figure\'s first line already counts')
  assert.deepEqual(Object.keys(record.same), ['晓美焰'])
  await cast.round('cards/c.json', body, chat)
  assert.equal(writes.length, 1, 'nobody new the second time')
  const counted = () => [...files].find(([key]) => key.endsWith('.json') && !key.endsWith('index.json'))[1].misses[PACK + '/n0'].joy
  assert.equal(counted(), 1, 'the same round seen again is not counted twice')
  await cast.round('cards/c.json', body, {...chat, messages:[{role:'assistant', turn:5, id:'m5'}]})
  assert.equal(counted(), 2, 'the next round counts')
})

test('an assistant that fails leaves its speakers to be created new, and the record keeps why', async () => {
  const writes = [], figures = []
  const lib = {writable:() => true,
    readCast:async () => ({cardId:'card-1', packId:figures.length ? PACK : null, revision:'r', raw, rows:figures.map(f => ({actorKey:f.ref.figureId, ref:f.ref, name:f.name, aliases:[], enabled:true})), figures:structuredClone(figures)}),
    write:async input => { writes.push(input); const refs = input.changes.map((change, i) => ({packId:PACK, figureId:'n' + i}))
      input.changes.forEach((change, i) => figures.push({ref:refs[i], name:change.value.name, aliases:[], emotions:[{id:'joy', label:'喜悦'}], settei:false, sprites:[]})); return {refs} }}
  const files = new Map(), store = {readJson:async k => files.get(k) ?? null, writeJson:async (k, v) => files.set(k, v), updateJson:async (k, fn) => files.set(k, fn(files.get(k) ?? null))}
  const errors = []
  const cast = createAutoCast({store, settings:async () => ({enabled:true, level:'late'}), library:lib, images:{status:async () => ({ready:false})}, now:() => 7,
    cast:async () => { throw new ReferenceError('getTts is not defined') }, onError:error => errors.push(error.message)})
  const chat = {id:'c1', timeline:{branchId:'b', revision:1}, messages:[{role:'assistant', turn:2, id:'m2'}]}
  await cast.round('cards/c.json', {paragraphs:[{paragraphId:'p0', kind:'line', segment:{name:'雪之下雪乃', mood:'喜悦', text:'请进。'}}]}, chat)
  assert.deepEqual(writes.map(w => w.changes.map(c => c.op + ':' + c.value.name)), [['create:雪之下雪乃']])
  const record = [...files].find(([key]) => key.endsWith('.json') && !key.endsWith('index.json'))[1]
  assert.deepEqual(record.castFailures, [{at:7, error:'getTts is not defined'}])
  assert.deepEqual(errors, ['getTts is not defined'])
})

test('the opening is cast and counted from 积极 up; 晚一轮 waits for the story', async () => {
  for (const [level, expected] of [['late', 0], ['eager', 1], ['all', 1]]) {
    const writes = [], figures = []
    const lib = {writable:() => true,
      readCast:async () => ({cardId:'card-1', packId:figures.length ? PACK : null, revision:'r', raw, rows:figures.map(f => ({actorKey:f.ref.figureId, ref:f.ref, name:f.name, aliases:[], enabled:true})), figures:structuredClone(figures)}),
      write:async input => { writes.push(input); const refs = input.changes.map((change, i) => ({packId:PACK, figureId:'n' + i}))
        input.changes.forEach((change, i) => figures.push({ref:refs[i], name:change.value.name, aliases:[], emotions:[{id:'joy', label:'喜悦'}], settei:false, sprites:[]})); return {refs} }}
    const files = new Map(), store = {readJson:async k => files.get(k) ?? null, writeJson:async (k, v) => files.set(k, v), updateJson:async (k, fn) => files.set(k, fn(files.get(k) ?? null))}
    const cast = createAutoCast({store, settings:async () => ({enabled:true, level}), library:lib, images:{status:async () => ({ready:false})}, idle:async () => {}})
    const greeting = {id:'c1', timeline:{branchId:'b', revision:0}, messages:[{role:'assistant', greeting:true, id:'g'}]}
    await cast.round('cards/c.json', {paragraphs:[{paragraphId:'p0', kind:'line', segment:{name:'护士', mood:'喜悦', text:'你醒了。'}}]}, greeting, {opening:true})
    assert.equal(writes.length, expected, level)
    if (expected) assert.equal(writes[0].source.turn, 1, 'the opening is turn 1')
  }
})
