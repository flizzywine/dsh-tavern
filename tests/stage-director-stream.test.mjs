import assert from 'node:assert/strict'
import test from 'node:test'
import { createStageDirectorStream, observeStageText } from '../tavern-plugin/lib/domain/stage-director-stream.js'
import { stageDirectorFixture } from './helpers/stage-director-fixture.mjs'

const text = 'One.\nTwo.\nThree.\nFour.\nFive.\nSix.\nSeven.'
const tick = () => new Promise(resolve => setImmediate(resolve))
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await tick() } assert.fail('condition did not settle') }
async function fixture(run) {
  const assets = { player: 'Reader', cast: [{ name: 'Nora' }], background: [{ name: 'Room' }], music: [{ name: 'Theme' }] }
  const reference = { input: 'Continue.', cardContext: 'Frozen card.', activeWorldbook: 'Frozen lore.', currentStateProjection: 'Before settlement.' }
  const prompts = [], receipts = [], errors = []
  let regenerating = false
  const h = await stageDirectorFixture({ id: 'story', sessionId: 'game', mode: 'story', timeline: {
    branchId: 'branch', revision: 1, operations: { body: { id: 'body', kind: 'body', status: 'running', turn: 2 } }
  }, messages: [{ role: 'assistant', turn: 1, text: 'Opening.' }] }, assets, {
    readContext: async () => reference,
    runAgent: async input => {
      const context = JSON.parse(input.turnContext), { first, ...seal } = context.window
      prompts.push({ input, context })
      const call = async delta => { const receipt = JSON.parse(await input.onToolCall({ arguments: { ...seal, ...delta } })); receipts.push(receipt); return receipt }
      if (run) await run({ input, context, call })
      else await call(context.window.sequence === 1 ? { figures: [{ speaker: 'Nora' }], background: 'Room', music: 'Theme', performances: [{ at: 1, op: 'actor.act.play', actor: 'Nora', motion: 'nod' }] } : { performances: [{ at: 6, op: 'actor.act.play', actor: 'Nora', motion: 'jump' }] })
    }
  })
  const source = async () => {
    // Like the host, a regenerating chat has no current round.
    if (regenerating) return null
    const chat = await h.read(), operation = chat.timeline.operations.body
    return { chatId: chat.id, operationId: operation.id, status: operation.status, branchId: chat.timeline.branchId, revision: chat.timeline.revision }
  }
  const stream = createStageDirectorStream({ director: h.director, source, catalog: async () => assets, warn: error => errors.push(error.message) })
  async function submit(finalText = text) {
    await h.persistence.update('story', chat => { chat.messages.push({ role: 'assistant', turn: 2, text: finalText }); chat.timeline.revision++; chat.timeline.operations.body.status = 'completed'; return chat })
    return h.body()
  }
  return { ...h, stream, submit, source, prompts, receipts, errors, reference, regenerate: () => { regenerating = true } }
}

test('five complete rows start before body submission; only accepted prefixes render, final CAS persists both windows', async () => {
  const h = await fixture(), observer = await h.stream.begin('game', 2)
  observer.append('One.\nTwo.\nThree.\nFour.\nFive.')
  await tick(); assert.equal(h.prompts.length, 0, 'an unfinished fifth paragraph is not sealed')
  observer.append('\nSix.\nSeven.')
  await until(() => h.receipts.length === 1)
  assert.equal(h.prompts.length, 1)
  assert.equal((await h.read()).messages.length, 1, 'foreground has not submitted yet')
  assert.equal(await h.data.snapshot('story'), null, 'prefix is memory only')
  const preview = await h.stream.preview('game')
  assert.equal(preview.pages.length, 5)
  assert.equal(preview.state.music, 'Theme')
  assert.deepEqual(h.prompts[0].context.window, { sequence: 1, through: 5, done: true, first: 1 })
  const body = await h.submit()
  const before = await h.read()
  assert.equal(await h.stream.finish(body), true)
  assert.equal(h.prompts.length, 2, 'not a repeating five-row window loop')
  assert.deepEqual(h.prompts[1].context.window, { sequence: 2, through: 7, done: true, first: 6 })
  assert.doesNotMatch(h.prompts[1].input.messages[0].content[0].text, /\[1\]/)
  assert.deepEqual(await h.read(), before, 'stage persistence never rewrites story data')
  assert.equal(await h.stream.preview('game'), null)
  const record = await h.director.presentation('game', 2, body.key)
  assert.equal(record.presentationKey, preview.key, 'finalization retains the playback source identity')
  assert.deepEqual(record.performances.map(event => event.at), [1, 6])
  assert.equal((await h.director.state('game', 2)).music, 'Theme')
  assert.deepEqual(h.errors, [])
})

test('window envelope and events repair in the same request; sealed pages cannot be rewritten', async () => {
  const h = await fixture(async ({ context, call }) => {
    assert.equal((await call({ through: 99 })).ok, false)
    assert.equal((await call({ sequence: 99 })).ok, false)
    assert.equal((await call({ done: !context.window.done })).ok, false)
    assert.equal((await call({ performances: [{ at: context.window.first === 1 ? 6 : 1, op: 'screen.play', effect: 'shake-1' }] })).ok, false)
    assert.equal((await call({})).ok, true)
  })
  ;(await h.stream.begin('game', 2)).append(text)
  await until(() => h.receipts.length === 5)
  assert.equal(await h.data.snapshot('story'), null)
  await h.stream.finish(await h.submit())
  assert.equal(h.prompts.length, 2)
  assert.equal(h.receipts.filter(value => value.ok).length, 2)
  assert.deepEqual(h.errors, [])
})

test('context, selection and catalog are frozen for both windows, not read from changing settlement state', async () => {
  const h = await fixture()
  ;(await h.stream.begin('game', 2)).append(text)
  await until(() => h.receipts.length === 1)
  h.reference.activeWorldbook = 'New live lore.'
  h.reference.currentStateProjection = 'After settlement.'
  await h.stream.finish(await h.submit())
  assert.deepEqual(h.prompts[1].context.reference, h.prompts[0].context.reference)
  assert.equal(h.prompts[1].context.reference.activeWorldbook, 'Frozen lore.')
  assert.deepEqual(h.prompts[1].input.selection, h.prompts[0].input.selection)
  assert.equal(h.prompts[1].context.state.music, 'Theme', 'next window sees accepted stage state, not the old baseline')
})

for (const change of ['prefix', 'catalog', 'branch', 'operation', 'cancel']) test('stale stream cannot persist either channel: ' + change, async () => {
  const h = await fixture(), observer = await h.stream.begin('game', 2)
  observer.append(text)
  await until(() => h.receipts.length === 1)
  const body = await h.submit(change === 'prefix' ? text.replace('One.', 'Replaced.') : text)
  if (change === 'catalog') h.assets.music.push({ name: 'New' })
  if (change === 'branch') await h.persistence.update('story', chat => { chat.timeline.branchId = 'other'; return chat })
  if (change === 'operation') await h.persistence.update('story', chat => { chat.timeline.operations.body.id = 'replacement'; return chat })
  await h.stream.finish(body, change === 'cancel' ? AbortSignal.abort() : undefined)
  assert.equal(await h.data.snapshot('story'), null)
  assert.equal(await h.stream.preview('game'), null)
  assert.ok(h.errors.length)
})

for (const moment of ['streaming', 'finishing']) test('choices or bookkeeping moving the story revision do not stop the director: ' + moment, async () => {
  const bump = () => h.persistence.update('story', chat => { chat.timeline.revision++; return chat })
  const h = await fixture(async ({ context, call }) => {
    if (moment === 'finishing' && context.window.sequence === 2) await bump()
    await call(context.window.sequence === 1 ? { figures: [{ speaker: 'Nora' }], music: 'Theme' } : { performances: [{ at: 6, op: 'actor.act.play', actor: 'Nora', motion: 'jump' }] })
  })
  ;(await h.stream.begin('game', 2)).append(text)
  await until(() => h.receipts.length === 1)
  if (moment === 'streaming') await bump()
  const body = await h.submit()
  if (moment === 'streaming') await bump()
  await h.stream.finish(body)
  assert.deepEqual(h.errors, [])
  assert.deepEqual((await h.director.presentation('game', 2, body.key)).performances.map(event => event.at), [6])
  assert.equal((await h.director.state('game', 2)).music, 'Theme')
})

test('a stopped director logs what stopped it, not the runner\'s generic stop', async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const h = await fixture(async ({ input }) => {
    await blocked
    if (input.signal.aborted) throw Error('后台任务已停止；已生成的正文保留，可重新结算。')
  })
  ;(await h.stream.begin('game', 2)).append(text)
  await until(() => h.prompts.length === 1)
  // Regenerating starts a new body operation for the same turn.
  await h.persistence.update('story', chat => { chat.timeline.operations.body.id = 'again'; return chat })
  await h.stream.begin('game', 2)
  release()
  await until(() => h.errors.length === 1)
  assert.deepEqual(h.errors, ['舞台导演已停止：本轮正文已变化'])
})

// Regenerating marks the chat (the source reports no round) before its new request starts; a preview or
// the new request's cancel may notice first, and either must log the prose change.
for (const noticedBy of ['preview', 'new request']) test('a regenerate during the second window logs that the prose changed: ' + noticedBy, async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const h = await fixture(async ({ context, input, call }) => {
    if (context.window.sequence === 1) return void await call({ music: 'Theme' })
    await blocked
    if (input.signal.aborted) throw Error('后台任务已停止；已生成的正文保留，可重新结算。')
  })
  ;(await h.stream.begin('game', 2)).append(text)
  await until(() => h.receipts.length === 1)
  const finished = h.stream.finish(await h.submit())
  await until(() => h.prompts.length === 2)
  h.regenerate()
  if (noticedBy === 'preview') assert.equal(await h.stream.preview('game'), null)
  else await h.stream.cancel('game')
  release()
  await finished
  assert.deepEqual(h.errors, ['舞台导演已停止：本轮正文已变化'])
  assert.equal(await h.data.snapshot('story'), null)
})

test('a new request after a round that still stands logs the interruption', async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const h = await fixture(async ({ input }) => { await blocked; if (input.signal.aborted) throw Error('generic') })
  ;(await h.stream.begin('game', 2)).append(text)
  await until(() => h.prompts.length === 1)
  await h.stream.cancel('game')
  release()
  await until(() => h.errors.length === 1)
  assert.deepEqual(h.errors, ['舞台导演已停止：正文生成已中止或已开始新的正文'])
})

for (const count of [3, 5]) test('short or exact-five body needs only one director request: ' + count, async () => {
  const h = await fixture(async ({ call }) => { await call({}) })
  const observer = await h.stream.begin('game', 2), bodyText = text.split('\n').slice(0, count).join('\n')
  observer.append(bodyText + '\n')
  if (count === 5) await until(() => h.receipts.length === 1)
  await h.stream.finish(await h.submit(bodyText))
  assert.equal(h.prompts.length, 1)
  assert.ok(await h.data.snapshot('story'))
  assert.deepEqual(h.errors, [])
})

test('stream pages reuse the host projection instead of addressing markup as story paragraphs', async () => {
  const h = await fixture()
  ;(await h.stream.begin('game', 2)).append('<content>\n' + text + '\n</content>')
  await until(() => h.receipts.length === 1)
  assert.equal((await h.stream.preview('game')).pages[0].text, 'One.')
  await h.stream.finish(await h.submit())
  assert.deepEqual(h.errors, [])
})

for (const template of ['{{setvar::x::1}}', '<% print(value) %>', '<script>\nprogram\n</script>']) test('effectful or executable source waits for host final projection: ' + template, async () => {
  const h = await fixture(async ({ call }) => { await call({}) })
  ;(await h.stream.begin('game', 2)).append(template + '\n' + text)
  await tick(); assert.equal(h.prompts.length, 0)
  await h.stream.finish(await h.submit())
  assert.equal(h.prompts.length, 1)
  assert.equal(h.prompts[0].context.window.through, 7)
  assert.deepEqual(h.errors, [])
})

test('a predecessor changed during generation rejects final publication under the journal lock', async () => {
  const h = await fixture()
  ;(await h.stream.begin('game', 2)).append(text)
  await until(() => h.receipts.length === 1)
  await (await h.prepare()).call({ background: 'Room' })
  const body = await h.submit()
  await h.stream.finish(body)
  assert.equal(await h.director.presentation('game', 2, body.key), null)
  assert.ok(h.errors.length)
})

test('clear after a first-window entrance folds identically before and after persistence', async () => {
  const h = await fixture(async ({ context, call }) => {
    await call(context.window.sequence === 1 ? { figures: [{ speaker: 'Nora' }], music: 'Theme' } : { figures: null, music: null })
  })
  ;(await h.stream.begin('game', 2)).append(text)
  await until(() => h.receipts.length === 1)
  assert.equal((await h.stream.preview('game')).state.figures.length, 1)
  await h.stream.finish(await h.submit())
  assert.deepEqual(await h.director.state('game', 2), { figures: [], background: null, music: null })
})

test('disposed streams cannot reopen an operation', async () => {
  const h = await fixture()
  h.stream.dispose()
  assert.equal(await h.stream.begin('game', 2), null)
})

test('late tools after cancellation cannot revive a prefix', async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const h = await fixture(async ({ call }) => { await blocked; assert.equal((await call({})).ok, false) })
  const observer = await h.stream.begin('game', 2)
  observer.append(text)
  await until(() => h.prompts.length === 1)
  h.stream.cancel('game', 1)
  assert.ok(await h.stream.preview('game'), 'a late end for another turn cannot cancel this generation')
  observer.cancel(); release()
  await until(() => h.receipts.length === 1)
  assert.equal(await h.stream.preview('game'), null)
  assert.equal(await h.data.snapshot('story'), null)
})

test('stream observation buffers preparation without blocking tokens; errors/cancellation discard late setup', async () => {
  let release, cancels = 0
  const bytes = [], wait = new Promise(resolve => { release = resolve })
  const observer = observeStageText({ begin: async () => { await wait; return { append: text => bytes.push(text), cancel: () => cancels++ } } })
  observer.append('a'); observer.append('b')
  release(); await observer.finish(true)
  assert.deepEqual(bytes, ['ab'])
  const controller = new AbortController()
  const cancelled = observeStageText({ signal: controller.signal, begin: async () => ({ append: text => bytes.push(text), cancel: () => cancels++ }) })
  cancelled.append('never'); controller.abort(); await cancelled.finish(false)
  assert.deepEqual(bytes, ['ab'])
  assert.equal(cancels, 1)
})
