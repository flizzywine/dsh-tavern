import { diffJson } from './json-mutation.js'
import { copyJsonTree } from './copy-json-tree.js'
import { taskStateFields } from './task-state-reader.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

const TERMINAL = new Set(['succeeded', 'failed', 'interrupted', 'stale', 'cancelled'])
const VALID = new Set(['queued', 'running', ...TERMINAL])

function mailboxOf(chat) {
  const source = chat && chat.taskMailbox
  if (source && typeof source === 'object' && Array.isArray(source.tasks)) {
    // Tasks are keyed by taskId; an array (written by an outside patch) would silently drop new tasks on diff.
    const tasks = {}
    for (const task of source.tasks) if (task && typeof task === 'object' && str(task.taskId)) tasks[str(task.taskId)] = task
    source.tasks = tasks
  }
  if (source && typeof source === 'object' && source.tasks && typeof source.tasks === 'object') {
    if (!source.latestByKind || typeof source.latestByKind !== 'object') source.latestByKind = {}
    if (!Number.isSafeInteger(source.version) || source.version < 0) source.version = 0
    return source
  }
  const mailbox = { version: 0, tasks: {}, latestByKind: {} }
  chat.taskMailbox = mailbox
  return mailbox
}

function publicTask(task) {
  if (!task || typeof task !== 'object') return null
  return {
    taskId: str(task.taskId),
    requestId: str(task.requestId),
    kind: str(task.kind),
    status: str(task.status),
    stage: str(task.stage),
    busy: !TERMINAL.has(str(task.status)),
    terminal: TERMINAL.has(str(task.status)),
    input: task.input && typeof task.input === 'object' ? task.input : {},
    operationId: str(task.operationId),
    result: task.result === undefined ? null : task.result,
    error: str(task.error),
    version: Number(task.version) || 0,
    createdAt: Number(task.createdAt) || 0,
    updatedAt: Number(task.updatedAt) || 0
  }
}

function sameValue(left, right) {
  if (left === right) return true
  if ((left === null || typeof left !== 'object') || (right === null || typeof right !== 'object')) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Persistent command/result mailbox. HTTP and browser state are projections of this file-backed record. */
export function createDurableTaskMailbox(options = {}) {
  const store = options.store
  const now = typeof options.now === 'function' ? options.now : Date.now
  const reconcile = typeof options.reconcile === 'function' ? options.reconcile : function () { return null }
  const mutationTails = new Map()
  let sequence = 0
  if (!store || typeof store.readChat !== 'function' || typeof store.writeChat !== 'function') {
    throw new Error('Durable Task Mailbox 缺少存储 adapter')
  }

  const scoped = typeof store.readState === 'function' && typeof store.patchChat === 'function'
  const retryWrite = Symbol('mailbox revision conflict')
  const baselines = new WeakMap()
  const readWritable = async id => {
    const chat=await (scoped ? store.readState(id) : store.readChat(id))
    if(scoped && chat) baselines.set(chat,copyJsonTree(chat.taskMailbox))
    return chat
  }
  async function saveMailbox(chat, metadata) {
    if (!scoped) return store.writeChat(chat, metadata)
    const saved = await store.patchChat(chat.id, chat._storageRevision,
      diffJson(baselines.get(chat) === undefined ? {} : {taskMailbox:baselines.get(chat)}, {taskMailbox:chat.taskMailbox}),
      { ...metadata, returnProjection: taskStateFields })
    if (!saved) throw retryWrite
    return saved
  }

  function serialize(chatId, work) {
    const id = str(chatId)
    const previous = mutationTails.get(id) || Promise.resolve()
    const current = previous.catch(function () {}).then(async function () {
      for (let attempt = 0; attempt < 8; attempt++) {
        try { return await work() }
        catch (error) { if (error !== retryWrite) throw error }
      }
      throw new Error('候选任务状态持续被并发修改，请重试')
    })
    mutationTails.set(id, current)
    return current.finally(function () {
      if (mutationTails.get(id) === current) mutationTails.delete(id)
    })
  }

  function findTask(mailbox, selector = {}) {
    const taskId = str(selector.taskId)
    if (taskId !== '') return mailbox.tasks[taskId] || null
    const requestId = str(selector.requestId)
    if (requestId !== '') {
      return Object.values(mailbox.tasks).find(function (task) { return str(task && task.requestId) === requestId }) || null
    }
    const kind = str(selector.kind)
    const latestId = str(mailbox.latestByKind[kind])
    return latestId === '' ? null : (mailbox.tasks[latestId] || null)
  }

  function applyPatch(mailbox, task, patch) {
    const status = patch.status === undefined ? str(task.status) : str(patch.status)
    if (!VALID.has(status)) throw new Error('未知任务状态: ' + status)
    if (TERMINAL.has(str(task.status)) && status !== str(task.status)) return false
    const changed = status !== str(task.status) ||
      (patch.stage !== undefined && str(patch.stage) !== str(task.stage)) ||
      (patch.operationId !== undefined && str(patch.operationId) !== str(task.operationId)) ||
      (patch.result !== undefined && !sameValue(patch.result, task.result)) ||
      (patch.error !== undefined && str(patch.error) !== str(task.error))
    if (!changed) return false
    task.status = status
    if (patch.stage !== undefined) task.stage = str(patch.stage)
    if (patch.operationId !== undefined) task.operationId = str(patch.operationId)
    if (patch.result !== undefined) task.result = patch.result
    if (patch.error !== undefined) task.error = str(patch.error)
    task.updatedAt = now()
    mailbox.version += 1
    task.version = mailbox.version
    return true
  }

  async function submit(chatId, input = {}) {
    return await serialize(chatId, async function () {
      const chat = await readWritable(chatId)
      if (!chat) throw new Error('聊天不存在: ' + chatId)
      const mailbox = mailboxOf(chat)
      const requestId = str(input.requestId).trim().slice(0, 160)
      const kind = str(input.kind).trim()
      if (requestId === '') throw new Error('持久任务缺少 requestId')
      if (kind === '') throw new Error('持久任务缺少 kind')
      const existing = findTask(mailbox, { requestId })
      if (existing) {
        if (str(existing.kind) !== kind) throw new Error('同一 requestId 对应了不同任务类型')
        return publicTask(existing)
      }
      sequence += 1
      const timestamp = now()
      const taskId = 'task-' + timestamp.toString(36) + '-' + sequence.toString(36)
      mailbox.version += 1
      const task = {
        taskId,
        requestId,
        kind,
        status: input.startImmediately === true ? 'running' : 'queued',
        stage: str(input.stage) || (input.startImmediately === true ? 'preparing' : 'queued'),
        input: input.input && typeof input.input === 'object' ? input.input : {},
        operationId: '',
        result: null,
        error: '',
        version: mailbox.version,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      mailbox.tasks[taskId] = task
      mailbox.latestByKind[kind] = taskId
      const ids = Object.keys(mailbox.tasks).sort(function (left, right) {
        return (Number(mailbox.tasks[right].createdAt) || 0) - (Number(mailbox.tasks[left].createdAt) || 0)
      })
      for (const oldId of ids.slice(30)) delete mailbox.tasks[oldId]
      await saveMailbox(chat, { source: kind + '.mailbox.' + (input.startImmediately === true ? 'preparing' : 'queued'), requestId })
      return publicTask(task)
    })
  }

  async function transition(chatId, taskId, patch = {}) {
    return await serialize(chatId, async function () {
      const chat = await readWritable(chatId)
      if (!chat) throw new Error('聊天不存在: ' + chatId)
      const mailbox = mailboxOf(chat)
      const task = findTask(mailbox, { taskId })
      if (!task) throw new Error('持久任务不存在: ' + taskId)
      if (applyPatch(mailbox, task, patch)) await saveMailbox(chat, { source: str(task.kind) + '.mailbox.' + (str(patch.stage) || str(patch.status) || 'transition'), requestId: str(task.requestId), operationId: str(patch.operationId || task.operationId) })
      return publicTask(task)
    })
  }

  async function sync(chatId, selector = {}, project) {
    // A durable candidate result is sufficient even while its bookkeeping
    // transition holds the mailbox writer queue.
    if (options.projectReconciledState === true && store.readState) {
      const state = await store.readState(chatId)
      if (state) {
        const mailbox = mailboxOf(state), task = findTask(mailbox, selector)
        const repair = task ? await reconcile(state, publicTask(task)) : null
        if (repair) {
          const projected = structuredClone(mailbox), projectedTask = findTask(projected, selector)
          applyPatch(projected, projectedTask, repair)
          return { mailboxVersion: projected.version, task: publicTask(projectedTask), ...(project ? { projection: project(state) } : {}) }
        }
      }
    }
    return await serialize(chatId, async function () {
      // Inspect a detached projection first. Only a repair may acquire a writable Chat.
      if (store.readState) {
        const state = await store.readState(chatId)
        if (!state) return { mailboxVersion: 0, task: null, ...(project ? { projection: project(state) } : {}) }
        const mailbox = mailboxOf(state), task = findTask(mailbox, selector)
        const repair = task ? await reconcile(state, publicTask(task)) : null
        if (!task || !repair || !applyPatch(structuredClone(mailbox), structuredClone(task), repair)) {
          return { mailboxVersion: mailbox.version, task: publicTask(task), ...(project ? { projection: project(state) } : {}) }
        }
        // The caller may derive completion from another already-durable result.
        // Publishing that projection need not wait for a redundant mailbox write.
        if (options.projectReconciledState === true) {
          const projected = structuredClone(mailbox)
          const projectedTask = findTask(projected, selector)
          applyPatch(projected, projectedTask, repair)
          return { mailboxVersion: projected.version, task: publicTask(projectedTask), ...(project ? { projection: project(state) } : {}) }
        }
        // Re-read and reconcile below: a concurrent write may have changed the task.
      }
      let chat = await readWritable(chatId)
      const result = (mailboxVersion, task) => ({ mailboxVersion, task, ...(project ? { projection: project(chat) } : {}) })
      if (!chat) return result(0, null)
      const mailbox = mailboxOf(chat)
      const task = findTask(mailbox, selector)
      if (!task) return result(mailbox.version, null)
      const repair = await reconcile(chat, publicTask(task))
      if (repair && typeof repair === 'object' && applyPatch(mailbox, task, repair)) {
        const saved = await saveMailbox(chat, { source: str(task.kind) + '.mailbox.reconcile', requestId: str(task.requestId), operationId: str(task.operationId) })
        if (saved?.id === chat.id) chat = saved
      }
      return result(mailboxOf(chat).version, publicTask(findTask(mailboxOf(chat), selector)))
    })
  }

  async function recover(chatId) {
    return await serialize(chatId, async function () {
      if (store.readState) {
        const state = await store.readState(chatId)
        if (!state) return { mailboxVersion: 0, tasks: [] }
        const mailbox = mailboxOf(state)
        if (!Object.values(mailbox.tasks).some(task => task?.status === 'running')) {
          return { mailboxVersion: mailbox.version, tasks: Object.values(mailbox.tasks).map(publicTask) }
        }
      }
      const chat = await readWritable(chatId)
      if (!chat) return { mailboxVersion: 0, tasks: [] }
      const mailbox = mailboxOf(chat)
      let changed = false
      for (const task of Object.values(mailbox.tasks)) {
        if (!task || str(task.status) !== 'running') continue
        const repair = await reconcile(chat, publicTask(task))
        changed = applyPatch(mailbox, task, repair && typeof repair === 'object' ? repair : {
          status: 'interrupted', stage: 'interrupted', error: '服务重启中断了本次后台任务'
        }) || changed
      }
      if (changed) await saveMailbox(chat, { source: 'mailbox.recover' })
      return { mailboxVersion: mailbox.version, tasks: Object.values(mailbox.tasks).map(publicTask) }
    })
  }

  function startInChat(chat, taskId, operationId) {
    const mailbox=mailboxOf(chat),task=mailbox.tasks[taskId]
    if (!task || task.status !== 'running' || task.stage !== 'preparing') throw new Error('候选任务已过期，不能开始执行')
    applyPatch(mailbox,task,{status:'running',stage:'generating',operationId})
    return true
  }
  return Object.freeze({ submit, transition, sync, recover, startInChat })
}
