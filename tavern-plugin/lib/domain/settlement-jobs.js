/** Own in-memory settlement executions; durable eligibility remains in the timeline. */
export function createSettlementJobs({ run, onSettled }) {
  const jobs = new Map()
  const lifetime = new AbortController()
  let disposed = false

  function start(chatId) {
    if (disposed) return Promise.resolve()
    const existing = jobs.get(chatId)
    if (existing) return existing.promise
    const job = { controller: new AbortController(), promise: null }
    const signal = AbortSignal.any([job.controller.signal, lifetime.signal])
    job.promise = Promise.resolve().then(() => {
      signal.throwIfAborted()
      return run(chatId, signal)
    }).finally(async () => {
      if (jobs.get(chatId) === job) jobs.delete(chatId)
      // Cancellation/deletion must not publish a new wake before their durable
      // stop is saved. Shutdown likewise cannot restart work from finally.
      if (!disposed && !signal.aborted) await onSettled(chatId, signal)
    })
    jobs.set(chatId, job)
    return job.promise
  }

  /** The running job of a chat (settled either way), or null. */
  function pending(chatId) {
    const job = jobs.get(chatId)
    return job ? job.promise.catch(() => {}) : null
  }

  async function cancel(chatId, { wait = true } = {}) {
    const job = jobs.get(chatId)
    if (!job) return false
    job.controller.abort()
    if (!wait) jobs.delete(chatId)
    else await job.promise.catch(() => {})
    return true
  }

  function dispose() {
    disposed = true
    lifetime.abort()
    for (const job of jobs.values()) job.controller.abort()
    jobs.clear()
  }

  return Object.freeze({ start, pending, cancel, dispose })
}
