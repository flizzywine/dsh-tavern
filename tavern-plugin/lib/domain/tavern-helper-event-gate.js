function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

/**
 * Coordinate lifecycle events that must run inside the browser-owned Tavern
 * Helper runtime before the server may continue compiling or settling a turn.
 */
export function createTavernHelperEventGate(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 2500)
  const presenceTtlMs = Math.max(timeoutMs, Number(options.presenceTtlMs) || 5000)
  const records = new Map()
  const presence = new Map()
  let sequence = 0

  function touch(sessionId) {
    const id = str(sessionId)
    if (id !== '') presence.set(id, now())
  }

  function available(sessionId) {
    const seenAt = presence.get(str(sessionId))
    return Number.isFinite(seenAt) && now() - seenAt <= presenceTtlMs
  }

  function poll(sessionId) {
    const id = str(sessionId)
    touch(id)
    const record = records.get(id)
    return record ? clone(record.event) : null
  }

  function complete(sessionId, eventId, args) {
    const id = str(sessionId)
    const record = records.get(id)
    if (!record || record.event.id !== str(eventId)) return false
    records.delete(id)
    clearTimeout(record.timer)
    record.resolve({ handled: true, args: clone(Array.isArray(args) ? args : record.event.args) })
    return true
  }

  async function dispatch(sessionId, name, args = [], context = null) {
    const id = str(sessionId)
    if (id === '' || !available(id) || records.has(id)) return { handled: false, args: clone(args) }
    const event = {
      id: 'helper-event-' + (++sequence),
      name: str(name),
      args: clone(Array.isArray(args) ? args : []),
      context: clone(context)
    }
    return await new Promise(function (resolve) {
      const timer = setTimeout(function () {
        const record = records.get(id)
        if (!record || record.event.id !== event.id) return
        records.delete(id)
        resolve({ handled: false, timedOut: true, args: clone(event.args) })
      }, timeoutMs)
      records.set(id, { event, resolve, timer })
    })
  }

  function dispose(sessionId) {
    const id = str(sessionId)
    presence.delete(id)
    const record = records.get(id)
    if (!record) return
    records.delete(id)
    clearTimeout(record.timer)
    record.resolve({ handled: false, disposed: true, args: clone(record.event.args) })
  }

  return Object.freeze({ touch, available, poll, complete, dispatch, dispose })
}
