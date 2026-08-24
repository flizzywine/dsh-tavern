function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function coordinationEventId(snapshot) {
  const activity = snapshot && snapshot.activity || {}
  const task = snapshot && snapshot.task || {}
  return [
    str(snapshot && snapshot.runtimeGeneration),
    snapshot && snapshot.liveSession === true ? '1' : '0',
    Number(snapshot && snapshot.mailboxVersion) || 0,
    str(activity.operationId),
    str(activity.phase),
    activity.busy === true ? '1' : '0',
    Number(activity.updatedAt) || 0,
    str(task.taskId),
    str(task.status),
    Number(task.version) || 0
  ].join(':')
}

/** Poll file-backed coordination state on the server and publish changed snapshots. */
export function createCoordinationEventPublisher(options = {}) {
  if (typeof options.load !== 'function') throw new Error('Coordination Event Publisher 缺少快照读取 adapter')
  const startInterval = typeof options.startInterval === 'function' ? options.startInterval : setInterval
  const stopInterval = typeof options.stopInterval === 'function' ? options.stopInterval : clearInterval
  const pollIntervalMs = Number(options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 250

  function subscribe(sessionId, listener) {
    let stopped = false
    let loading = false
    let lastId = ''
    async function poll() {
      if (stopped || loading) return
      loading = true
      try {
        const snapshot = await options.load(str(sessionId))
        if (stopped || snapshot === null || snapshot === undefined) return
        const eventId = coordinationEventId(snapshot)
        if (eventId === lastId) return
        lastId = eventId
        listener(snapshot, eventId)
      } catch (error) {
        if (typeof options.onError === 'function') options.onError(error)
      } finally {
        loading = false
      }
    }
    void poll()
    const timer = startInterval(function () { void poll() }, pollIntervalMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
    return function () {
      if (stopped) return
      stopped = true
      stopInterval(timer)
    }
  }

  return Object.freeze({ subscribe })
}
