import { projectDisplayRuntimeState } from '../tavern-plugin/lib/domain/chat-session-state.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createDisplayRuntimeStore, displayRuntimeReceipt } from '../tavern-plugin/lib/domain/display-runtime-store.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'display-capture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const records = createChatJournalStore({ dataRoot: root })
  const persistence = createChatPersistence({ store: records })
  await persistence.write({ id: 'chat', sessionId: 'session', mode: 'story',
    backgroundConfigVersion: 1, conversationFeaturesVersion: 1, updatedAt: Date.now(),
    messages: Array.from({ length: 459 }, (_, turn) => ({ role: 'assistant', turn: turn + 1,
      text: `story ${turn}`, variables: { stat_data: { gold: 10, payload: 'history'.repeat(1000) } } })) })
  const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('  function cleanRuntimeUrl('), source.indexOf('  const tavernScriptHostAdapter ='))
  const hooks = { beforePatch: async () => {} }
  const displayRuntimeStore = createDisplayRuntimeStore({ store: createProfileDataStore({ dataRoot: root }) })
  const capture = vm.runInNewContext(`(function(){${body};return captureDisplayRuntime})()`, {
    str: value => String(value ?? ''), groupOfMode: () => 'play',
    chatForSession: () => persistence.read('chat'), readSessionMap: async () => ({ session: 'chat' }),
    chatPersistence: persistence,
    updateChat: (...args) => persistence.update(...args),
    patchChat: async (...args) => { await hooks.beforePatch(); return persistence.patch(...args) },
    displayRuntimeStore, displayRuntimeReceipt,
    projectDisplayRuntimeState, Date, Math, Object, Array, Number, JSON
  })
  return { records, persistence, capture, hooks, root, displayRuntimeStore }
}

test('concurrent panels survive CAS retries, preserve valid undo and replay from disk', async t => {
  const { capture, persistence, records, root } = await harness(t)
  await persistence.update('chat', chat => {
    chat.rollbackUndo = { ready: true, storageRevision: chat._storageRevision + 1 }
    return chat
  })
  const before = await records.read('chat')
  await Promise.all([
    capture('session', 459, 0, { dom: 'first', panelId: 'one' }),
    capture('session', 459, 1, { dom: 'second', panelId: 'two' })
  ])
  const saved = await createChatJournalStore({ dataRoot: root }).read('chat')
  assert.equal(saved.messages[458].displayRuntime.frames.length, 2)
  assert.equal(saved.rollbackUndo.storageRevision, saved._storageRevision)
  assert.equal(saved.updatedAt, before.updatedAt)
  assert.equal(saved.messages[458].variables.stat_data.gold, 10)
})

test('a concurrent variable commit is retained and invalid undo is not revived', async t => {
  const { capture, persistence, records, hooks } = await harness(t)
  await persistence.update('chat', chat => {
    chat.rollbackUndo = { ready: true, storageRevision: chat._storageRevision + 1 }
    return chat
  })
  let raced = false
  hooks.beforePatch = async () => {
    if (raced) return
    raced = true
    await persistence.update('chat', chat => {
      chat.messages[458].variables.stat_data.gold = 20
      return chat
    })
  }
  await capture('session', 459, 0, { dom: 'status' })
  const saved = await records.read('chat')
  assert.equal(raced, true)
  assert.equal(saved.messages[458].variables.stat_data.gold, 20)
  assert.notEqual(saved.rollbackUndo.storageRevision, saved._storageRevision)
})

test('rollback during capture cannot recreate the removed turn', async t => {
  const { capture, persistence, records, hooks } = await harness(t)
  let raced = false
  hooks.beforePatch = async () => {
    if (raced) return
    raced = true
    await persistence.update('chat', chat => { chat.messages.pop(); return chat })
  }
  await assert.rejects(capture('session', 459, 0, { dom: 'old turn' }), /不存在第 459/)
  const saved = await records.read('chat')
  assert.equal(saved.messages.length, 458)
  assert.equal(saved.messages[457].displayRuntime, undefined)
})

test('layout evidence is bounded, persists through replay and deduplicates without touching variables', async t => {
  const { capture, records, root, displayRuntimeStore } = await harness(t)
  const layout = { mode: 'viewport', source: 'template', width: 390, height: 600, availableHeight: 600,
    roots: Array.from({ length: 20 }, () => ({ tag: 'BODY', height: 600, scrollHeight: Infinity, id: 'x'.repeat(200), arbitrary: 'discard' })), arbitrary: 'discard' }
  assert.equal((await capture('session', 459, 0, { layout })).captured, true)
  assert.equal((await capture('session', 459, 0, { layout })).captured, false)
  const saved = await createChatJournalStore({ dataRoot: root }).read('chat')
  // Layout is diagnostic evidence: kept beside the save, not in its history.
  assert.equal(saved.messages[458].displayRuntime.frames[0].layout, undefined)
  const evidence = (await displayRuntimeStore.read('chat', 459)).frames[0].layout
  assert.equal(evidence.height, 600)
  assert.equal(evidence.roots.length, 3)
  assert.equal(evidence.roots[0].id.length, 80)
  assert.equal(evidence.roots[0].scrollHeight, null)
  assert.equal(evidence.arbitrary, undefined)
  assert.equal(saved.messages[458].variables.stat_data.gold, 10)
  assert.equal((await capture('session', 459, 0, { layout: { ...layout, height: 400 } })).captured, true)
  assert.equal((await displayRuntimeStore.read('chat', 459)).frames[0].layout.height, 400)
})

import { createDisplayRuntimeCoalescer } from '../tavern-plugin/lib/domain/display-runtime-coalescer.js'

test('frame runtime reports are coalesced; first capture, errors and layout save at once', async () => {
  let clock = 0
  const timers = []
  const writes = []
  const coalescer = createDisplayRuntimeCoalescer({ intervalMs: 15000, now: () => clock,
    setTimer: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length }, clearTimer: () => {},
    write: async (sessionId, turn, partIndex, runtime) => { writes.push(runtime.dom); return { captured: true } } })
  const report = (dom, extra = {}) => coalescer.capture('s', 3, 0, { panelId: 'status', dom, ...extra })
  assert.equal((await report('a')).captured, true)
  clock = 1000; assert.equal((await report('b')).deferred, true)
  clock = 2000; assert.equal((await report('c')).deferred, true)
  clock = 3000; assert.equal((await report('d', { errors: [{ kind: 'error', message: 'boom' }] })).captured, true)
  clock = 4000; await report('e', { errors: [{ kind: 'error', message: 'boom' }] })
  assert.deepEqual(writes, ['a', 'd'])
  // One trailing write carries only the latest deferred report.
  clock = 18000; for (const timer of timers.splice(0)) timer.fn()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(writes, ['a', 'd', 'e'])
  clock = 40000; assert.equal((await report('f', { errors: [{ kind: 'error', message: 'boom' }] })).captured, true)
})

test('repainting frames update diagnostics without adding save revisions', async t => {
  const { capture, records, displayRuntimeStore } = await harness(t)
  await capture('session', 459, 0, { dom: 'frame 0', panelId: 'status' })
  const first = (await records.read('chat'))._storageRevision
  for (let i = 1; i <= 5; i++) assert.equal((await capture('session', 459, 0, { dom: 'frame ' + i, panelId: 'status' })).captured, true)
  const saved = await records.read('chat')
  assert.equal(saved._storageRevision, first)
  assert.deepEqual(saved.messages[458].displayRuntime, { version: 2, frames: [{ partIndex: 0, panelId: 'status', placement: 'message' }] })
  assert.equal((await displayRuntimeStore.read('chat', 459)).frames[0].dom, 'frame 5')
  // A new panel or an MVU read changes the receipt and is saved once.
  await capture('session', 459, 0, { dom: '', panelId: 'status', mvuViewUsed: true })
  assert.equal((await records.read('chat'))._storageRevision, first + 1)
})

test('captures kept inline by older saves shrink to a receipt on the next capture', async t => {
  const { capture, persistence, records, displayRuntimeStore } = await harness(t)
  await persistence.update('chat', chat => {
    chat.messages[458].displayRuntime = { version: 1, sourceActivityAt: 1, frames: [{ partIndex: 1, panelId: 'old', placement: 'sidebar', dom: 'x'.repeat(5000) }] }
    return chat
  })
  await capture('session', 459, 0, { dom: 'new', panelId: 'status' })
  const saved = await records.read('chat')
  assert.deepEqual(saved.messages[458].displayRuntime.frames.map(frame => frame.panelId), ['status', 'old'])
  assert.equal(JSON.stringify(saved.messages[458].displayRuntime).includes('xxxx'), false)
  assert.equal((await displayRuntimeStore.read('chat', 459)).frames.length, 2)
})
