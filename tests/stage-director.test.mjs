import assert from 'node:assert/strict'
import test from 'node:test'
import { stageDirectorFixture } from './helpers/stage-director-fixture.mjs'
import { emptyStageState } from '../tavern-plugin/lib/domain/cast-stage-state.js'
import { STAGE_UPDATE_TOOL } from '../tavern-plugin/lib/domain/stage-director.js'

const chat = () => ({ id: 'story', sessionId: 'game', mode: 'story', timeline: { branchId: 'branch', revision: 3 },
  messages: [{ role: 'assistant', turn: 1, text: 'Opening.' }, { role: 'user', text: 'Continue.' }, { role: 'assistant', turn: 2, text: 'A silent figure waits.' }] })
const assets = () => ({ player: 'Reader', cast: [{ name: 'Nora', aliases: ['N'] }, { name: 'Lee' }, { name: 'Sam' }, { name: 'Jo' }, { name: 'Reader' }], background: [{ name: 'Room' }], music: [{ name: 'Theme' }] })
const delta = () => ({ figures: [{ speaker: 'Nora', emotion: '开心' }], background: 'Room', music: 'Theme' })
const setup = () => stageDirectorFixture(chat(), assets())
const append = h => h.persistence.update('story', current => { current.messages.push({ role: 'assistant', turn: 3, text: 'Silence.' }); current.timeline.revision++; return current })

test('the internal director accepts one atomic increment and keeps the story unchanged', async t => {
  const h = await setup(), request = await h.prepare(), before = await h.read(), writes = h.stats().writes
  const {system: instructions, turnContext: choices} = request
  t.diagnostic(JSON.stringify({ instructionBytes: Buffer.byteLength(instructions), stateAndChoicesBytes: Buffer.byteLength(choices), toolSchemaBytes: Buffer.byteLength(JSON.stringify(STAGE_UPDATE_TOOL)) }))
  assert.match(request.system, /stage_update/)
  assert.match(request.turnContext, /Theme/)
  assert.deepEqual(await request.call(delta()), { ok: true })
  assert.deepEqual(await h.read(), before)
  assert.equal(h.stats().writes, writes, 'the story journal is locked but not rewritten')
  assert.equal(h.stats().published, 1)
  assert.deepEqual(await h.director.state('game', 2), { figures: [{ speaker: 'Nora', emotion: 'joy' }], background: 'Room', music: 'Theme' })
  assert.equal((await request.call({ music: null })).ok, false, 'successful requests are single-use')
  assert.equal(await h.prepare(), null, 'a new director session cannot replace an accepted delta with omission')
})

test('a bad member rejects the entire batch and the same tool request can correct it', async () => {
  const h = await setup(), request = await h.prepare()
  assert.equal((await request.call({ ...delta(), music: 'Missing' })).ok, false)
  assert.equal(await h.data.snapshot('story'), null)
  assert.equal(h.stats().published, 0)
  assert.deepEqual(await request.call(delta()), { ok: true })
})

test('narration-only turns and fresh instances retain state; explicit clears remove it', async () => {
  const h = await setup()
  await (await h.prepare()).call(delta())
  await append(h)
  assert.deepEqual(await (await h.prepare()).call({}), { ok: true })
  const snapshot = await h.data.snapshot('story')
  assert.deepEqual(await h.make().state('game', 20), await h.director.state('game', 2))
  assert.deepEqual(await h.data.snapshot('story'), snapshot, 'projection is read-only')
  await h.persistence.update('story', current => { current.messages.push({ role: 'assistant', turn: 4, text: 'The room empties.' }); return current })
  assert.deepEqual(await (await h.prepare()).call({ figures: null, background: null, music: null }), { ok: true })
  assert.deepEqual(await h.director.state('game', 4), emptyStageState())
})

for (const change of ['text', 'branch', 'revision', 'next-turn', 'cancel', 'stopped']) test('stale or cancelled tool cannot publish: ' + change, async () => {
  const h = await setup(), request = await h.prepare()
  if (change === 'stopped') request.close()
  else if (change !== 'cancel') await h.persistence.update('story', current => {
    if (change === 'text') current.messages.at(-1).text = 'Replaced.'
    if (change === 'branch') current.timeline.branchId = 'other'
    if (change === 'revision') current.timeline.revision++
    if (change === 'next-turn') current.messages.push({ role: 'assistant', turn: 3, text: 'Later.' })
    return current
  })
  assert.equal((await request.call(delta(), change === 'cancel' ? AbortSignal.abort() : undefined)).ok, false)
  assert.equal(await h.data.snapshot('story'), null)
  assert.equal(h.stats().published, 0)
})

test('rollback, replaced history and another game do not read obsolete director records', async () => {
  const h = await setup()
  await (await h.prepare()).call(delta())
  assert.deepEqual(await h.director.state('other-game', 20), emptyStageState())
  await h.persistence.update('story', current => { current.messages.at(-1).text = 'Replacement.'; return current })
  assert.deepEqual(await h.director.state('game', 20), emptyStageState())
  await h.persistence.update('story', current => { current.messages.pop(); return current })
  assert.deepEqual(await h.director.state('game', 20), emptyStageState())
})

test('disabled stage has no task; canonical cast and explicit capacity are enforced', async () => {
  const h = await setup()
  h.enabled(false)
  assert.equal(await h.prepare(), null)
  h.enabled(true)
  const request = await h.prepare()
  for (const figures of [[{ speaker: 'N' }], [{ speaker: 'Reader' }], [{ speaker: 'Nora', emotion: 'unknown' }], ['Nora', 'Lee', 'Sam', 'Jo'].map(speaker => ({ speaker }))]) {
    assert.equal((await request.call({ figures })).ok, false)
    assert.equal(await h.data.snapshot('story'), null)
  }
  assert.deepEqual(await request.call(delta()), { ok: true })
})

// BGM (cast-presentation.md「背景音乐」): lamps decide what the director may choose; music plays until stopped.
const lamp = (name, mode, keywords = [], synonyms) => ({ name, recall: { mode, keywords, ...(synonyms ? { synonyms } : {}) } })
const turn = text => current => { const last = current.messages.at(-1).turn; current.messages.push({ role: 'user', text: 'Go on.' }, { role: 'assistant', turn: last + 1, text }); current.timeline.revision++; return current }

test('BGM lamps: blue is always offered, green only once the text names it; a missed trigger never stops the playing track', async () => {
  const music = [lamp('Theme', 'constant'), lamp('Storm', 'keyword', ['雷雨']), lamp('Waltz', 'keyword', ['舞会'], { '舞会': ['ball'] })]
  const h = await stageDirectorFixture({ ...chat(), messages: [...chat().messages.slice(0, 2), { role: 'assistant', turn: 2, text: '窗外雷雨大作。' }] }, { ...assets(), music })
  let request = await h.prepare()
  assert.deepEqual(JSON.parse(request.turnContext).music, ['Theme', 'Storm'])
  assert.equal((await request.call({ music: 'Waltz' })).ok, false, 'an unnamed green track is not a choice')
  assert.deepEqual(await request.call({ music: 'Storm' }), { ok: true })
  await h.persistence.update('story', turn('The ball begins; nobody mentions the weather.'))
  request = await h.prepare()
  const context = JSON.parse(request.turnContext)
  assert.deepEqual([context.music, context.state.music], [['Theme', 'Waltz'], 'Storm'], 'a synonym is a whole Latin word')
  assert.match(context.musicNote, /当前 BGM：Storm，省略即保持/)
  assert.deepEqual(await request.call({}), { ok: true })
  assert.equal((await h.director.state('game', 3)).music, 'Storm')
  await h.persistence.update('story', turn('A balloon drifts by.'))
  assert.deepEqual(JSON.parse((await h.prepare()).turnContext).music, ['Theme'], 'ball inside another word is no trigger')
})

test('BGM off or the playing track switched off: the director sees silence and the turn records the stop', async () => {
  const h = await setup()
  await (await h.prepare()).call(delta())
  await append(h)
  h.assets.music = []
  const request = await h.prepare(), context = JSON.parse(request.turnContext)
  assert.deepEqual([context.state.music, context.music, context.musicNote], [null, [], undefined], 'no list and nothing playing: nothing about music')
  assert.equal((await request.call({ music: 'Theme' })).ok, false)
  assert.deepEqual(await request.call({}), { ok: true })
  h.assets.music = assets().music
  assert.equal((await h.director.state('game', 3)).music, null, 'switching BGM on again waits for the director')
})

test('music guidance only while a track can be chosen or one plays; a playing track alone keeps only how to stop it', async t => {
  const h = await setup(), note = JSON.parse((await h.prepare()).turnContext).musicNote
  assert.match(note, /当前 BGM：无（静音）/)
  assert.match(note, /换场或情绪转折/)
  assert.match(note, /music:null/)
  t.diagnostic(JSON.stringify({ musicNoteBytes: Buffer.byteLength(JSON.stringify({ musicNote: note })) }))
  const green = await stageDirectorFixture(chat(), { ...assets(), music: [lamp('Storm', 'keyword', ['雷雨'])] })
  assert.equal(JSON.parse((await green.prepare()).turnContext).musicNote, undefined)
  await green.persistence.update('story', current => { current.messages.at(-1).text = '雷雨。'; return current })
  await (await green.prepare()).call({ music: 'Storm' })
  await green.persistence.update('story', turn('Quiet.'))
  const playing = JSON.parse((await green.prepare()).turnContext)
  assert.deepEqual(playing.music, [])
  assert.match(playing.musicNote, /^当前 BGM：Storm，省略即保持。玩家输入或正文让音乐停下/)
})

test('concurrent duplicate submissions cannot replace an already accepted transaction', async () => {
  const h = await setup(), request = await h.prepare(), duplicate = await h.prepare()
  const results = await Promise.all([request.call(delta()), duplicate.call({ figures: null })])
  assert.deepEqual(results.map(result => result.ok), [true, false])
  assert.equal(h.stats().published, 1)
})

// 物品 (cast-presentation.md「物品」): a lit item of the card's packs, shown once on its page; none offered, nothing said.
test('items: offered by their lamps, shown once on a page by name; with none the director hears nothing of them', async () => {
  const items = [lamp('Pocket watch', 'constant'), lamp('Letter', 'keyword', ['信封'])]
  const h = await stageDirectorFixture({ ...chat(), messages: [...chat().messages.slice(0, 2), { role: 'assistant', turn: 2, text: '她拿出一只怀表。\n桌上没有别的东西。' }] }, { ...assets(), items })
  const request = await h.prepare(), context = JSON.parse(request.turnContext)
  assert.deepEqual(context.items, ['Pocket watch'], 'a green item waits for its trigger')
  assert.match(request.system, /item\.play/)
  assert.ok(JSON.stringify(request.tool.parameters.properties.performances).includes('item.play'))
  for (const performances of [[{ at: 1, op: 'item.play', item: 'Letter' }], [{ at: 3, op: 'item.play', item: 'Pocket watch' }],
    [{ at: 1, op: 'item.play', item: 'Pocket watch', count: 2 }], [{ at: 1, op: 'item.play', item: 'Pocket watch' }, { at: 1, op: 'item.play', item: 'Pocket watch' }]]) {
    assert.equal((await request.call({ performances })).ok, false, JSON.stringify(performances))
  }
  assert.deepEqual(await request.call({ performances: [{ at: 1, op: 'item.play', item: 'Pocket watch' }] }), { ok: true })
  assert.deepEqual(await h.director.performances('game', 2, (await h.body()).key), [{ at: 1, op: 'item.play', item: 'Pocket watch' }])
  await h.persistence.update('story', turn('Quiet.'))
  h.assets.items = []
  const none = await h.prepare()
  assert.equal(JSON.parse(none.turnContext).items, undefined)
  assert.doesNotMatch(none.system, /item\.play|物品/)
  assert.doesNotMatch(JSON.stringify(none.tool), /item\.play/)
  assert.equal((await none.call({ performances: [{ at: 1, op: 'item.play', item: 'Pocket watch' }] })).ok, false)
})
