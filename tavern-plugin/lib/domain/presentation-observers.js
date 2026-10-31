import {createReplyStreamObserver} from './reply-stream-observer.js'

// Optional renderers observe committed story changes, never participate in the save.
// Registration owns its listeners and in-flight stream observers as one lifetime.
export function createPresentationObservers({warn = () => {}} = {}) {
  const entries = new Map()
  let disposed = false
  const report = (owner, phase, error) => {try {warn({owner, phase, error})} catch {}}
  function invoke(entry, phase, ...args) {
    if (!entry.active) return
    try {return Promise.resolve(entry.hooks[phase]?.(...args, entry.controller.signal)).catch(error => report(entry.owner, phase, error))}
    catch (error) {report(entry.owner, phase, error)}
  }
  function register(owner, hooks) {
    if (disposed) throw Error('Presentation host disposed')
    if (!owner || entries.has(owner)) throw Error('Duplicate or invalid presentation owner')
    const entry = {owner, hooks, active:true, controller:new AbortController(), streams:new Set()}
    entries.set(owner, entry)
    return () => {
      if (!entry.active) return
      entry.active = false;entry.controller.abort();entries.delete(owner)
      for (const stream of entry.streams) stream.cancel()
      entry.streams.clear()
    }
  }
  function notify(phase, ...args) {return Promise.all([...entries.values()].map(entry => invoke(entry, phase, ...args)))}
  function openReply({sessionId, turn, signal, enabled = true}) {
    const streams = []
    if (enabled && !disposed) for (const entry of entries.values()) {
      if (typeof entry.hooks.beginReply !== 'function') continue
      const stream = createReplyStreamObserver({signal,
        begin:lifetime => entry.active ? entry.hooks.beginReply(sessionId, turn, lifetime) : null,
        warn:error => report(entry.owner, 'reply', error)})
      entry.streams.add(stream);streams.push({entry, stream})
    }
    let closed = false
    return {
      append(delta) {if (!closed) for (const {stream} of streams) stream.append(delta)},
      finish(completed) {
        if (closed) return
        closed = true
        for (const {entry, stream} of streams) {stream.finish(completed);entry.streams.delete(stream)}
      },
      cancel() {
        closed = true
        for (const {entry, stream} of streams) {stream.cancel();entry.streams.delete(stream)}
      }
    }
  }
  return Object.freeze({register, openReply,
    cancelled:(...args) => notify('cancelled', ...args),
    settlementQueued:(...args) => notify('settlementQueued', ...args),
    saved:(...args) => notify('saved', ...args),
    patched:(...args) => notify('patched', ...args),
    disconnected:(...args) => notify('disconnected', ...args),
    dispose() {
      disposed = true
      for (const entry of entries.values()) {
        entry.active = false;entry.controller.abort()
        for (const stream of entry.streams) stream.cancel()
        entry.streams.clear()
      }
      entries.clear()
    }
  })
}
