import assert from 'node:assert/strict'
import test from 'node:test'
import { CARD_RELOAD_BUSY, createPlayCardUpdate } from '../tavern-plugin/lib/domain/card-auto-reload.js'

const status = { available: true, cardChanged: true, digest: 'card-v2' }

test('准备更新期间前台开始生成，自动和手动更新都在提交时让路', async () => {
  for (const automatic of [true, false]) {
    const jobs = [], published = []
    let running = false, startDuringPrepare = true, writes = 0
    let chat = { id: 'chat', sessionId: 'session', cardPath: 'hero', _storageRevision: 1, tavernHelperLifecycleRevision: 4 }
    const updates = createPlayCardUpdate({
      chats: {
        header: async () => chat,
        forSession: async () => chat,
        update: async (id, mutate) => {
          assert.equal(id, chat.id)
          chat = mutate(chat)
          writes++
          return chat
        }
      },
      cards: { read: async () => ({ name: 'hero' }), extensions: async () => ({}), stamp: async () => 1 },
      snapshots: () => ({ currentStatus: async () => status, replacement: async () => ({ applied: true }) }),
      liveUpdate: {
        prepare: async prepared => {
          if (startDuringPrepare) running = true
          return prepared
        },
        project: async () => {}
      },
      native: { agent: () => ({ phase: { kind: running ? 'running' : 'idle' } }), session: () => null },
      activity: { observed: async () => ({ busy: false }), current: () => ({ busy: false }) },
      present: async saved => saved,
      published: sessionId => published.push(sessionId),
      defer: job => jobs.push(job),
      logger: { warn: () => assert.fail('暂时忙碌不应记录失败') }
    })

    if (automatic) {
      await updates.status(chat)
      await jobs.shift()()
    } else {
      await assert.rejects(updates.applyManual('session', status.digest), { code: CARD_RELOAD_BUSY })
    }
    assert.equal(writes, 0)
    assert.equal(chat.tavernHelperLifecycleRevision, 4)
    assert.deepEqual(published, [])

    running = false
    startDuringPrepare = false
    if (automatic) {
      await updates.notice('session')
      await jobs.shift()()
      assert.deepEqual(published, ['session'])
    } else {
      await updates.applyManual('session', status.digest)
    }
    assert.equal(writes, 1)
    assert.equal(chat.applied, true)
    assert.equal(chat.tavernHelperLifecycleRevision, 5)
  }
})
