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

test('startup recovery interrupts only tasks an earlier process left running', async () => {
  // History recovery runs after the service is ready; a task begun since startup is live work of this process.
  let chat = { id: 'c', taskMailbox: { version: 1, latestByKind: { candidate: 'fresh' }, tasks: {
    old: { taskId: 'old', kind: 'candidate', status: 'running', requestId: 'r1', input: {}, createdAt: 100 },
    fresh: { taskId: 'fresh', kind: 'candidate', status: 'running', requestId: 'r2', input: {}, createdAt: 300 }
  } } }
  const mailbox = createDurableTaskMailbox({
    store: {
      readState: async () => structuredClone(chat),
      readChat: async () => structuredClone(chat),
      writeChat: async value => { chat = structuredClone(value); return value }
    },
    reconcile: () => null
  })
  await mailbox.recover('c', { startedBefore: 200 })
  assert.equal(chat.taskMailbox.tasks.old.status, 'interrupted')
  assert.equal(chat.taskMailbox.tasks.fresh.status, 'running')
})
