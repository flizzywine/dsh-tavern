// missing/invalid measurements never authorize history mutation.
const warned = new WeakSet()
export function warnCompactionPressureOnce(session, logger, error) {
  if (warned.has(session)) return
  warned.add(session)
  logger?.warn?.(`Tavern compaction pressure skipped: session=${session.id || 'unknown'}; ${error?.stack || error}`)
}

export async function readCompactionPressure(session, signal, logger, read) {
  try {
    signal?.throwIfAborted()
    return await read()
  } catch (error) {
    signal?.throwIfAborted()
    warnCompactionPressureOnce(session, logger, error)
    return null
  }
}

export function requirePressureNumber(value, name, positive = false) {
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) throw new Error(`Unavailable compaction ${name}`)
  return value
}
