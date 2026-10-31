// Optional presentation observes cumulative reply text. Initialization and asynchronous
// updates never block the provider; slow observers receive the latest snapshot in order.
export function createReplyStreamObserver({begin, signal, warn = () => {}}) {
  const lifetime = new AbortController()
  let observer, text = '', revision = 0, delivered = 0, busy = false
  let closed = false, cancelled = false, released = false
  const report = error => { try { warn(error) } catch {} }
  function release() {
    if (!observer || released) return
    released = true
    try { Promise.resolve(observer.cancel?.()).catch(report) } catch (error) { report(error) }
  }
  function cancel() {
    lifetime.abort()
    cancelled = true
    closed = true
    signal?.removeEventListener('abort', cancel)
    release()
  }
  function fail(error) { report(error); cancel() }
  function flush() {
    if (!observer || busy || cancelled || delivered === revision) return
    busy = true
    delivered = revision
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
    else flush()
  }).catch(fail)
  return {ready,
    append(delta) {
      if (closed) return
      text += delta
      revision++
      flush()
    },
    finish(completed) {
      closed = true
      lifetime.abort()
      signal?.removeEventListener('abort', cancel)
      if (!completed) cancel()
      // A successful request leaves admitted presentation work running. Pending
      // snapshots still drain; the owner controls that work's longer lifetime.
    },
    cancel}
}
