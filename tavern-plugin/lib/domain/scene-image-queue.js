import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const localTickets = new Set()
const queuePath = 'scene-images/request-queue.json'
function alive(ticket) {
  if (ticket.pid === process.pid) return localTickets.has(ticket.id)
  try { process.kill(ticket.pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}
function normalize(value) {
  if (value === undefined) return { version: 1, entries: [], active: null }
  if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.some(entry => !entry || typeof entry.id !== 'string' || !Number.isSafeInteger(entry.pid) || entry.pid <= 0) || new Set(value.entries.map(entry => entry.id)).size !== value.entries.length || value.active !== null && !value.entries.some(entry => entry.id === value.active)) throw new Error('生图队列记录不合法，请检查日志；尚未请求图片')
  const entries = value.entries.filter(alive)
  return { version: 1, entries, active: entries.some(entry => entry.id === value.active) ? value.active : null }
}

/** One in-flight image request per Tavern data store, across chats and hosts.
 * Only a confirmed dead owner can be evicted; elapsed time is not a lease. */
export function createSceneImageQueue({ store, onStorageError }) {
  async function change(updater, signal, attempts = Infinity) {
    for (let n = 0; ; n++) {
      signal?.throwIfAborted()
      try { return await store.updateJson(queuePath, value => updater(normalize(value))) }
      catch (error) {
        if (error.code !== 'DSH_TAVERN_WRITE_CONFLICT' || n + 1 >= attempts) throw error
        await delay(50, undefined, { signal })
      }
    }
  }
  return {
    async run({ requestId, signal }, operation) {
      const ticket = { id: randomUUID(), pid: process.pid, requestId, enqueuedAt: Date.now() }
      localTickets.add(ticket.id)
      try {
        await change(queue => ({ ...queue, entries: [...queue.entries, ticket] }), signal)
        for (;;) {
          signal.throwIfAborted()
          const snapshot = normalize(await store.readJson(queuePath))
          if (!snapshot.entries.some(entry => entry.id === ticket.id)) throw new Error('生图排队记录已不存在，尚未请求图片')
          if (!snapshot.active && snapshot.entries[0]?.id === ticket.id) {
            const claimed = await change(queue => !queue.active && queue.entries[0]?.id === ticket.id ? { ...queue, active: ticket.id } : queue, signal)
            if (claimed.active === ticket.id) break
          }
          await delay(100, undefined, { signal })
        }
        signal.throwIfAborted()
        return await operation()
      } finally {
        // Never release merely because a signal fired: operation() must settle
        // first, including adapters that return an image after cancellation.
        try { await change(queue => ({ ...queue, entries: queue.entries.filter(entry => entry.id !== ticket.id), active: queue.active === ticket.id ? null : queue.active }), undefined, 20) }
        catch { onStorageError?.() }
        finally { localTickets.delete(ticket.id) }
      }
    }
  }
}
