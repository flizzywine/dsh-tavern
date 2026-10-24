import assert from 'node:assert/strict'
import test from 'node:test'
import { stagePages, acceptStagePerformances } from '../tavern-plugin/lib/domain/stage-performance.js'
import { STAGE_UPDATE_TOOL, stageUpdateTool } from '../tavern-plugin/lib/domain/stage-director.js'
import { createStagePerformancePlayback } from '../tavern-plugin/lib/domain/stage-performance-playback.js'
import { stageDirectorFixture, runDirectorFixture } from './helpers/stage-director-fixture.mjs'

const assets = { player: 'Reader', cast: [{ name: 'Nora', aliases: ['N'] }, { name: 'Lee' }], background: [{ name: 'Hall' }], music: [{ name: 'Theme' }] }
const chat = () => ({ id: 'story', sessionId: 'game', mode: 'story', timeline: { branchId: 'branch', revision: 2 }, messages: [
  { role: 'assistant', turn: 1, text: 'Opening.' }, { role: 'assistant', turn: 2, text: '"Ready."\n\nA footstep.\nSilence.' }
] })
const events = () => [{ at: 1, op: 'actor.act.play', actor: 'Nora', motion: 'nod' }, { at: 2, op: 'screen.play', effect: 'shake-1' }, { at: 3, op: 'actor.act.play', actor: 'Nora', motion: 'jump' }]
const submission = () => ({ figures: [{ speaker: 'Nora' }], background: 'Hall', music: 'Theme', performances: events() })

test('host page addresses do not depend on annotations and retain repeated quotes in order', () => {
  const text = ' "Hi."\r\n\nSilence.\n"Hi."'
  const pages = stagePages(text, [{ quote: 'Hi.', speaker: 'Nora', emotion: 'joy' }, { quote: 'Hi.', speaker: 'Lee', emotion: 'sadness' }])
  assert.deepEqual(pages.map(({ at, text }) => ({ at, text })), stagePages(text).map(({ at, text }) => ({ at, text })))
  assert.deepEqual(pages.map(page => page.speaker), ['Nora', undefined, 'Lee'])
  assert.equal(stagePages('```\n"Hi."\n```', [{ quote: 'Hi.', speaker: 'Nora' }])[1].kind, 'narration')
})

test('舞台模式 › 可用演出 takes a switched-off command out of the tool, the prompt and the lists, and 每轮上限 caps screen effects', async () => {
  assert.deepEqual(stageUpdateTool(), STAGE_UPDATE_TOOL, 'every command is on by default')
  const commands = { dimensions: { scene: false, acts: false, cast: true, screenEffects: true }, actionCaps: { beat: 1 } }
  const h = await stageDirectorFixture(chat(), assets, { commands: async () => commands })
  const request = await h.prepare(), properties = request.tool.parameters.properties
  assert.deepEqual(Object.keys(properties), ['sequence', 'through', 'done', 'figures', 'music', 'performances'])
  assert.equal(properties.performances.items.properties.op.const, 'screen.play')
  assert.doesNotMatch(request.system + request.tool.description, /背景|actor\.act\.play/)
  assert.match(request.system, /screen\.play 用 shake-1/)
  assert.equal(Object.hasOwn(JSON.parse(request.turnContext), 'background'), false)
  assert.match((await request.call({ background: 'Hall' })).error, /只提交工具列出/)
  assert.match((await request.call({ figures: [{ speaker: 'Nora' }], performances: [events()[0]] })).error, /actor\.act\.play 已在可用演出里关闭/)
  assert.match((await request.call({ performances: [events()[1], { at: 3, op: 'screen.play', effect: 'shake-1' }] })).error, /画面效果每轮至多 1 次/)
  assert.deepEqual(await request.call({ figures: [{ speaker: 'Nora' }], performances: [events()[1]] }), { ok: true })
  // With neither performance on, the director has no performances at all; earlier windows of the turn count against the cap.
  const quiet = stageUpdateTool({ scene: true, cast: true, acts: false, screenEffects: false })
  assert.equal(Object.hasOwn(quiet.parameters.properties, 'performances'), false)
  const pages = stagePages('One.\nTwo.')
  assert.throws(() => acceptStagePerformances([{ at: 2, op: 'screen.play', effect: 'shake-1' }], pages, { figures: [] }, { beat: 1, earlier: [{ at: 1, op: 'screen.play', effect: 'shake-1' }] }), /至多 1 次/)
  assert.equal(acceptStagePerformances([{ at: 2, op: 'screen.play', effect: 'shake-1' }], pages, { figures: [] }, { beat: 2, earlier: [{ at: 1, op: 'screen.play', effect: 'shake-1' }] }).length, 1)
  // 物品 is not a screen effect: an item never counts against 每轮上限, and stays when both effects are off.
  const shown = [{ at: 1, op: 'item.play', item: 'Key' }, { at: 2, op: 'screen.play', effect: 'shake-1' }]
  assert.equal(acceptStagePerformances(shown, pages, { figures: [] }, { beat: 1, items: ['Key'] }).length, 2)
  assert.equal(stageUpdateTool({ scene: true, cast: true, acts: false, screenEffects: false, items: true }).parameters.properties.performances.items.properties.op.const, 'item.play')
})

test('the real director repairs an event in-session, then atomically saves events separately from persistent state', async () => {
  const h = await stageDirectorFixture(chat(), assets), before = await h.read()
  const run = await runDirectorFixture(h, [{ ...submission(), performances: [{ ...events()[0], actor: 'N' }] }, submission()])
  assert.deepEqual(run.receipts.map(receipt => receipt.ok), [false, true])
  assert.deepEqual(run.sessions, ['director-fixture'])
  assert.match(run.prompts[0].text, /\[1\] "Ready\."\n\[2\] A footstep\.\n\[3\] Silence\./)
  assert.deepEqual(await h.read(), before)
  const body = await h.body()
  assert.deepEqual(await h.director.performances('game', 2, body.key), events())
  const state = await h.director.state('game', 2)
  assert.deepEqual(state, { figures: [{ speaker: 'Nora', emotion: 'neutral' }], background: 'Hall', music: 'Theme' })
  await h.persistence.update('story', current => { current.messages.push({ role: 'assistant', turn: 3, text: 'Later.' }); return current })
  await (await h.prepare()).call({})
  assert.deepEqual(await h.make().state('game', 3), state)
  assert.deepEqual(await h.director.performances('game', 3, (await h.body()).key), [])
  assert.deepEqual(await h.director.performances('other', 2, body.key), [])
  assert.deepEqual(await h.director.performances('game', 2, 'replaced'), [])
})

test('tool validation rejects whole batches; no partial figures, music or one-shots escape', async () => {
  const h = await stageDirectorFixture(chat(), assets), request = await h.prepare()
  const bad = [null, {}, [null], [{ ...events()[0], at: 0 }], [{ ...events()[0], at: 4 }], [{ ...events()[0], at: 1.5 }],
    [{ ...events()[0], actor: 'Lee' }], [{ ...events()[0], motion: 'dance' }], [{ ...events()[1], effect: 'unknown' }],
    [{ ...events()[1], url: 'https://example.test/' }], [events()[0], events()[0]], Array(13).fill(events()[1])]
  for (const performances of bad) {
    const result = await request.call({ ...submission(), performances })
    assert.equal(result.ok, false, JSON.stringify(performances))
    assert.equal(result.retryable, true)
    assert.equal(await h.data.snapshot('story'), null)
    assert.equal(h.stats().published, 0)
  }
  assert.deepEqual(await request.call({ ...submission(), performances: [events()[0], { ...events()[0], at: 2 }] }), { ok: true }, 'same action on different pages is intentional')
})

test('cancelled performance transactions cannot write either channel', async () => {
  const h = await stageDirectorFixture(chat(), assets), request = await h.prepare()
  assert.equal((await request.call(submission(), AbortSignal.abort())).ok, false)
  assert.equal(await h.data.snapshot('story'), null)
})

function playback() {
  const timers = new Map(), played = [], cancelled = [], callbacks = []
  let next = 0
  const owner = createStagePerformancePlayback({
    schedule(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); callbacks.push(fn); return id },
    cancel(id) { timers.delete(id) },
    play(event, id) { played.push({ event, id }); return { cancel() { cancelled.push(id) }, finished: new Promise(() => {}) } }
  })
  return { owner, played, cancelled, timers, callbacks, flush() { const batch = [...timers.values()]; timers.clear(); for (const { fn } of batch) fn() },
    show(id, at, mode = 'page', input = events()) { owner.update({ id, at, mode, events: input }) } }
}

test('page back plays once per visit, not per render; rapid navigation only plays the settled page', () => {
  const h = playback()
  h.show('visit1', 1)
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [1000])
  h.show('visit2', 2)
  h.callbacks[0]() // A cancelled callback cannot play on a different page.
  h.flush()
  assert.equal(h.played.length, 1)
  assert.equal(h.played[0].event.at, 2)
  h.show('visit2', 2); h.flush()
  assert.equal(h.played.length, 1)
  h.show('back', 1); h.flush()
  assert.equal(h.played.length, 2)
  h.show('back', 1); h.flush()
  assert.equal(h.played.length, 2)
  assert.ok(h.cancelled.length > 0, 'leaving a page cancels its transient animation')
  h.owner.dispose()
})

test('refresh, skip, closing and disposal suppress queued and late events without modifying state', () => {
  for (const mode of ['refresh', 'skip']) {
    const h = playback()
    h.show('visit', 1, mode)
    h.show('visit', 1, 'live') // Notifications/reopening cannot convert a consumed visit into playback.
    h.flush()
    assert.equal(h.played.length, 0)
    h.show('explicit-back', 1); h.flush()
    assert.equal(h.played.length, 1)
    h.owner.dispose()
  }
  const h = playback()
  h.show('old-source', 1)
  h.owner.dispose()
  h.callbacks[0]()
  assert.equal(h.played.length, 0)
})

test('a new body can play its current page when direction arrives, but not earlier pages', () => {
  const h = playback()
  h.show('new-body', 1, 'live', [])
  h.show('new-body', 1, 'live'); h.flush()
  assert.equal(h.played.length, 1)
  h.show('page-three', 3); h.flush()
  assert.deepEqual(h.played.map(item => item.event.at), [1, 3])
  h.owner.dispose()
})
