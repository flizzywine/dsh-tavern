import assert from 'node:assert/strict'
import test from 'node:test'
import { createGameSaveSnapshot } from '../tavern-plugin/lib/domain/game-save-snapshot.js'

for (const mutation of ['native', 'chat', 'running', 'none']) test('导出快照检测并发变化：' + mutation, async () => {
  let chat = { id: 'c', sessionId: 's', _storageRevision: 1 }, session = { events: [{ seq: 0 }] }, running = false
  const capture = createGameSaveSnapshot({
    readChat: async () => structuredClone(chat), readSession: async () => structuredClone(session),
    assertIdle() { if (running) throw Error('running') }
  })
  const operation = capture('c', 's', async snapshot => {
    if (mutation === 'native') session.events.push({ seq: 1 })
    if (mutation === 'chat') chat._storageRevision++
    if (mutation === 'running') running = true
    return snapshot
  })
  if (mutation === 'none') assert.deepEqual(await operation, { chat, session })
  else await assert.rejects(operation, /发生变化|running/)
  running = false
  assert.deepEqual(await capture('c', 's', async value => value), { chat, session }, '失败后重试读取最新稳定快照')
})

test('读取 Chat 之前新增的原生事件也不会混入旧状态包', async () => {
  const session = { events: [] }
  let reads = 0
  const capture = createGameSaveSnapshot({ readSession: async () => structuredClone(session), assertIdle() {},
    readChat: async () => { if (++reads === 1) session.events.push({ seq: 0 }); return { sessionId: 's', _storageRevision: 1 } } })
  await assert.rejects(capture('c', 's', async value => value), /发生变化/)
})
