/** Browser transport only. A write is never replayed after an ambiguous network failure. */
export function createJsonTransport({ fetchImpl = (...args) => globalThis.fetch(...args), onRetry } = {}) {
  async function once(url, init) {
    const response = await fetchImpl(url, init)
    let data = null
    try { data = await response.json() } catch {}
    if (!response.ok || data?.ok === false) throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), {
      code: data?.code, submissionNotStarted: data?.submissionNotStarted === true,
    })
    return data
  }
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason || new Error('请求已取消')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
  return async function jsonFetch(url, init) {
    const signal = init?.signal
    signal?.throwIfAborted()
    const method = String(init?.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return once(url, init)
    const attempts = [{ cache: 'no-store', ...(init || {}) }, init, init]
    for (let index = 0; ; index++) {
      try { return await once(url, attempts[index]) }
      catch (error) {
        signal?.throwIfAborted()
        if (!(error instanceof TypeError) || index === attempts.length - 1) throw error
        if (!index) onRetry?.({ url, error })
        await pause(300 * (index + 1), signal)
      }
    }
  }
}
