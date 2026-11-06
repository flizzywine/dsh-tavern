import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Per-turn paths (model hooks, settlement, background tasks they start) must not load a
 * whole Chat from storage that can read floors alone: that cost grows with the save.
 * `scope` marks such a path; work it starts inherits the mark. `allow` marks a deliberate
 * exception (first sync in a process, legacy layouts). Storage calls `report` when it loads
 * a whole native Chat inside a marked path.
 *
 * mode 'warn' logs each offending call site once per process; 'throw' fails (tests, e2e).
 * Saves of at most `minFloors` floors are not reported: their whole cost is bounded.
 */
export function createWholeReadGuard({ mode = 'warn', logger = console, minFloors = 64 } = {}) {
  const context = new AsyncLocalStorage()
  const warned = new Set()
  const enabled = mode === 'warn' || mode === 'throw'
  function capture() {
    const limit = Error.stackTraceLimit
    Error.stackTraceLimit = 20
    try { return new Error().stack } finally { Error.stackTraceLimit = limit }
  }
  function scope(label, operation) {
    if (!enabled || context.getStore()) return operation()
    return context.run({ label }, operation)
  }
  return Object.freeze({
    mode,
    scope,
    // Hook handlers that return an async iterable do their work while it is consumed.
    stream(label, iterable) {
      if (!enabled || !iterable?.[Symbol.asyncIterator]) return iterable
      return { [Symbol.asyncIterator]() {
        const iterator = iterable[Symbol.asyncIterator]()
        const step = method => (...args) => scope(label, () => iterator[method](...args))
        return { next: step('next'), ...(iterator.return ? { return: step('return') } : {}), ...(iterator.throw ? { throw: step('throw') } : {}) }
      } }
    },
    allow(reason, operation) { return enabled && context.getStore() ? context.run({ allowed: reason }, operation) : operation() },
    active() { return Boolean(context.getStore()?.label) },
    site() { return enabled && context.getStore()?.label ? capture() : undefined },
    // A save no longer than a view window costs the same whole or in parts.
    // `site`: a stack captured where the caller entered, for work queued behind a lock.
    report(chatId, floors = Infinity, site) {
      const store = context.getStore()
      if (!store?.label || floors <= minFloors) return
      const frames = (site || capture()).split('\n').slice(3, 15).map(line => line.trim().replace(/^at /, '').replace(/\(?file:.*?\/tavern-plugin\//, '('))
      const message = `每轮路径读取了完整存档（${store.label}）：${frames.join(' <- ')}`
      if (mode === 'throw') throw Object.assign(new Error(message), { code: 'DSH_TAVERN_WHOLE_READ', chatId })
      // The nearest frames name the call site; deeper ones differ with how it was reached.
      const key = store.label + frames.slice(0, 2).join()
      if (warned.has(key)) return
      warned.add(key)
      logger.warn('dsh-tavern: ' + message)
    }
  })
}

// Per-turn host events. Their handlers, and the work those handlers start, run marked.
const TURN_EVENTS = new Set(['agent/pre-step', 'agent/request', 'agent/request-error', 'agent/turn-stopping',
  'agent/error', 'agent/status', 'system-prompt/assemble', 'llm/stream', 'session/event'])

/** The plugin context with per-turn hook handlers marked; everything else is the host's own. */
export function scopeTurnHooks(ctx, guard) {
  if (guard.mode !== 'warn' && guard.mode !== 'throw') return ctx
  const on = (event, handler, ...rest) => ctx.on(event, !TURN_EVENTS.has(event) || typeof handler !== 'function' ? handler
    : function (...args) {
      const result = guard.scope(event, () => handler.apply(this, args))
      return event === 'llm/stream' ? guard.stream(event, result) : result
    }, ...rest)
  return new Proxy(ctx, { get(target, key) {
    if (key === 'on') return on
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
