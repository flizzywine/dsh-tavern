import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCandidateTasks } from '../tavern-plugin/lib/domain/candidate-tasks.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createDurableTaskMailbox } from '../tavern-plugin/lib/domain/durable-task-mailbox.js'

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

// the stage's 停止 on the choices wait chip.
test('玩家停止候选：立即取消；准备中的任务不再启动模型，运行中的迟到结果不改写取消', async t => {
  const h = await harness(t), waiting = deferred(), finish = deferred()
  let executions = 0
  const recovered = []
  const service = h.create({ async prepare(input) {
    if (input.requestId === 'waiting') await waiting.promise
    return { operationId: 'op-' + input.requestId, created: true, async execute() { executions++; await finish.promise; return { choices: ['迟到'] } } }
  } }, { backgroundTasks: { operation: () => null, activity: () => ({ operationId: '', phase: 'idle' }), recover: async (chat, options) => { recovered.push(options.operationId) } } })
  const preparing = (await service.submit({ ...request, requestId: 'waiting' })).task
  const stopped = await service.cancel({ sessionId: 's', taskId: preparing.taskId })
  assert.equal(stopped.sync.task.status, 'cancelled')
  assert.equal(stopped.operationId, '')
  waiting.resolve()
  await until(() => recovered.length, count => count === 1)
  assert.deepEqual(recovered, ['op-waiting'], 'an operation begun after the stop is closed, not run')
  assert.equal(executions, 0)
  const running = (await service.submit({ ...request, requestId: 'running' })).task
  await until(() => executions, count => count === 1)
  const late = await service.cancel({ sessionId: 's', taskId: running.taskId })
  assert.equal(late.operationId, 'op-running')
  finish.resolve()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal((await service.sync('s', { taskId: running.taskId })).task.status, 'cancelled')
  const again = await service.cancel({ sessionId: 's', taskId: running.taskId })
  assert.equal(again.operationId, '', 'an ended task is left as it is')
})
