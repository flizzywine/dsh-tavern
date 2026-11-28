import assert from 'node:assert/strict'
import test from 'node:test'
import { CARD_RELOAD_BUSY, createCardAutoReload, createPlayCardUpdate } from '../tavern-plugin/lib/domain/card-auto-reload.js'

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
    assert.deepEqual(published, automatic ? ['session'] : [])

    running = false
    startDuringPrepare = false
    if (automatic) {
      await updates.notice('session')
      await jobs.shift()()
      assert.deepEqual(published, ['session', 'session'])
    } else {
      await updates.applyManual('session', status.digest)
    }
    assert.equal(writes, 1)
    assert.equal(chat.applied, true)
    assert.equal(chat.tavernHelperLifecycleRevision, 5)
  }
})

test('自动更新失败也发布已结束的状态，旧的正在更新视图失效', async () => {
  const jobs = []
  const published = []
  const reload = createCardAutoReload({
    apply: async () => { throw new Error('更新失败') },
    published: sessionId => { published.push({ running: reload.running(sessionId), revision: reload.revision(sessionId) }) },
    defer: job => jobs.push(job),
    logger: { warn() {} }
  })
  assert.equal(reload.revision('session'), 0)
  assert.equal(reload.schedule('session', status), true)
  assert.equal(reload.running('session'), true)
  assert.equal(reload.revision('session'), 1)
  await jobs.shift()()
  assert.deepEqual(published, [{ running: false, revision: 2 }])
  assert.equal(reload.failure('session', status.digest), '更新失败')
  assert.equal(reload.schedule('session', status), false)
})

test('自动重载连续遇到存档写入时等待空闲重试，并保留最新变量', async () => {
  const jobs = [], published = []
  let clock = 10000, concurrentWrites = 3, committed = 0
  let chat = { id: 'chat', sessionId: 'session', cardPath: 'hero', _storageRevision: 1,
    tavernHelperLifecycleRevision: 4, variables: { hp: 8 } }
  const updates = createPlayCardUpdate({
    chats: {
      header: async () => chat,
      forSession: async () => chat,
      update: async (_id, mutate) => {
        if (concurrentWrites > 0) {
          concurrentWrites--
          chat = { ...chat, _storageRevision: chat._storageRevision + 1, variables: { hp: chat.variables.hp - 1 } }
        }
        chat = mutate(chat)
        committed++
        return chat
      }
    },
    cards: { read: async () => ({ name: 'hero' }), extensions: async () => ({}), stamp: async () => 1 },
    snapshots: () => ({ currentStatus: async () => status, replacement: async () => ({ applied: true }) }),
    liveUpdate: { prepare: async prepared => prepared, project: async () => {} },
    native: { agent: () => null, session: () => null },
    activity: { observed: async () => ({ busy: false }), current: () => ({ busy: false }) },
    present: async saved => saved,
    published: id => published.push(id),
    now: () => clock,
    defer: job => jobs.push(job),
    logger: { warn: () => assert.fail('暂时的存档写入冲突不应记录为失败') }
  })

  assert.equal((await updates.status(chat)).autoReloading, true)
  await jobs.shift()()
  assert.equal(concurrentWrites, 0)
  assert.equal(committed, 0)
  assert.deepEqual(chat.variables, { hp: 5 })
  assert.equal(chat.tavernHelperLifecycleRevision, 4)
  const waiting = await updates.status(chat)
  assert.equal(waiting.autoReloading, false)
  assert.equal(waiting.autoReloadError, '')
  await updates.notice('session')
  assert.equal(jobs.length, 0, '状态刷新和空闲探测不会马上重新尝试')

  clock += 5000
  await updates.notice('session')
  assert.equal(jobs.length, 1)
  await jobs.shift()()
  assert.equal(committed, 1)
  assert.equal(chat.applied, true)
  assert.equal(chat.tavernHelperLifecycleRevision, 5)
  assert.equal(chat.cardAutoReload.at, clock)
  assert.deepEqual(chat.variables, { hp: 5 })
  assert.deepEqual(published, ['session', 'session'])
})
