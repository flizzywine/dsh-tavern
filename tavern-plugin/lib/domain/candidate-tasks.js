import { createDurableTaskMailbox } from './durable-task-mailbox.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Own the candidate command lifecycle; mailbox and generator retain their data rules.
export function createCandidateTasks({ chats, generator, backgroundTasks, sessions, prepareLegacy, now = Date.now }) {
  const { read: readChat, write: writeChat, forSession: chatForSession } = chats
  const candidateGenerator = generator
  const runtimeGeneration = sessions.runtimeGeneration
  const candidateTaskJobs = new Map()
  const taskMailbox = createDurableTaskMailbox({
    store: { readChat, writeChat },
    now,
    reconcile(chat, task) {
      if (task.kind !== 'candidate') return null
      const saved = chat.candidates
      if (saved && str(saved.requestId) === task.requestId && str(saved.messageId) === str(task.input && task.input.messageId)) {
        return { status: 'succeeded', stage: 'completed', operationId: str(saved.operationId), result: { candidates: saved }, error: '' }
      }
      const operationId = str(task.operationId)
      const operation = operationId === '' ? null : backgroundTasks.operation(chat, operationId)
      if (!operation || !operation.terminal || operation.successful) return null
      if (operation.status === 'interrupted') return { status: 'interrupted', stage: 'interrupted', error: '后台重启中断了本次候选生成' }
      if (operation.status === 'failed') return { status: 'failed', stage: 'failed', error: '候选 Agent 生成失败，请查看后台轨迹' }
      return { status: 'stale', stage: 'stale', error: '剧情状态已变化，本次候选已作废' }
    }
  })

  function scheduleCandidateTask(chatId, task) {
    const taskId = str(task && task.taskId)
    if (taskId === '' || candidateTaskJobs.has(taskId) || (task && task.status) !== 'queued') return
    const job = Promise.resolve().then(async function () {
      let operationId = ''
      try {
        await taskMailbox.transition(chatId, taskId, { status: 'running', stage: 'preparing', error: '' })
        const input = task.input || {}
        const prepared = await candidateGenerator.prepare({
          sessionId: input.sessionId,
          messageId: input.messageId,
          guidance: input.guidance,
          requestId: task.requestId,
          async onStage(stage) {
            await taskMailbox.transition(chatId, taskId, { status: 'running', stage, operationId })
          }
        })
        operationId = str(prepared.operationId)
        await taskMailbox.transition(chatId, taskId, { status: 'running', stage: 'generating', operationId })
        if (prepared.created === false) {
          await taskMailbox.sync(chatId, { taskId })
          return
        }
        const candidates = await prepared.execute()
        await taskMailbox.transition(chatId, taskId, { status: 'succeeded', stage: 'completed', operationId, result: { candidates }, error: '' })
      } catch (error) {
        const repaired = await taskMailbox.sync(chatId, { taskId })
        if (repaired.task && repaired.task.status === 'succeeded') return
        const message = str(error && error.message || error)
        const interrupted = /restart|重启|中断|interrupted/i.test(message)
        await taskMailbox.transition(chatId, taskId, {
          status: interrupted ? 'interrupted' : 'failed',
          stage: interrupted ? 'interrupted' : 'failed',
          operationId,
          error: message || '候选生成失败'
        })
      }
    }).finally(function () { candidateTaskJobs.delete(taskId) })
    candidateTaskJobs.set(taskId, job)
  }

  async function sessionSync(sessionId, selector = {}) {
    const chat = await chatForSession(sessionId)
    const liveSession = sessions.isLive(str(sessionId))
    if (chat === undefined) {
      return { runtimeGeneration, liveSession, projectionRevision: 0, activity: null, mailboxVersion: 0, task: null, tasks: { candidate: null, background: null } }
    }
    const synced = await taskMailbox.sync(chat.id, selector)
    let task = synced.task
    if (task === null && str(selector.kind) === 'candidate' && chat.candidates && typeof chat.candidates === 'object') {
      task = {
        taskId: 'legacy-' + str(chat.candidates.operationId || chat.candidates.requestId),
        requestId: str(chat.candidates.requestId), kind: 'candidate', status: 'succeeded', stage: 'completed', busy: false, terminal: true,
        input: { sessionId: str(sessionId), messageId: str(chat.candidates.messageId), guidance: '' },
        operationId: str(chat.candidates.operationId), result: { candidates: chat.candidates }, error: '', version: 0,
        createdAt: Number(chat.candidates.generatedAt) || 0, updatedAt: Number(chat.candidates.generatedAt) || 0
      }
    }
    const activity = backgroundTasks.activity(await readChat(chat.id))
    const backgroundTask = activity.operationId === '' ? null : {
      taskId: activity.operationId,
      requestId: '',
      kind: activity.role || 'background',
      status: activity.phase === 'pending' ? 'queued' : (activity.phase === 'running' ? 'running' : (activity.phase === 'failed' ? 'failed' : 'succeeded')),
      stage: activity.role || activity.phase,
      busy: activity.busy === true,
      terminal: activity.phase !== 'pending' && activity.phase !== 'running',
      input: { basedOn: activity.basedOn || null },
      operationId: activity.operationId,
      result: null,
      error: '',
      version: Number(activity.updatedAt) || 0,
      createdAt: 0,
      updatedAt: Number(activity.updatedAt) || 0
    }
    return {
      runtimeGeneration,
      liveSession,
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      cardPath: str(chat.cardPath),
      cardName: str(chat.cardName),
      projectionRevision: await sessions.projectionRevision(chat.cardPath),
      activity,
      mailboxVersion: synced.mailboxVersion,
      task,
      tasks: { candidate: task, background: backgroundTask }
    }
  }

  async function submitCandidateTask(args = {}) {
    const sessionId = str(args.sessionId)
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    const task = await taskMailbox.submit(chat.id, {
      requestId: args.requestId,
      kind: 'candidate',
      stage: 'queued',
      input: {
        sessionId,
        messageId: str(args.messageId),
        guidance: str(args.guidance).trim().slice(0, 600)
      }
    })
    scheduleCandidateTask(chat.id, task)
    return await sessionSync(sessionId, { requestId: task.requestId, kind: 'candidate' })
  }

  async function startLegacy(args = {}) {
    const choiceChat = await chatForSession(args && args.sessionId)
    if (choiceChat === undefined) throw new Error('当前会话没有绑定人物卡')
    if (!await prepareLegacy(args && args.sessionId)) return { preparing: true }
    const prepared = await candidateGenerator.prepare({
      sessionId: args && args.sessionId,
      messageId: args && args.messageId,
      guidance: args && args.guidance,
      requestId: args && args.requestId
    })
    if (prepared.created !== false) {
      setTimeout(function () {
        void prepared.execute().catch(function () {})
      }, 0)
    }
    return { operationId: prepared.operationId, basedOn: prepared.basedOn }
  }

  async function recover(chatIds) {
    for (const chatId of chatIds) {
      const recovered = await taskMailbox.recover(chatId)
      for (const task of recovered.tasks) {
        if (task.kind === 'candidate' && task.status === 'queued') scheduleCandidateTask(chatId, task)
      }
    }
  }

  return Object.freeze({ submit: submitCandidateTask, sync: sessionSync, recover, startLegacy })
}
