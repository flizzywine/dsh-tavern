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

test('同步从同一份已协调快照投影活动，无需再次读取聊天', async () => {
  let reads = 0
  let chat = { id: 'one' }
  const mailbox = createDurableTaskMailbox({
    store: {
      async readChat() { reads++; return structuredClone(chat) },
      async writeChat(next) { chat = structuredClone(next); return { ...chat, activity: 'saved' } }
    },
    reconcile() { return { status: 'succeeded', stage: 'completed' } }
  })
  await mailbox.submit('one', { requestId: 'r', kind: 'candidate', input: {} })
  reads = 0
  const result = await mailbox.sync('one', { requestId: 'r' }, current => current.activity)
  assert.equal(reads, 1)
  assert.equal(result.task.status, 'succeeded')
  assert.equal(result.projection, 'saved')
})

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

test('durable completion is readable while a mailbox write is blocked', async () => {
 let unblock,started
 const entered=new Promise(resolve=>started=resolve), blocked=new Promise(resolve=>unblock=resolve)
 const state={id:'c',_storageRevision:1,taskMailbox:{version:1,tasks:{t:{taskId:'t',requestId:'r',kind:'candidate',status:'queued',version:1}},latestByKind:{candidate:'t'}}}
 const mailbox=createDurableTaskMailbox({projectReconciledState:true,store:{async readChat(){return structuredClone(state)},async readState(){return structuredClone(state)},async writeChat(){started();await blocked}},reconcile:chat=>chat.candidates?{status:'succeeded',result:chat.candidates}:null})
 const writing=mailbox.transition('c','t',{status:'running'})
 await entered
 state.candidates={choices:['persisted']}
 try {
  const result=await Promise.race([mailbox.sync('c',{kind:'candidate'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('waited for mailbox writer')),200))])
  assert.equal(result.task.status,'succeeded')
 } finally {unblock();await writing}
})

test('任务表被存成数组时，新任务仍能写入并查到', async () => {
  let chat = { id: 'c', _storageRevision: 1, taskMailbox: { version: 3, latestByKind: { settle: 'old' }, tasks: [{ taskId: 'old', requestId: 'old-r', kind: 'settle', status: 'succeeded', createdAt: 1 }] } }
  const mailbox = createDurableTaskMailbox({ store: {
    readChat() { throw new Error('full read forbidden') },
    writeChat() { throw new Error('full write forbidden') },
    async readState() { return structuredClone(chat) },
    async patchChat(id, revision, changes) { chat = applyJsonChanges(chat, changes); chat._storageRevision++; return structuredClone(chat) }
  } })
  const task = await mailbox.submit('c', { kind: 'candidate', requestId: 'r' })
  assert.equal(Array.isArray(chat.taskMailbox.tasks), false)
  assert.equal(chat.taskMailbox.tasks[task.taskId].requestId, 'r')
  assert.equal(chat.taskMailbox.tasks.old.status, 'succeeded')
  assert.equal((await mailbox.sync('c', { requestId: 'r' })).task.taskId, task.taskId)
})
