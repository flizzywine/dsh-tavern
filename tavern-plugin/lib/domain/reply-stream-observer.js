// Optional presentation observes cumulative reply text. Initialization and asynchronous
// updates never block the provider; slow observers receive the latest snapshot in order.
export function createReplyStreamObserver({begin, signal, warn = () => {}, minIntervalMs = 80}) {
  const lifetime = new AbortController()
  let observer, text = '', revision = 0, delivered = 0, busy = false
  // final: the reply stopped on its own; the observer's finish() follows its last snapshot.
  let closed = false, cancelled = false, released = false, final = false
  let lastFlushedAt = 0, timer = null
  const clearTimer = () => {
    if (timer !== null) { clearTimeout(timer); timer = null }
  }
  const report = error => { try { warn(error) } catch {} }
  function release() {
    if (!observer || released) return
    released = true
    try { Promise.resolve(observer.cancel?.()).catch(report) } catch (error) { report(error) }
  }
  function cancel() {
    clearTimer()
    lifetime.abort()
    cancelled = true
    closed = true
    signal?.removeEventListener('abort', cancel)
    release()
  }
  function fail(error) { report(error); cancel() }
  function flush(immediate = false) {
    if (!observer || busy || cancelled) return
    if (delivered === revision) {
      clearTimer()
      if (final) {
        final = false
        try { Promise.resolve(observer.finish?.()).catch(report) } catch (error) { report(error) }
      }
      return
    }
    if (!immediate && !final && !closed && minIntervalMs > 0 && lastFlushedAt > 0) {
      const remaining = minIntervalMs - (Date.now() - lastFlushedAt)
      if (remaining > 0) {
        if (timer === null) {
          timer = setTimeout(() => { timer = null; flush(true) }, remaining)
          if (typeof timer.unref === 'function') timer.unref()
        }
        return
      }
    }
    clearTimer()
    busy = true
    delivered = revision
    lastFlushedAt = Date.now()
    try {
      Promise.resolve(observer.update(text)).then(() => {
        busy = false
        flush()
      }, fail)
    } catch (error) { fail(error) }
  }
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, {once:true})
  const ready = Promise.resolve().then(() => cancelled ? null : begin?.(lifetime.signal)).then(value => {
    observer = value
    // A late initializer must not resurrect a finished or cancelled request.
    if (closed) release()
    else flush(true)
  }).catch(fail)
  return {ready,
    append(delta) {
      if (closed) return
      text += delta
      revision++
      flush()
    },
    finish(completed, stopped = false) {
      closed = true
      clearTimer()
      lifetime.abort()
      signal?.removeEventListener('abort', cancel)
      if (!completed) cancel()
      else if (stopped) { final = true; flush(true) }
      // A successful request leaves admitted presentation work running. Pending
      // snapshots still drain; the owner controls that work's longer lifetime.
    },
    cancel}
}
