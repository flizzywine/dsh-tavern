function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

export const TAVERN_HELPER_EVENT_TIMEOUT_MS = 60000

/**
 * Coordinate lifecycle events that must run inside the browser-owned Tavern
 * Helper runtime before the server may continue compiling or settling a turn.
 */
export function createTavernHelperEventGate(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || TAVERN_HELPER_EVENT_TIMEOUT_MS)
  const presenceTtlMs = Math.max(timeoutMs, Number(options.presenceTtlMs) || 5000)
  const records = new Map()
  const presence = new Map()
  let sequence = 0

  function touch(sessionId, runtimeId = 'legacy', ready = false) {
    const id = str(sessionId)
    const owner = str(runtimeId)
    if (id === '' || owner === '') return false
    const current = presence.get(id)
    if (current && current.owner !== owner && now() - current.seenAt <= presenceTtlMs) return false
    presence.set(id, { owner, seenAt: now(), ready: ready === true })
    return true
  }

  function available(sessionId, runtimeId = '', requireReady = false) {
    const current = presence.get(str(sessionId))
    if (!current || now() - current.seenAt > presenceTtlMs) return false
    if (str(runtimeId) !== '' && current.owner !== str(runtimeId)) return false
    return requireReady !== true || current.ready === true
  }

  function poll(sessionId, runtimeId = 'legacy', ready = false) {
    const id = str(sessionId)
    if (!touch(id, runtimeId, ready)) return { active: false, ready: false, event: null }
    const record = records.get(id)
    return { active: true, ready: ready === true, event: ready === true && record ? clone(record.event) : null }
  }

  function complete(sessionId, eventId, args, runtimeId = 'legacy', error = '', diagnostics) {
    const id = str(sessionId)
    if (!available(id, runtimeId)) return false
    const record = records.get(id)
    if (!record || record.event.id !== str(eventId)) return false
    records.delete(id)
    clearTimeout(record.timer)
    const message = str(error).trim()
    const extra = Array.isArray(diagnostics) ? { diagnostics: clone(diagnostics.slice(-50)) } : {}
    record.resolve(message === ''
      ? { handled: true, args: clone(Array.isArray(args) ? args : record.event.args), ...extra }
      : { handled: false, error: message, args: clone(Array.isArray(args) ? args : record.event.args), ...extra })
    return true
  }

  async function dispatch(sessionId, name, args = [], context = null) {
    const id = str(sessionId)
    if (id === '' || !available(id, '', true) || records.has(id)) return { handled: false, args: clone(args) }
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

  function dispose(sessionId, runtimeId = '') {
    const id = str(sessionId)
    if (runtimeId !== '' && !available(id, runtimeId)) return false
    presence.delete(id)
    const record = records.get(id)
    if (!record) return true
    records.delete(id)
    clearTimeout(record.timer)
    record.resolve({ handled: false, disposed: true, args: clone(record.event.args) })
    return true
  }

  function status(sessionId) {
    const current = presence.get(str(sessionId))
    const present = Boolean(current && now() - current.seenAt <= presenceTtlMs)
    return { present, ready: present && current.ready === true, busy: records.has(str(sessionId)) }
  }

  return Object.freeze({ touch, available, poll, complete, dispatch, dispose, status })
}
