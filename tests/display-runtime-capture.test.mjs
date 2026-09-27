import { projectDisplayRuntimeState } from '../tavern-plugin/lib/domain/chat-session-state.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'

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
  const body = source.slice(source.indexOf('  function assistantMessageAtTurn('), source.indexOf('  const tavernScriptHostAdapter ='))
  const hooks = { beforePatch: async () => {} }
  const capture = vm.runInNewContext(`(function(){${body};return captureDisplayRuntime})()`, {
    str: value => String(value ?? ''), groupOfMode: () => 'play',
    chatForSession: () => persistence.read('chat'), readSessionMap: async () => ({ session: 'chat' }),
    chatPersistence: persistence,
    updateChat: (...args) => persistence.update(...args),
    patchChat: async (...args) => { await hooks.beforePatch(); return persistence.patch(...args) },
    projectDisplayRuntimeState, Date, Math, Object, Array, Number, JSON
  })
  return { records, persistence, capture, hooks, root }
}

test('display captures do not clone historical variable snapshots', async t => {
  const { capture, records } = await harness(t)
  let fullCopies = 0
  const clone = globalThis.structuredClone
  t.mock.method(globalThis, 'structuredClone', value => {
    if (value?.messages?.some(message => message.variables)) fullCopies++
    return clone(value)
  })
  assert.equal((await capture('session', 459, 0, { dom: 'status', panelId: 'main' })).captured, true)
  assert.equal((await capture('session', 459, 0, { dom: 'status', panelId: 'main' })).captured, false)
  assert.equal(fullCopies, 0, 'diagnostic capture must not copy the full chat')
  const saved = await records.read('chat')
  assert.equal(saved.messages.length, 459)
  assert.equal(saved.messages[458].variables.stat_data.gold, 10)
})

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

test('legacy inferred turns and MVU-only reports preserve diagnostic content', async t => {
  const { capture, persistence, records } = await harness(t)
  await persistence.update('chat', chat => {
    chat.messages = [{ role: 'assistant', greeting: true }, { role: 'user' }, { role: 'assistant', text: 'reply' }]
    return chat
  })
  await capture('session', 2, 0, { dom: 'rendered status', panelId: 'panel', mvuViewUsed: true })
  const before = await records.read('chat')
  assert.equal((await capture('session', 2, 0, { panelId: 'panel', mvuViewUsed: true })).captured, false)
  const after = await records.read('chat')
  assert.equal(after._storageRevision, before._storageRevision)
  assert.equal(after.messages[2].displayRuntime.frames[0].dom, 'rendered status')
  const projected = await persistence.readDisplayRuntimeState('chat', 2)
  projected.displayRuntime.frames[0].dom = 'mutation outside transaction'
  assert.equal((await records.read('chat')).messages[2].displayRuntime.frames[0].dom, 'rendered status')
})

test('layout evidence is bounded, persists through replay and deduplicates without touching variables', async t => {
  const { capture, records, root } = await harness(t)
  const layout = { mode: 'viewport', source: 'template', width: 390, height: 600, availableHeight: 600,
    roots: Array.from({ length: 20 }, () => ({ tag: 'BODY', height: 600, scrollHeight: Infinity, id: 'x'.repeat(200), arbitrary: 'discard' })), arbitrary: 'discard' }
  assert.equal((await capture('session', 459, 0, { layout })).captured, true)
  assert.equal((await capture('session', 459, 0, { layout })).captured, false)
  const saved = await createChatJournalStore({ dataRoot: root }).read('chat')
  const evidence = saved.messages[458].displayRuntime.frames[0].layout
  assert.equal(evidence.height, 600)
  assert.equal(evidence.roots.length, 3)
  assert.equal(evidence.roots[0].id.length, 80)
  assert.equal(evidence.roots[0].scrollHeight, null)
  assert.equal(evidence.arbitrary, undefined)
  assert.equal(saved.messages[458].variables.stat_data.gold, 10)
  assert.equal((await capture('session', 459, 0, { layout: { ...layout, height: 400 } })).captured, true)
  assert.equal((await records.read('chat')).messages[458].displayRuntime.frames[0].layout.height, 400)
})
