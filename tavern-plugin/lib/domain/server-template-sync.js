/** Coalesce display work without losing a write received during execution. */
export function createServerTemplateSync({ run, onError, delayMs = 250, maxRetryDelayMs = 5000 }) {
  const records = new Map()
  let disposed = false
  function schedule(id, version, { blocked = false, enabled = true } = {}) {
    if (disposed || !id || id.startsWith('opening:')) return
    let record = records.get(id)
    if (!enabled) {
      if (record) clearTimeout(record.timer)
      records.delete(id)
      return
    }
    if (record && record.version === version && record.blocked === blocked) return
    if (!record) { record = {}; records.set(id, record) }
    else clearTimeout(record.timer)
    Object.assign(record, { version, blocked, dirty: true, timer: null, retryDelay: delayMs })
    arm(id, record)
  }
  function arm(id, record) {
    if (disposed || records.get(id) !== record || record.blocked || record.timer || record.running) return
    record.timer = setTimeout(async () => {
      record.timer = null; record.running = true; record.dirty = false
      const version = record.version
      try {
        const result = await run(id)
        if (result?.deferred) {
          record.dirty = true
          // A new revision or a completed batch is progress. Only unchanged,
          // unproductive retries back off; never abandon unfinished history.
          if (record.version === version && !result.synchronized) {
            record.retryDelay = Math.min(Math.max(delayMs, maxRetryDelayMs), record.retryDelay * 2)
          } else record.retryDelay = delayMs
        }
      } catch (error) {
        // The story or swipe moved while the template ran (a settlement wrote meanwhile): nothing was saved, and the
        // display is simply rerun on the new state, backing off, not reported as a failure.
        if (error?.code === 'PROMPT_TEMPLATE_STATE_CONFLICT') {
          record.dirty = true
          record.retryDelay = Math.min(Math.max(delayMs, maxRetryDelayMs), record.retryDelay * 2)
        } else onError?.(error)
      }
      finally {
        record.running = false
        if (record.dirty) arm(id, record)
        // Bound completed-version bookkeeping; never evict queued/blocked work.
        if (records.size > 256) for (const [key, item] of records) {
          if (records.size <= 256) break
          if (!item.running && !item.timer && !item.dirty && key !== id) records.delete(key)
        }
      }
    }, record.retryDelay)
    record.timer.unref?.()
  }
  // A blocked record waits for the next write; a turn's last write lands before it ends, so
  // the turn's end releases it.
  function release(id) {
    const record = records.get(id)
    if (!record || !record.blocked) return
    record.blocked = false
    if (record.dirty) arm(id, record)
  }
  function unchanged(id, version) {
    const record=records.get(id)
    // Only advance across the exact metadata commit; an unseen revision may
    // contain a real display edit. Retain any already queued or running work.
    if(record && Number.isSafeInteger(version) && record.version+1===version) record.version=version
  }
  return { schedule, release, unchanged, dispose() { disposed = true; for (const record of records.values()) clearTimeout(record.timer); records.clear() } }
}
