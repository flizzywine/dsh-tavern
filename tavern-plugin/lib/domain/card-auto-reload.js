// A playing game follows its card: once the card or its world book changed, the next idle read of
// the game applies the update by itself, the same work as the old explicit reload. Only a legacy
// save whose own book copy needs synchronization keeps the manual button (the copy may hold card
// script writes an automatic overwrite would lose).

export const CARD_RELOAD_BUSY = 'TAVERN_CARD_RELOAD_BUSY'

/** Whether a reload status asks for an update this game may take on its own. */
export function autoReloadable(status) {
  return Boolean(status && status.available && !status.error && status.digest
    && !status.legacy && !status.worldbookSyncRequired && (status.cardChanged || status.worldbookChanged))
}

/**
 * Runs `apply(sessionId, digest)` off the read that noticed the change, once per session at a time.
 * A failure is kept per digest so the same update is not retried on every read; a new edit (another
 * digest) or retry() tries again. Busy games stay queued for the idle watcher.
 * `published(sessionId)` runs after a success so pages re-read.
 */
export function createCardAutoReload({ apply, published = () => {}, logger = console, defer = task => setTimeout(task, 0) }) {
  const running = new Set()
  const failures = new Map()
  const waiting = new Set()

  function schedule(sessionId, status, { busy = false } = {}) {
    if (!sessionId || running.has(sessionId)) return false
    if (!autoReloadable(status)) {
      waiting.delete(sessionId)
      return false
    }
    if (failures.get(sessionId)?.digest === status.digest) return false
    if (busy) {
      waiting.add(sessionId)
      return false
    }
    waiting.delete(sessionId)
    running.add(sessionId)
    defer(async () => {
      try {
        await apply(sessionId, status.digest)
        failures.delete(sessionId)
        published(sessionId)
      } catch (error) {
        if (error?.code === CARD_RELOAD_BUSY) waiting.add(sessionId)
        else {
          failures.set(sessionId, { digest: status.digest, message: String(error?.message || error) })
          logger.warn('dsh-tavern: 自动重新加载人物卡失败', sessionId, error?.message || error)
        }
      } finally { running.delete(sessionId) }
    })
    return true
  }

  /** The last automatic failure of a game, for its status line. */
  function failure(sessionId, digest) {
    const failed = failures.get(sessionId)
    return failed && failed.digest === digest ? failed.message : ''
  }

  /** The player asked to retry: forget the failure so the next read tries again. */
  function retry(sessionId) { failures.delete(sessionId) }

  return Object.freeze({ schedule, failure, retry, running: sessionId => running.has(sessionId), waiting: sessionId => waiting.has(sessionId) })
}
