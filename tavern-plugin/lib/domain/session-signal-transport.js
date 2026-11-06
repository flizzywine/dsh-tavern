function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function signalId(kind, version) {
  return kind + ':' + version
}

function emit(listener, signal) {
  try { listener(signal) } catch {}
}

/**
 * Fan out typed, non-authoritative wake signals for one Tavern session.
 * tavern-state may carry the matching read-only projection so consumers can
 * render without opening a second connection; version-only signals still work.
 */
export function createSessionSignalTransport() {
  const records = new Map()
  const followers = new Set()

  function recordFor(sessionId) {
    const id = str(sessionId)
    if (!records.has(id)) records.set(id, { latest: new Map(), listeners: new Set() })
    return records.get(id)
  }

  function publish(sessionId, input = {}) {
    const id = str(sessionId)
    const kind = str(input.kind).trim()
    const version = str(input.version).trim()
    if (id === '' || kind === '' || version === '') return false
    const record = recordFor(id)
    const current = record.latest.get(kind)
    if (current && current.version === version) return false
    const base = { id: signalId(kind, version), sessionId: id, kind, version }
    const snapshot = kind === 'tavern-state' && input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : undefined
    const signal = Object.freeze(snapshot === undefined ? base : Object.assign(base, { snapshot }))
    record.latest.set(kind, signal)
    for (const subscription of record.listeners) {
      if (subscription.kinds.size === 0 || subscription.kinds.has(kind)) emit(subscription.listener, signal)
    }
    for (const listener of followers) emit(listener, signal)
    return true
  }

  function subscribe(sessionId, kinds, listener) {
    const record = recordFor(sessionId)
    const accepted = new Set((Array.isArray(kinds) ? kinds : [kinds]).map(str).filter(Boolean))
    const subscription = { kinds: accepted, listener }
    record.listeners.add(subscription)
    for (const signal of record.latest.values()) {
      if (accepted.size === 0 || accepted.has(signal.kind)) emit(listener, signal)
    }
    let stopped = false
    return function () {
      if (stopped) return
      stopped = true
      record.listeners.delete(subscription)
    }
  }

  function snapshot() {
    const signals = []
    for (const record of records.values()) signals.push(...record.latest.values())
    return signals.sort(function (left, right) {
      return left.sessionId.localeCompare(right.sessionId) || left.kind.localeCompare(right.kind)
    })
  }

  async function* follow(signal, sessionIds) {
    const filter = Array.isArray(sessionIds) ? new Set(sessionIds.map(str).filter(Boolean)) : null
    const accepts = function (value) { return filter === null || filter.has(value.sessionId) }
    const pending = new Map()
    let wake
    let stopped = signal?.aborted === true
    const notify = function (value) {
      if (!accepts(value)) return
      pending.set(value.sessionId + '\0' + value.kind, value)
      if (wake) { const resolve = wake; wake = undefined; resolve() }
    }
    const stop = function () {
      stopped = true
      if (wake) { const resolve = wake; wake = undefined; resolve() }
    }
    followers.add(notify)
    signal?.addEventListener('abort', stop, { once: true })
    try {
      const signals = snapshot().filter(accepts)
      for (const value of signals) {
        const key = value.sessionId + '\0' + value.kind
        if (pending.get(key)?.version === value.version) pending.delete(key)
      }
      yield Object.freeze({ type: 'snapshot', signals })
      while (!stopped) {
        if (pending.size === 0) await new Promise(function (resolve) { wake = resolve })
        if (stopped) break
        const entry = pending.entries().next().value
        if (!entry) continue
        pending.delete(entry[0])
        yield Object.freeze({ type: 'delta', signal: entry[1] })
      }
    } finally {
      followers.delete(notify)
      signal?.removeEventListener('abort', stop)
    }
  }

  return Object.freeze({ publish, subscribe, snapshot, follow })
}
