// A module's effects have one lifetime even when the host outlives the module.
// Host disposal and explicit disposal share idempotent cleanup functions.
export function createResourceScope(host, {onError = () => {}} = {}) {
  const cleanups = new Set(), pending = new Set(), contexts = new WeakMap()
  let active = true
  const report = error => {try {onError(error)} catch {}}
  function track(value) {
    if (!value || typeof value.then !== 'function') return value
    const task = Promise.resolve(value).catch(report)
    pending.add(task);task.then(() => pending.delete(task))
    return task
  }
  function own(value) {
    let cleanup = typeof value === 'function' ? value : typeof value?.dispose === 'function' ? () => value.dispose() : null
    if (!cleanup) return () => {}
    const release = () => {
      if (!cleanup) return
      const run = cleanup;cleanup = null;cleanups.delete(release)
      try {return track(run())} catch (error) {report(error)}
    }
    if (active) cleanups.add(release)
    else release()
    return release
  }
  function context(parent) {
    if (contexts.has(parent)) return contexts.get(parent)
    const scoped = new Proxy(parent, {get(target, key) {
      if (key === 'effect') return (install, label) => {
        if (!active) throw Object.assign(Error('Module scope disposed'), {code:'MODULE_UNAVAILABLE'})
        return target.effect(() => {
          if (!active) return () => {}
          return own(install())
        }, label)
      }
      if (key === 'provide') return (...args) => {
        if (!active) throw Object.assign(Error('Module scope disposed'), {code:'MODULE_UNAVAILABLE'})
        return own(target.provide(...args))
      }
      if (key === 'on') return (...args) => active ? own(target.on(...args)) : () => {}
      if (key === 'inject') return (names, install, ...rest) => {
        if (!active) return () => {}
        const injection = target.inject(names, child => active ? install(context(child)) : undefined, ...rest)
        own(injection)
        return injection
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    }})
    contexts.set(parent, scoped);return scoped
  }
  async function dispose() {
    active = false
    for (const release of [...cleanups].reverse()) release()
    // Injection disposal may trigger additional asynchronous effect cleanup.
    while (pending.size) await Promise.all([...pending])
  }
  return Object.freeze({ctx:context(host), own, dispose, active:() => active})
}
