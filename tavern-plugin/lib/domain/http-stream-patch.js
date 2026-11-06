import { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

// Node's event-based toWeb adapter can enqueue after cancellation while a
// resume tick is queued (nodejs/node#64529). Scope the workaround to HTTP
// messages; use the async iterator so cancellation never leaves a data listener.
const patches = new WeakMap()
export function installHttpStreamPatch() {
  let patch = patches.get(Readable)
  if (!patch) {
    const original = Readable.toWeb
    const replacement = function (source, options) {
      if (!(source instanceof IncomingMessage)) return original.call(this, source, options)
      const iterator = source[Symbol.asyncIterator]()
      let closed = false
      return new ReadableStream({
        async pull(controller) {
          try {
            const item = await iterator.next()
            if (closed) return
            if (item.done) { closed = true; controller.close() }
            else controller.enqueue(Buffer.isBuffer(item.value) ? new Uint8Array(item.value) : item.value)
          } catch (error) {
            if (!closed) { closed = true; controller.error(error) }
          }
        },
        async cancel(reason) {
          closed = true
          source.destroy(reason instanceof Error ? reason : undefined)
          // Destroy interrupts any in-flight next(). Its rejection belongs to
          // the canceled read, not to a new unhandled background operation.
          try { await iterator.return?.() } catch (error) {
            if (!source.destroyed) throw error
          }
        }
      }, options?.strategy)
    }
    patch = { original, replacement, users:0 }
    Readable.toWeb = replacement
    patches.set(Readable, patch)
  }
  patch.users++
  let active = true
  return () => {
    if (!active) return
    active = false
    if (--patch.users) return
    if (Readable.toWeb === patch.replacement) Readable.toWeb = patch.original
    patches.delete(Readable)
  }
}
