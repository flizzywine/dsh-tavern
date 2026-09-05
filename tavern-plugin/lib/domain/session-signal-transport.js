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

  return Object.freeze({ publish, subscribe })
}
