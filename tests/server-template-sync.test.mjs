import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {createServerTemplateSync, serverTemplateSyncState} from '../tavern-plugin/lib/domain/server-template-sync.js'
import {createTavernScriptHostAdapter} from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

test('official opening commits before EJS display writes even across repeated view invalidations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let chat = { id: 'chat', sessionId: 'session', mode: 'story', _storageRevision: 2,
    mvu: { enabled: true, owner: 'official', openingInitialization: { version: 2, status: 'pending' } },
    messages: [{ role: 'assistant', greeting: true, text: 'Opening', swipes: ['Opening'], swipeId: 0, variables: [{}] }] }
  const writes = []
  const sync = createServerTemplateSync({ run: async () => {
    writes.push('template')
    chat.messages[0].template_rendered = { hash: 'rendered', swipe: 0 }
    chat._storageRevision++
  } })
  t.after(() => sync.dispose())
  const schedule = () => sync.schedule(chat.sessionId, chat._storageRevision, serverTemplateSyncState(chat))
  let release, reached
  const barrier = new Promise(resolve => { release = resolve })
  const reading = new Promise(resolve => { reached = resolve })
  const adapter = createTavernScriptHostAdapter({
    resolveChat: async () => structuredClone(chat),
    isPlayChat: () => true,
    readCard: async () => ({ name: 'Test' }),
    worldBooks: { bound: async () => null },
    scriptDispatch: {},
    writeChat: async draft => {
      reached(); await barrier
      assert.equal(draft._storageRevision, chat._storageRevision, 'EJS must not invalidate the MVU messages CAS baseline')
      writes.push('mvu'); chat = structuredClone(draft); chat._storageRevision++
      schedule()
    }
  })
  schedule()
  const mutation = adapter.updateMessages('session', [{ message_id: 0, data: { schema: {}, stat_data: { inventory: ['water'] } } }])
  await reading
  for (let i = 0; i < 10; i++) { schedule(); t.mock.timers.tick(1000); await Promise.resolve() }
  assert.deepEqual(writes, [], 'pending opening must not run templates even with a slow MVU writer')
  release(); await mutation
  assert.equal(chat.mvu.openingInitialization.status, 'complete')
  t.mock.timers.tick(250); await Promise.resolve()
  assert.deepEqual(writes, ['mvu', 'template'])
  assert.deepEqual(chat.messages[0].variables[0].stat_data, { inventory: ['water'] })
  assert.equal(chat.messages[0].template_rendered.hash, 'rendered')
})

test('template ordering preserves non-MVU, prepared openings and settlement gates', () => {
  for (const mode of [undefined, 'story', 'script']) assert.deepEqual(serverTemplateSyncState({ mode }), { enabled: true, blocked: false })
  assert.equal(serverTemplateSyncState({ mode: 'card' }).enabled, false)
  assert.equal(serverTemplateSyncState({ mvu: { enabled: true, owner: 'official', openingInitialization: { status: 'complete' } } }).blocked, false)
  for (const settleStatus of ['pending', 'running']) assert.equal(serverTemplateSyncState({ settleStatus }).blocked, true)
})


test('entering settlement cancels a pending retry and blocks a running callback from rearming', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let runs = 0, release
  const sync = createServerTemplateSync({ run: () => { runs++; return new Promise(resolve => { release = resolve }) } })
  t.after(() => sync.dispose())
  sync.schedule('s', 1)
  t.mock.timers.tick(250)
  sync.schedule('s', 2, { blocked: true })
  release({ deferred: true }); await Promise.resolve()
  for (let i = 0; i < 40; i++) { t.mock.timers.tick(250); await Promise.resolve() }
  assert.equal(runs, 1)
  sync.schedule('s', 3)
  t.mock.timers.tick(250)
  release({ deferred: true }); await Promise.resolve()
  sync.schedule('s', 4, { blocked: true })
  t.mock.timers.tick(5000); await Promise.resolve()
  assert.equal(runs, 2)
  sync.schedule('s', 4, { blocked: false })
  t.mock.timers.tick(250)
  assert.equal(runs, 3, 'unblocking the same revision still wakes work')
  release({}); await Promise.resolve()
})
