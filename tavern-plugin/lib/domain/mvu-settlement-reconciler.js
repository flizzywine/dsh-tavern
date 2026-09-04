function required(options, name) {
  if (typeof options[name] !== 'function') throw new Error('MVU Settlement Reconciler 缺少 ' + name)
  return options[name]
}

/**
 * Reconciles durable pending MVU submissions with the browser runtime.
 * Signals are hints: every attempt re-reads authoritative chat state.
 */
export function createMvuSettlementReconciler(options = {}) {
  const list = required(options, 'list')
  const resolve = required(options, 'resolve')
  const shouldResume = required(options, 'shouldResume')
  const isReady = required(options, 'isReady')
  const resume = required(options, 'resume')
  const schedule = typeof options.schedule === 'function' ? options.schedule : setTimeout
  const cancel = typeof options.cancel === 'function' ? options.cancel : clearTimeout
  const onError = typeof options.onError === 'function' ? options.onError : function () {}
  const retryDelayMs = Math.max(10, Number(options.retryDelayMs) || 1000)
  const inFlight = new Map()
  const retries = new Map()
  let disposed = false

  function retry(key, callback, error) {
    if (disposed || retries.has(key)) return
    try { onError(error, key === '@scan' ? '' : key) } catch {}
    const timer = schedule(async function () {
      retries.delete(key)
      if (!disposed) await callback()
    }, retryDelayMs)
    retries.set(key, timer)
  }

  async function attempt(sessionId) {
    if (disposed) return false
    try {
      const chat = await resolve(sessionId)
      if (!chat || !shouldResume(chat) || !isReady(sessionId)) return false
      await resume(chat.id)
      return true
    } catch (error) {
      retry(sessionId, () => wake(sessionId), error)
      return false
    }
  }

  function wake(sessionId) {
    const id = String(sessionId || '')
    if (disposed || id === '') return Promise.resolve(false)
    if (inFlight.has(id)) return inFlight.get(id)
    const running = attempt(id).finally(function () { inFlight.delete(id) })
    inFlight.set(id, running)
    return running
  }

  async function scan() {
    if (disposed) return
    try {
      const rows = await list()
      await Promise.all(rows.map(row => wake(row.sessionId)))
    } catch (error) {
      retry('@scan', scan, error)
    }
  }

  function dispose() {
    disposed = true
    for (const timer of retries.values()) cancel(timer)
    retries.clear()
  }

  return Object.freeze({ wake, scan, dispose })
}
