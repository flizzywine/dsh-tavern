import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCandidateTasks } from '../tavern-plugin/lib/domain/candidate-tasks.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createDurableTaskMailbox } from '../tavern-plugin/lib/domain/durable-task-mailbox.js'
import { createCoordinationEventPublisher } from '../tavern-plugin/lib/domain/coordination-event-publisher.js'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function until(read, predicate) {
  for (let n = 0; n < 200; n++) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('候选任务未到达预期状态')
}
async function harness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-candidate-tasks-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const persistence = () => createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  let db = persistence()
  const chats = { read: id => db.read(id), write: (chat, meta) => db.write(chat, meta), forSession: id => id === 's' ? db.read('c') : undefined }
  await chats.write({ id: 'c', sessionId: 's', cardPath: 'cards/c.json', mode: 'story', messages: [] })
  const backgroundTasks = { operation: (chat, id) => chat.operations?.[id], activity: () => ({ operationId: 'settle', role: 'settlement', phase: 'running', busy: true, updatedAt: 9 }) }
  function create(generator, extra = {}) {
    return createCandidateTasks({ chats, generator, backgroundTasks,
      sessions: { runtimeGeneration: 'generation', isLive: id => id === 's', projectionRevision: () => 7 },
      prepareLegacy: async () => true, ...extra })
  }
  return { chats, create, restart() { db = persistence() }, seed: createDurableTaskMailbox({ store: { readChat: chats.read, writeChat: chats.write } }) }
}
const request = { sessionId: 's', messageId: 'm', requestId: 'r', guidance: '  提示  ' }

test('纯变量写入通过真实协调快照通知所有页面，未变版本不重复通知', async t => {
  const h = await harness(t)
  const service = h.create({})
  const received = []
  const publisher = createCoordinationEventPublisher({
    load: id => service.sync(id, {kind:'candidate'}),
    publishSignal: (id, signal) => received.push(signal),
    startInterval: () => ({}), stopInterval() {}
  })
  const stop = publisher.watch('s'); t.after(stop)
  await until(() => received.length, count => count === 1)
  const before = await h.chats.read('c')
  before.variables = {gold:12}
  await h.chats.write(before)
  await publisher.publish('s')
  assert.equal(received.length,2,'活动与候选不变时也必须发布变量写入')
  assert.equal(received[1].snapshot.storageRevision,(await h.chats.read('c'))._storageRevision)
  assert.deepEqual(received[1].snapshot.activity,received[0].snapshot.activity)
  await publisher.publish('s')
  assert.equal(received.length,2,'同一个存储版本仍应去重')
})

test('生产提交接口先持久化且不等待生成；并发重复与响应丢失只执行一次', async t => {
  const h = await harness(t), gate = deferred()
  let prepares = 0, executions = 0
  const service = h.create({ async prepare(input) {
    prepares++
    assert.equal(input.guidance, '提示')
    assert.ok(Object.values((await h.chats.read('c')).taskMailbox.tasks).some(task => task.requestId === 'r'))
    return { operationId: 'op', async execute() { executions++; await gate.promise; return { choices: ['结果'] } } }
  } })
  const [one, two] = await Promise.all([service.submit(request), service.submit(request)])
  assert.equal(one.task.taskId, two.task.taskId)
  assert.equal(one.runtimeGeneration, 'generation')
  assert.equal(one.liveSession, true)
  assert.equal(one.projectionRevision, 7)
  assert.equal(one.cardPath, 'cards/c.json')
  assert.equal(one.tasks.background.kind, 'settlement')
  gate.resolve()
  const done = await until(() => service.sync('s', { requestId: 'r' }), v => v.task?.terminal)
  assert.equal(done.task.status, 'succeeded')
  assert.deepEqual(done.tasks.candidate.result, { candidates: { choices: ['结果'] } })
  assert.equal((await service.submit(request)).task.taskId, one.task.taskId)
  assert.equal(prepares, 1); assert.equal(executions, 1)
})

test('生成结果已保存但任务完成回执丢失，恢复直接采用结果，不重跑模型', async t => {
  const h = await harness(t)
  const task = await h.seed.submit('c', { kind: 'candidate', requestId: 'r', input: request })
  await h.seed.transition('c', task.taskId, { status: 'running', operationId: 'op' })
  const chat = await h.chats.read('c')
  chat.candidates = { requestId: 'r', messageId: 'm', operationId: 'op', choices: ['已保存'] }
  await h.chats.write(chat)
  h.restart()
  const service = h.create({ prepare() { assert.fail('不应重新生成') } })
  await service.recover(['c'])
  assert.deepEqual((await service.sync('s', { requestId: 'r' })).task.result.candidates.choices, ['已保存'])
})

test('已有生成操作不会执行第二次，旧结果及空会话投影保持兼容', async t => {
  const h = await harness(t)
  const service = h.create({ async prepare() { return { created: false, operationId: 'op', execute() { assert.fail('不执行已有操作') } } } })
  await service.submit(request)
  await until(() => service.sync('s', { requestId: 'r' }), value => value.task?.operationId === 'op')
  const chat = await h.chats.read('c'); chat.candidates = { requestId: 'old', operationId: 'old-op', messageId: 'm', generatedAt: 3 }
  delete chat.taskMailbox
  await h.chats.write(chat)
  const legacy = await service.sync('s', { kind: 'candidate' })
  assert.equal(legacy.task.taskId, 'legacy-old-op')
  assert.equal(legacy.task.status, 'succeeded')
  assert.deepEqual((await service.sync('absent')).tasks, { candidate: null, background: null })
  await assert.rejects(service.submit({ ...request, sessionId: 'absent' }), /没有绑定人物卡/)
})

test('旧RPC保留准备中、operationId和basedOn响应，后台执行与新接口由同一模块持有', async t => {
  const h = await harness(t), done = deferred()
  let ready = false, calls = 0
  const service = h.create({ async prepare() { calls++; return { operationId: 'legacy-op', basedOn: { revision: 3 }, async execute() { done.resolve() } } } }, { prepareLegacy: async () => ready })
  assert.deepEqual(await service.startLegacy(request), { preparing: true })
  assert.equal(calls, 0)
  ready = true
  assert.deepEqual(await service.startLegacy(request), { operationId: 'legacy-op', basedOn: { revision: 3 } })
  await done.promise
  assert.equal(calls, 1)
})
