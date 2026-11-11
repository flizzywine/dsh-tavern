import { randomUUID } from 'node:crypto'

// Transport facts only. Observers never receive headers, bodies, URLs or errors.
export function createRequestObservers() {
  const observers = new Set()
  function observe(observer) {
    const registration = {observer, pending:new Set()}
    observers.add(registration)
    return () => {
      observers.delete(registration)
      for (const controller of registration.pending) controller.abort()
    }
  }
  // Capture before provider queues/preparation; unregister cancels this exact unsent set.
  function capture({provider, operation, signal}) {
    const registrations = [...observers], controller = new AbortController()
    const dispose = () => { for (const registration of registrations) registration.pending.delete(controller) }
    for (const registration of registrations) registration.pending.add(controller)
    const capturedSignal = registrations.length ? AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]) : signal
    return Object.freeze({
      observed:registrations.length > 0, signal:capturedSignal, dispose,
      run:work => runCaptured({provider, operation, signal:capturedSignal}, registrations, controller, work),
    })
  }
  async function run(facts, work) {
    const snapshot = capture(facts)
    try { return await snapshot.run(work) } finally { snapshot.dispose() }
  }
  function forProvider(provider) {
    return Object.assign((operation, signal, work) => run({provider, operation, signal}, work), {
      capture:(operation, signal) => capture({provider, operation, signal}),
    })
  }
  async function runCaptured({provider, operation, signal}, registrations, controller, work) {
    if (!registrations.length) return work(null)
    const transportSignal = signal
    const safe = new AbortController()
    const cancel = () => {
      const reason = new DOMException('Request cancelled', 'AbortError')
      delete reason.stack
      safe.abort(Object.freeze(reason))
    }
    if (transportSignal.aborted) cancel()
    else transportSignal.addEventListener('abort', cancel, {once:true})
    const request = Object.freeze({id:randomUUID(), provider, operation, signal:safe.signal})
    const entered = []
    let sent = false, status = null, bodyComplete = false, failure = null
    try {
      transportSignal.throwIfAborted()
      for (const registration of registrations) {
        entered.push(registration)
        await registration.observer.beforeSend?.(request)
        transportSignal.throwIfAborted()
      }
      return await work({
        signal:transportSignal,
        send(fetcher, url, init) {
          transportSignal.throwIfAborted()
          // No await between the last cancellation check and the actual send.
          sent = true
          for (const registration of registrations) registration.pending.delete(controller)
          return fetcher(url, init)
        },
        async headers(response) {
          status = response.status
          for (const {observer} of entered) await observer.afterHeaders?.(request, Object.freeze({status}))
        },
        complete() { bodyComplete = true },
      })
    } catch (error) {
      failure = transportSignal.aborted ? 'aborted' : 'failed'
      throw error
    } finally {
      transportSignal.removeEventListener('abort', cancel)
      for (const registration of registrations) registration.pending.delete(controller)
      const outcome = Object.freeze({sent, status, bodyComplete, failure})
      const results = await Promise.allSettled(entered.map(({observer}) => Promise.resolve().then(() => observer.afterEnd?.(request, outcome))))
      const rejected = results.find(result => result.status === 'rejected')
      if (!failure && rejected) throw rejected.reason
    }
  }
  return {observe, run, forProvider}
}
