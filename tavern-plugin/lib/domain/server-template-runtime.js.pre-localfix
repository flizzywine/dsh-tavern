import { fork } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactMvuLoadError } from './mvu-diagnostics.js'

const rpcMethods = new Set(['getFullPromptTemplateState', 'saveFullPromptTemplateState',
  'saveFullPromptTemplateSettings', 'saveFullPromptTemplateGlobals', 'countFullTemplateTokens',
  'getFullTemplateWorldbook', 'replaceFullTemplateWorldbook', 'executeTemplateHostCommand'])
const require = createRequire(import.meta.url)
const worker = fileURLToPath(new URL('./server-template-worker.js', import.meta.url))

/** Service-owned sessions. No browser leases, heartbeat, or replay of started work. */
export function createServerTemplateRuntime({ rpc, store, timeoutMs = 120000, idleMs = 600000, maxSessions = 4, readOnly = false, maxOldSpaceMb, onDiagnostic }) {
  const heapMb = Number(maxOldSpaceMb ?? process.env.DSH_TAVERN_TEMPLATE_HEAP_MB ?? 1024)
  if (!Number.isInteger(heapMb) || heapMb < 128 || heapMb > 4096) throw new RangeError('DSH_TAVERN_TEMPLATE_HEAP_MB 必须是 128 到 4096 之间的整数（MB）')
  const sessions = new Map(), tails = new Map(), generations = new Map(), jobs = new Map()
  const capacityWaiters = new Set()
  const wakeCapacity = () => { for (const wake of capacityWaiters) wake() }
  let disposed = false
  const journalPath = id => 'template-work/' + createHash('sha256').update(id).digest('hex') + '.json'
  const save = (id, job, failure = false) => store && (failure || !job.transient) ? store.writeJson(journalPath(id), job) : Promise.resolve()
  function stop(record, error = new Error('服务端提示词模板执行已停止')) {
    if (sessions.get(record.sessionId) === record) sessions.delete(record.sessionId)
    record.closed = true
    clearTimeout(record.idle)
    for (const item of record.pending.values()) { clearTimeout(item.timer); item.reject(error) }
    record.pending.clear()
    record.child.kill('SIGKILL')
    wakeCapacity()
  }
  function request(record, message) {
    if (record.closed) return Promise.reject(new Error('服务端提示词模板进程已退出'))
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => stop(record, Object.assign(new Error('服务端提示词模板执行超时，已停止执行；已开始的模板不会自动重试'), { code: 'FULL_TEMPLATE_EXECUTION_TIMEOUT' })), timeoutMs)
      record.pending.set(id, { resolve, reject, timer })
      record.child.send({ ...message, id }, error => { if (error) stop(record, error) })
    })
  }
  async function start(sessionId, generation) {
    while (sessions.size >= maxSessions) {
      if (disposed || generation !== generations.get(sessionId)) throw new Error('提示词模板任务已取消')
      const idle = [...sessions.values()].filter(item => !item.busy).sort((a, b) => a.usedAt - b.usedAt)[0]
      if (idle) stop(idle)
      else await new Promise((resolve, reject) => {
        const wake = () => { clearTimeout(timer); capacityWaiters.delete(wake); resolve() }
        const timer = setTimeout(() => { capacityWaiters.delete(wake); reject(new Error('服务端模板执行队列繁忙，等待超时')) }, timeoutMs)
        capacityWaiters.add(wake)
      })
    }
    if (disposed || generation !== generations.get(sessionId)) throw new Error('提示词模板任务已取消')
    // Do not inherit API keys, NODE_OPTIONS or arbitrary launch flags. File access
    // is limited to executable dependencies and plugin code, never profile data.
    const modules = dirname(dirname(require.resolve('jsdom/package.json')))
    const plugin = fileURLToPath(new URL('../../', import.meta.url))
    // Node 24 removed the experimental alias; older hosts still need it.
    const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission'
    const child = fork(worker, [], { env: { NODE_ENV: 'production', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      execArgv: [permissionFlag, '--allow-fs-read=' + plugin, '--allow-fs-read=' + modules, '--max-old-space-size=' + heapMb],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced', windowsHide: true })
    const record = { child, sessionId, pending: new Map(), busy: true, ready: false, closed: false, stderr: '', usedAt: Date.now(), writes: Promise.resolve() }
    sessions.set(sessionId, record)
    child.on('error', error => stop(record, error))
    // Retain only a bounded stderr tail. Wait for stdio to close so V8's fatal
    // message is available; SIGABRT alone does not establish an OOM diagnosis.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { record.stderr = (record.stderr + chunk).slice(-16384) })
    child.on('close', (code, signal) => {
      if (record.closed) return
      const outOfMemory = /FATAL ERROR:[^\r\n]*(?:heap out of memory|Reached heap limit|Ineffective mark-compacts near heap limit)/i.test(record.stderr)
      const diagnostic = { phase: record.ready ? 'execution' : 'initialization', exitCode: code, signal,
        heapMb, outOfMemory, stderr: redactMvuLoadError(record.stderr, 16384).slice(-8192) }
      const message = outOfMemory
        ? `服务端提示词模板内存不足（V8 老生代上限 ${heapMb} MB，${signal || code}），任务未重试`
        : `服务端提示词模板进程退出 (${signal || code})，任务未重试`
      const error = Object.assign(new Error(message), {
        code: outOfMemory ? 'FULL_TEMPLATE_OUT_OF_MEMORY' : 'FULL_TEMPLATE_WORKER_EXIT', workerDiagnostic: diagnostic
      })
      try { onDiagnostic?.(diagnostic) } catch { /* Logging cannot prevent task rejection. */ }
      stop(record, error)
    })
    child.on('message', async message => {
      if (record.closed) return
      if (message.type === 'result') {
        const item = record.pending.get(message.id)
        if (!item) return
        record.pending.delete(message.id); clearTimeout(item.timer)
        message.error ? item.reject(new Error(message.error)) : item.resolve(message.result)
      } else if (message.type === 'rpc') {
        // Bind ownership here, not to the arguments supplied by template code.
        const operation = record.writes.then(async () => {
          if (record.closed || !record.busy || !rpcMethods.has(message.method)) throw new Error('Unsupported or expired template RPC')
          return rpc(message.method, { ...message.args, sessionId })
        })
        record.writes = operation.catch(() => {})
        try {
          const result = await operation
          if (!record.closed) child.send({ type: 'rpc-result', id: message.id, result }, () => {})
        } catch (error) {
          if (!record.closed) child.send({ type: 'rpc-result', id: message.id, error: String(error.message || error) }, () => {})
        }
      }
    })
    record.initialization = request(record, { type: 'initialize', sessionId, readOnly }).then(() => { record.ready = true })
    return record
  }
  async function invoke(sessionId, operation, input, transient = false) {
    if (disposed || !sessionId) throw new Error('服务端提示词模板会话不可用')
    // Match the former JSON transport: host-only callbacks (notably random)
    // stay in the caller; randomSeed/randomRef carry deterministic evaluation.
    input = JSON.parse(JSON.stringify(input))
    const generation = generations.get(sessionId)
    const pending = (tails.get(sessionId) || Promise.resolve()).catch(() => {}).then(async () => {
      if (disposed || generation !== generations.get(sessionId)) throw new Error('提示词模板任务已取消')
      const job = { id: randomUUID(), operation, phase: 'executing', createdAt: Date.now(), transient }
      jobs.set(sessionId, job)
      let record
      try {
        await save(sessionId, job)
        if (disposed || generation !== generations.get(sessionId)) throw new Error('提示词模板任务已取消')
        record = sessions.get(sessionId) || await start(sessionId, generation)
        record.busy = true; clearTimeout(record.idle)
        await record.initialization
        const result = await request(record, operation === 'synchronize' ? { type: 'synchronize' } : { type: 'project', operation, input })
        if (disposed || generation !== generations.get(sessionId)) throw new Error('提示词模板任务已取消')
        job.phase = 'completed'; job.completedAt = Date.now()
        await save(sessionId, job)
        return result
      } catch (error) {
        job.phase = 'interrupted'; job.error = String(error.message || error)
        if (error.workerDiagnostic) job.workerDiagnostic = error.workerDiagnostic
        // Display jobs skip routine journals, but their crashes need evidence too.
        try { await save(sessionId, job, true) }
        finally { if (record) { stop(record, error); await record.writes } }
        throw error
      } finally {
        if (record && !record.closed) {
          record.busy = false; record.usedAt = Date.now()
          record.idle = setTimeout(() => stop(record), idleMs); record.idle.unref?.()
          wakeCapacity()
        }
        jobs.delete(sessionId)
      }
    })
    tails.set(sessionId, pending)
    try { return await pending } finally { if (tails.get(sessionId) === pending) tails.delete(sessionId) }
  }
  return {
    forSession: sessionId => ({
      renderInput: (text, context = {}) => invoke(sessionId, 'input', { text, context }),
      prepareWorldbook: (entries, context = {}) => invoke(sessionId, 'worldbook', { entries, context }),
      command: text => invoke(sessionId, 'command', { text }),
      render: (template, context = {}) => invoke(sessionId, 'render', { template, context }),
      renderProjection: (template, context = {}) => invoke(sessionId, 'render', { template, context }, true),
      renderProjections: (items, context = {}) => invoke(sessionId, 'renderMany', { items, context }, true),
      renderMessages: (messages, context = {}) => invoke(sessionId, 'messages', { messages, context }),
      projectRequest: request => invoke(sessionId, 'request', { request }),
      initializeVariables: (entries, context = {}) => invoke(sessionId, 'initialize', { entries, context })
    }),
    synchronize: sessionId => invoke(sessionId, 'synchronize', {}, true),
    inspect: async sessionId => {
      const record = sessions.get(sessionId)
      return { executor: 'node', heapMb, present: Boolean(record), ready: Boolean(record?.ready), busy: Boolean(record?.busy),
        phase: record?.busy ? 'executing' : 'idle', heartbeat: null, task: jobs.get(sessionId) || (store && await store.readJson(journalPath(sessionId))) || null }
    },
    cancel(sessionId) { generations.set(sessionId, randomUUID()); const record = sessions.get(sessionId); if (record) stop(record, new Error('提示词模板任务已手动取消')); wakeCapacity() },
    dispose() { disposed = true; for (const record of sessions.values()) stop(record); wakeCapacity() }
  }
}
