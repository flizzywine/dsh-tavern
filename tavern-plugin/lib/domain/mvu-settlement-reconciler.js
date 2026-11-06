function required(options, name) {
  if (typeof options[name] !== 'function') throw new Error('MVU Settlement Reconciler 缺少 ' + name)
  return options[name]
}

/** Durable state decides eligibility; notifications only request a fresh check. */
export function createMvuSettlementReconciler(options = {}) {
  const list = required(options, 'list')
  const resolve = required(options, 'resolve')
  const shouldResume = required(options, 'shouldResume')
  const isReady = required(options, 'isReady')
  const resume = required(options, 'resume')
  const schedule = options.schedule || setTimeout
  const cancel = options.cancel || clearTimeout
  const onError = options.onError || function () {}
  const retryDelayMs = Math.max(10, Number(options.retryDelayMs) || 1000)
  const entries = new Map()
  const scanKey = Symbol('startup-scan')
  let disposed = false

  function current(key, entry) {
    return !disposed && entries.get(key) === entry && !entry.controller.signal.aborted
  }

  function arm(key, entry) {
    if (!current(key, entry) || entry.timer) return
    const timer = { handle: null }
    entry.timer = timer
    timer.handle = schedule(async () => {
      // A cancelled callback may already be queued by the host event loop.
      if (!current(key, entry) || entry.timer !== timer) return
      entry.timer = null
      return start(key, entry.work)
    }, retryDelayMs)
    timer.handle?.unref?.()
  }

  function start(key, work) {
    if (disposed) return Promise.resolve(false)
    let entry = entries.get(key)
    if (entry?.promise) {
      entry.dirty = true
      return entry.promise
    }
    if (!entry) {
      entry = { controller: new AbortController(), promise: null, timer: null, dirty: false, work }
      entries.set(key, entry)
    }
    if (entry.timer) {
      cancel(entry.timer.handle)
      entry.timer = null
    }
    entry.dirty = false
    const alive = () => current(key, entry)
    const signal = entry.controller.signal
    // Publish the promise before entering injected adapters (including sync ones).
    entry.promise = Promise.resolve().then(() => alive() ? work({ alive, signal, retry() { entry.dirty = true } }) : false)
      .catch(error => {
        if (alive()) {
          entry.dirty = true
          try { onError(error, key === scanKey ? '' : key) } catch {}
        }
        return false
      }).finally(() => {
        entry.promise = null
        if (!alive()) return
        if (entry.dirty) arm(key, entry)
        else entries.delete(key)
      })
    return entry.promise
  }

  function wake(sessionId) {
    const id = String(sessionId || '')
    if (!id) return Promise.resolve(false)
    return start(id, async ({ alive, signal, retry }) => {
      const chat = await resolve(id, { signal })
      if (!alive() || !chat || !shouldResume(chat)) return false
      if (!isReady(id, chat)) { retry(); return false }
      if (!alive()) return false
      await resume(chat.id, { signal })
      if (!alive()) return false
      const latest = await resolve(id, { signal })
      if (!alive()) return false
      if (latest && shouldResume(latest)) retry()
      return true
    })
  }

  function scan() {
    return start(scanKey, async ({ alive, signal }) => {
      const rows = await list({ signal })
      if (!alive()) return false
      await Promise.all(rows.map(row => wake(row.sessionId)))
      return alive()
    })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const entry of entries.values()) {
      if (entry.timer) cancel(entry.timer.handle)
      entry.controller.abort()
    }
    entries.clear()
  }

  return Object.freeze({ wake, scan, dispose })
}
