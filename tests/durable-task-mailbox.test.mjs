import assert from 'node:assert/strict'
import test from 'node:test'

import { createDurableTaskMailbox } from '../tavern-plugin/lib/domain/durable-task-mailbox.js'

function harness() {
  let now = 100
  let chat = { id: 'chat-1', candidates: null }
  const mailbox = createDurableTaskMailbox({
    store: {
      async readChat() { return structuredClone(chat) },
      async writeChat(next) { chat = structuredClone(next) }
    },
    now() { now += 1; return now },
    reconcile(current, task) {
      if (task.kind === 'candidate' && current.candidates && current.candidates.requestId === task.requestId) {
        return { status: 'succeeded', stage: 'completed', result: { candidates: current.candidates } }
      }
      return null
    }
  })
  return { mailbox, read() { return structuredClone(chat) }, write(next) { chat = structuredClone(next) } }
}

test('任务先持久化再返回，同一 requestId 重试只会得到同一任务', async function () {
  const app = harness()
  const first = await app.mailbox.submit('chat-1', {
    requestId: 'request-1', kind: 'candidate', input: { sessionId: 'session-1', messageId: 'message-1', guidance: '' }
  })
  const retried = await app.mailbox.submit('chat-1', {
    requestId: 'request-1', kind: 'candidate', input: { sessionId: 'session-1', messageId: 'message-1', guidance: '' }
  })

  assert.equal(first.taskId, retried.taskId)
  assert.equal(first.status, 'queued')
  assert.equal(app.read().taskMailbox.tasks[first.taskId].requestId, 'request-1')
})

test('后台结果已落盘时，同步会原子修复丢失的完成通知', async function () {
  const app = harness()
  const task = await app.mailbox.submit('chat-1', {
    requestId: 'request-1', kind: 'candidate', input: { sessionId: 'session-1', messageId: 'message-1', guidance: '' }
  })
  await app.mailbox.transition('chat-1', task.taskId, { status: 'running', stage: 'generating' })
  const current = app.read()
  current.candidates = { requestId: 'request-1', messageId: 'message-1', choices: [{ type: 'action', text: '继续前进' }] }
  app.write(current)

  const synced = await app.mailbox.sync('chat-1', { requestId: 'request-1' })

  assert.equal(synced.task.status, 'succeeded')
  assert.equal(synced.task.busy, false)
  assert.equal(synced.task.result.candidates.choices[0].text, '继续前进')
  assert.equal(app.read().taskMailbox.tasks[task.taskId].status, 'succeeded')
})

test('已完成任务的重复读取不会虚假增加文件版本', async function () {
  const app = harness()
  const task = await app.mailbox.submit('chat-1', {
    requestId: 'request-stable', kind: 'candidate', input: { sessionId: 'session-1', messageId: 'message-stable' }
  })
  const current = app.read()
  current.candidates = { requestId: 'request-stable', messageId: 'message-stable', choices: [{ type: 'action', text: '完成' }] }
  app.write(current)

  const first = await app.mailbox.sync('chat-1', { taskId: task.taskId })
  const second = await app.mailbox.sync('chat-1', { taskId: task.taskId })

  assert.equal(second.mailboxVersion, first.mailboxVersion)
  assert.equal(second.task.version, first.task.version)
})

test('服务重启时排队任务可继续，无结果的运行任务明确中断而不永久锁住', async function () {
  const app = harness()
  const queued = await app.mailbox.submit('chat-1', {
    requestId: 'request-queued', kind: 'candidate', input: { sessionId: 'session-1', messageId: 'message-1' }
  })
  const running = await app.mailbox.submit('chat-1', {
    requestId: 'request-running', kind: 'candidate', input: { sessionId: 'session-1', messageId: 'message-2' }
  })
  await app.mailbox.transition('chat-1', running.taskId, { status: 'running', stage: 'generating' })

  const recovered = await app.mailbox.recover('chat-1')

  assert.equal(recovered.tasks.find((item) => item.taskId === queued.taskId).status, 'queued')
  assert.equal(recovered.tasks.find((item) => item.taskId === running.taskId).status, 'interrupted')
  assert.equal(recovered.tasks.find((item) => item.taskId === running.taskId).busy, false)
})
