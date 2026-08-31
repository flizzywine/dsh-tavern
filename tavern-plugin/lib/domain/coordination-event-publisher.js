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
    Number(snapshot && snapshot.projectionRevision) || 0,
    str(task.taskId),
    str(task.status),
    Number(task.version) || 0
  ].join(':')
}

/** Publish coordination state after local writes, with a low-frequency file fallback. */
export function createCoordinationEventPublisher(options = {}) {
  if (typeof options.load !== 'function') throw new Error('Coordination Event Publisher 缺少快照读取 adapter')
  const startInterval = typeof options.startInterval === 'function' ? options.startInterval : setInterval
  const stopInterval = typeof options.stopInterval === 'function' ? options.stopInterval : clearInterval
  const fallbackIntervalMs = Number(options.fallbackIntervalMs) > 0 ? Number(options.fallbackIntervalMs) : 5000
  const records = new Map()

  function recordFor(sessionId) {
    const id = str(sessionId)
    if (!records.has(id)) records.set(id, { id, listeners: new Set(), timer: null, loading: false, reloadRequested: false, forceRequested: false, lastId: '', hasVersion: false, lastVersion: undefined })
    return records.get(id)
  }

  async function refresh(record, checkVersion) {
    if (record.listeners.size === 0) return
    if (record.loading) {
      record.reloadRequested = true
      if (!checkVersion) record.forceRequested = true
      return
    }
    record.loading = true
    try {
      const version = checkVersion && typeof options.readVersion === 'function' ? await options.readVersion(record.id) : undefined
      if (checkVersion && record.hasVersion && Object.is(version, record.lastVersion)) return
      const snapshot = await options.load(record.id)
      if (record.listeners.size === 0 || snapshot === null || snapshot === undefined) return
      if (checkVersion && typeof options.readVersion === 'function') {
        record.lastVersion = version
        record.hasVersion = true
      }
      const eventId = coordinationEventId(snapshot)
      if (eventId === record.lastId) return
      record.lastId = eventId
      record.listeners.forEach(function (listener) { listener(snapshot, eventId) })
    } catch (error) {
      if (typeof options.onError === 'function') options.onError(error)
    } finally {
      record.loading = false
      if (record.reloadRequested) {
        const force = record.forceRequested
        record.reloadRequested = false
        record.forceRequested = false
        await refresh(record, !force)
      }
    }
  }

  function subscribe(sessionId, listener) {
    const record = recordFor(sessionId)
    record.listeners.add(listener)
    if (record.listeners.size === 1) {
      void refresh(record, true)
      record.timer = startInterval(function () { void refresh(record, true) }, fallbackIntervalMs)
      if (record.timer && typeof record.timer.unref === 'function') record.timer.unref()
    }
    let stopped = false
    return function () {
      if (stopped) return
      stopped = true
      record.listeners.delete(listener)
      if (record.listeners.size === 0 && record.timer !== null) {
        stopInterval(record.timer)
        record.timer = null
      }
    }
  }

  async function publish(sessionId) {
    const record = records.get(str(sessionId))
    if (record === undefined) return
    await refresh(record, false)
  }

  async function publishAll() {
    await Promise.all(Array.from(records.values()).map(function (record) { return refresh(record, false) }))
  }

  return Object.freeze({ subscribe, publish, publishAll })
}
