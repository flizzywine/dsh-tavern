import { randomUUID } from 'node:crypto'

/** Helper generations are independent, cancellable tasks scoped to one chat. */
export function createHelperGenerationTasks({ now = Date.now, cancellationLifetime = 5 * 60 * 1000, cancellationLimit = 1024 } = {}) {
  const sessions = new Map()
  const cancellations = new Map()
  const cancellationKey = (session, id, token) => JSON.stringify([session, id, token])
  function cancelled(id) { const error = new Error('生成已停止：' + id); error.name = 'AbortError'; return error }
  function validToken(token) { return typeof token === 'string' && token.length > 0 && token.length <= 256 }
  function prune() {
    for (const [key, deadline] of cancellations) if (deadline <= now()) cancellations.delete(key)
    while (cancellations.size > cancellationLimit) cancellations.delete(cancellations.keys().next().value)
  }
  async function run(sessionId, generationId, operation, generationToken) {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('生成需要 sessionId')
    if (generationId !== undefined && (typeof generationId !== 'string' || !generationId.trim())) throw new Error('generation_id 必须是非空字符串')
    if (generationToken !== undefined && !validToken(generationToken)) throw new Error('generationToken 必须是非空短字符串')
    const id = generationId || randomUUID()
    prune()
    if (generationToken && cancellations.has(cancellationKey(sessionId, id, generationToken))) throw cancelled(id)
    let tasks = sessions.get(sessionId)
    if (!tasks) sessions.set(sessionId, tasks = new Map())
    if (tasks.has(id)) throw new Error('生成 ID 正在使用：' + id)
    const controller = new AbortController()
    const task = { controller, generationToken }
    tasks.set(id, task)
    let onAbort
    const cancellation = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([cancellation, Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return operation(controller.signal, id)
      })])
    } finally {
      controller.signal.removeEventListener('abort', onAbort)
      if (tasks.get(id) === task) tasks.delete(id)
      if (!tasks.size && sessions.get(sessionId) === tasks) sessions.delete(sessionId)
    }
  }
  function stop(sessionId, id, { generationToken, pending = false } = {}) {
    prune()
    const remember = pending === true && typeof sessionId === 'string' && sessionId && typeof id === 'string' && id && validToken(generationToken)
    if (remember) {
      cancellations.set(cancellationKey(sessionId, id, generationToken), now() + cancellationLifetime)
      prune()
    }
    const tasks = sessions.get(sessionId), task = tasks?.get(id)
    if (!task || generationToken !== undefined && task.generationToken !== generationToken) return Boolean(remember)
    task.controller.abort(cancelled(id))
    tasks.delete(id)
    if (!tasks.size) sessions.delete(sessionId)
    return true
  }
  function stopAll(sessionId, pendingGenerations = []) {
    if (!Array.isArray(pendingGenerations) || pendingGenerations.length > 1024) throw new Error('pendingGenerations 必须是有界数组')
    const ids = [...sessions.get(sessionId)?.keys() || []]
    for (const id of ids) stop(sessionId, id)
    for (const pending of pendingGenerations) if (pending && stop(sessionId, pending.generationId, { generationToken: pending.generationToken, pending: true })) ids.push(pending.generationId)
    return [...new Set(ids)]
  }
  function dispose() { for (const id of [...sessions.keys()]) stopAll(id); cancellations.clear() }
  return { run, stop, stopAll, dispose }
}
