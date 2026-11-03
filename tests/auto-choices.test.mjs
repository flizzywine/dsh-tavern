import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoChoices } from '../tavern-plugin/lib/domain/auto-choices.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

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

test('the switch is decided per chat: a card switched off skips its reply', async () => {
  const h = harness()
  h.state.chat.id = 'other-card-chat'
  await h.scheduler.completed(h.event)
  await h.tick()
  assert.equal(h.calls.length, 0)
  assert.equal(h.scheduler.isPending('game'), false)
})

test('requests: settings save it, turning it off drops waiting replies, manual and edit requests supersede it', async () => {
  const cancelled = []
  const autoChoices = { cancel: id => cancelled.push(id), cancelAll: () => cancelled.push('*') }
  let document = {}
  const readTavernSettings = async () => presentTavernSettings(document)
  const settings = createSettingsHandlers({ autoChoices, readTavernSettings,
    updateTavernSettings: async patch => { document = applyTavernSettingsPatch(document, patch); return readTavernSettings() } })
  assert.equal((await readTavernSettings()).candidateAutoGenerate, false)
  assert.equal((await settings.updateTavernSettings({ patch: { candidateAutoGenerate: true } })).settings.candidateAutoGenerate, true)
  assert.deepEqual(cancelled, [])
  await settings.updateTavernSettings({ patch: { candidateAutoGenerate: false } })
  assert.deepEqual(cancelled, ['*'])
  const submitted = []
  const play = createPlayHandlers({ autoChoices, str: value => value == null ? '' : String(value),
    candidateTasks: { submit: async args => { submitted.push(args); return {} } },
    bodyEditor: { read: async () => ({ token: 't' }) } })
  await play.submitTask({ sessionId: 'game', kind: 'candidate', messageId: 'reply' })
  await play.getBodyEdit({ sessionId: 'game' })
  assert.deepEqual(cancelled, ['*', 'game', 'game'])
  assert.equal(submitted.length, 1)
})
