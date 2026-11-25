import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoChoices } from '../tavern-plugin/lib/domain/auto-choices.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

function harness() {
  const timers = new Set(), calls = [], errors = []
  let settings = { candidateAutoGenerate: true }
  const state = { messageId: 'reply-1', chat: {
    id: 'chat', mode: 'story', timeline: { branchId: 'branch' },
    messages: [{ role: 'assistant', turn: 1, ts: 100, text: 'A completed reply' }]
  } }
  const background = { busy: false, role: '', phase: 'idle' }
  let fail = false
  const scheduler = createAutoChoices({
    read: async () => structuredClone(state), enabled: async chat => chat?.id === 'chat' && settings.candidateAutoGenerate === true,
    activity: () => background,
    submit: async args => { calls.push(args); if (fail) throw new Error('submit failed') },
    defer: callback => { timers.add(callback); return callback }, clear: callback => timers.delete(callback),
    report: (...args) => errors.push(args)
  })
  const event = { sessionId: 'game', messageId: 'reply-1', turn: 1, reason: 'completed' }
  async function tick() {
    const batch = [...timers]; timers.clear()
    for (const callback of batch) callback()
    await new Promise(resolve => setImmediate(resolve))
  }
  return { scheduler, state, background, calls, errors, timers, event, tick,
    enable(value) { settings = { candidateAutoGenerate: value } }, fail() { fail = true } }
}

test('only live completed replies qualify: no catch-up on open, no unfinished replies, nothing observed while off', async () => {
  const h = harness()
  await h.tick()
  assert.equal(h.calls.length, 0, 'opening a chat is not a completion event')
  for (const reason of ['running', 'error', 'aborted']) await h.scheduler.completed({ ...h.event, reason })
  await h.tick()
  assert.equal(h.calls.length, 0)
  h.enable(false)
  await h.scheduler.completed(h.event)
  h.enable(true)
  await h.scheduler.completed(h.event)
  await h.tick()
  assert.equal(h.calls.length, 0, 'turning it on later does not replay a reply completed while off')
  h.state.messageId = 'reply-2'; h.state.chat.messages[0].turn = 2
  await h.scheduler.completed({ ...h.event, messageId: 'reply-2', turn: 2 })
  assert.equal(h.calls.length, 1, 'an idle completion submits at once, without waiting for a tick')
  assert.equal(h.timers.size, 0)
})

test('settlement, background activity and compaction wait, then submit once like the manual button', async () => {
  for (const mode of ['story', 'script']) {
    const h = harness(); h.state.chat.mode = mode
    h.background.role = 'settlement'; h.background.phase = 'pending'
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 0, 'pending settlement blocks even while not busy')
    h.background.busy = true; h.background.phase = 'running'
    await h.tick()
    h.background.role = 'worldbook'
    await h.tick()
    h.background.busy = false; h.background.phase = 'idle'
    h.state.chat.contextCompaction = { operation: { status: 'running' } }
    await h.tick()
    assert.equal(h.calls.length, 0)
    h.state.chat.contextCompaction.operation.status = 'completed'
    await h.tick()
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 1)
    assert.deepEqual(h.calls[0], { sessionId: 'game', messageId: 'reply-1', kind: 'candidate', guidance: '', requestId: h.calls[0].requestId })
    assert.match(h.calls[0].requestId, /^auto-choices-[a-f0-9]{64}$/)
    assert.equal(h.timers.size, 0)
  }
})

test('a max-tokens reply qualifies and does not wait for other foreground work', async () => {
  const h = harness()
  h.state.running = true
  h.state.director = { status: 'running' }
  await h.scheduler.completed({ ...h.event, reason: 'max-tokens' })
  assert.equal(h.calls.length, 1)
  assert.equal(h.timers.size, 0)
})

test('compaction and regeneration defer the same reply until they clear', async () => {
  for (const blocked of ['compaction', 'regen']) {
    const h = harness()
    if (blocked === 'compaction') h.state.chat.contextCompaction = { operation: { status: 'running' } }
    else h.state.chat.regenInProgress = true
    await h.scheduler.completed(h.event)
    assert.equal(h.calls.length, 0)
    await h.tick()
    assert.equal(h.calls.length, 0)
    h.state.chat.regenInProgress = false
    h.state.chat.contextCompaction = null
    await h.tick()
    assert.equal(h.calls.length, 1)
    await h.tick()
    assert.equal(h.calls.length, 1)
  }
})

test('an existing candidate panel or candidate task for the reply, even a failed one, wins', async () => {
  for (const existing of ['panel', 'queued', 'running', 'succeeded', 'failed', 'cancelled']) {
    const h = harness()
    if (existing === 'panel') h.state.chat.candidates = { messageId: 'reply-1' }
    else h.state.chat.taskMailbox = { tasks: { task: { kind: 'candidate', status: existing, input: { messageId: 'reply-1' } } } }
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 0, existing)
    assert.equal(h.timers.size, 0)
  }
})

test('card mode, greetings, empty replies and other turns never qualify', async () => {
  for (const change of [h => { h.state.chat.mode = 'card' },
    h => { h.state.chat.messages[0].greeting = true }, h => { h.state.chat.messages[0].text = '' },
    h => { h.state.chat.messages[0].turn = 0 }]) {
    const h = harness(); change(h)
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 0)
    assert.equal(h.timers.size, 0)
  }
})

test('turning it off, edits, branches, newer replies and cancellation drop a waiting reply', async () => {
  for (const change of [h => h.enable(false), h => { h.state.chat.messages[0].text = 'edited' },
    h => { h.state.chat.timeline.branchId = 'other' },
    h => { h.state.messageId = 'new-message' }, h => h.scheduler.cancel('game'), h => h.scheduler.cancelAll()]) {
    const h = harness()
    h.state.chat.contextCompaction = { operation: { status: 'running' } }
    await h.scheduler.completed(h.event)
    change(h)
    await h.tick()
    h.state.chat.contextCompaction = null
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 0)
    assert.equal(h.timers.size, 0)
  }
})

test('duplicate completions, a failed submission and disposal never retry or submit twice', async () => {
  const h = harness(); h.fail()
  await Promise.all([h.scheduler.completed(h.event), h.scheduler.completed(h.event)])
  await h.tick(); await h.tick()
  await h.scheduler.completed(h.event); await h.tick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.errors.length, 1)
  const disposed = harness()
  disposed.state.chat.regenInProgress = true
  await disposed.scheduler.completed(disposed.event)
  disposed.scheduler.dispose()
  await disposed.tick()
  assert.equal(disposed.calls.length, 0)
  assert.equal(disposed.timers.size, 0)
})

test('cancelling during the first read cannot re-arm the reply', async () => {
  let release
  const settings = new Promise(resolve => { release = resolve })
  const timers = []
  const scheduler = createAutoChoices({ enabled: async () => (await settings).candidateAutoGenerate === true, read: async () => ({}),
    activity: () => ({}), submit: () => assert.fail('cancelled reply submitted'), defer: callback => timers.push(callback) })
  const pending = scheduler.completed({ sessionId: 'game', messageId: 'reply', turn: 1, reason: 'completed' })
  scheduler.cancel('game')
  release({ candidateAutoGenerate: true })
  await pending
  assert.equal(timers.length, 0)
})

test('the setting is off by default, strictly boolean and leaves other settings alone', () => {
  assert.equal(presentTavernSettings({}).candidateAutoGenerate, false)
  assert.equal(presentTavernSettings({ candidateAutoGenerate: 'true' }).candidateAutoGenerate, false)
  assert.throws(() => applyTavernSettingsPatch({}, { candidateAutoGenerate: 'true' }))
  const saved = JSON.parse(JSON.stringify(applyTavernSettingsPatch({ candidateDismissMode: 'after-send', custom: 7 }, { candidateAutoGenerate: true })))
  assert.equal(presentTavernSettings(saved).candidateAutoGenerate, true)
  assert.equal(presentTavernSettings(saved).candidateDismissMode, 'after-send')
  assert.equal(saved.custom, 7)
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(saved, { candidateAutoGenerate: false })).candidateAutoGenerate, false)
})
