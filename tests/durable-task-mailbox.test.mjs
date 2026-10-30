import { applyJsonChanges } from '../tavern-plugin/lib/domain/json-mutation.js'
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

test('read-only polling avoids full reads; repair rechecks a writable snapshot', async () => {
  let chat = { id: 'c', messages: [{ text: 'preserve history' }], taskMailbox: { version: 1, latestByKind: { candidate: 't' }, tasks: {
    t: { taskId: 't', kind: 'candidate', status: 'running', requestId: 'r', input: {} }
  } } }
  let fullReads = 0, writes = 0, repair = false
  const mailbox = createDurableTaskMailbox({
    store: {
      readState: async () => structuredClone({ id: chat.id, taskMailbox: chat.taskMailbox }),
      readChat: async () => { fullReads++; return structuredClone(chat) },
      writeChat: async value => { writes++; chat = structuredClone(value); return value }
    },
    reconcile: () => repair ? { status: 'succeeded', stage: 'completed' } : null
  })
  for (let i = 0; i < 20; i++) assert.equal((await mailbox.sync('c', { taskId: 't' })).task.status, 'running')
  assert.equal(fullReads, 0)
  repair = true
  assert.equal((await mailbox.sync('c', { taskId: 't' })).task.status, 'succeeded')
  assert.equal(fullReads, 1); assert.equal(writes, 1)
  assert.equal(chat.messages[0].text, 'preserve history')
  await mailbox.sync('c', { taskId: 't' }); await mailbox.recover('c')
  assert.equal(fullReads, 1); assert.equal(writes, 1)
})

test('mailbox scoped writes retry revision conflicts without reading or overwriting story data', async () => {
  let chat = { id: 'c', _storageRevision: 1, story: 'original' }, conflict = true
  const mailbox = createDurableTaskMailbox({ store: {
    readChat() { throw new Error('full read forbidden') },
    writeChat() { throw new Error('full write forbidden') },
    async readState() { const { story, ...state } = chat; return structuredClone(state) },
    async patchChat(id, revision, changes) {
      if (conflict) { conflict = false; chat.story = 'concurrent'; chat._storageRevision++; return undefined }
      assert.equal(revision, chat._storageRevision)
      assert.ok(changes.every(change=>change.path[0]==='taskMailbox'))
      if(chat.taskMailbox) assert.ok(changes.every(change=>change.path.length>1),'do not replace existing mailbox')
      chat = applyJsonChanges(chat,changes); chat._storageRevision++
      const { story, ...state } = chat; return structuredClone(state)
    }
  } })
  const task = await mailbox.submit('c', { kind: 'candidate', requestId: 'r' })
  await mailbox.transition('c', task.taskId, {status:'running',stage:'generating'})
  await mailbox.transition('c', task.taskId, {status:'succeeded',result:{choices:[]}})
  assert.equal((await mailbox.sync('c',{requestId:'r'})).task.status,'succeeded')
  assert.equal(chat.story,'concurrent')
})

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
