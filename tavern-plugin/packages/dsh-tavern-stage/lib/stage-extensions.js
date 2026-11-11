// Extensions declare their services before stage service construction. No core RPC bypass.
export function createStageExtensions() {
  const factories = new Map(), instances = [], releases = [], deps = Object.create(null), routes = new Map(), works = []
  let started = false, disposed = false
  return Object.freeze({
    register(id, factory) {
      if (started || disposed) throw new Error('Stage extensions already started or disposed')
      if (factories.has(id)) throw new Error('Stage extension already registered: ' + id)
      factories.set(id, factory)
      return () => {if (!started && factories.get(id) === factory) factories.delete(id)}
    },
    start(core) {
      if (started || disposed) throw new Error('Stage extensions already started or disposed')
      started = true
      for (const [id, factory] of factories) {
        const instance = factory(core)
        instances.push({id, instance})
        for (const [key, value] of Object.entries(instance.deps || {})) {
          if (key in core || Object.hasOwn(deps, key)) throw new Error('Occupied stage dependency: ' + key)
          deps[key] = value
        }
      }
      return deps
    },
    // bindings: the stage's request bindings. An extension's requests may be built from them (requests(bindings) ->
    // {methods, call, work?}); work() reports its in-flight activity to deployment (works()).
    bind(registry, bindings = {}) {
      for (const {id, instance} of instances) {
        if (!instance.requests) continue
        const requests = typeof instance.requests === 'function' ? instance.requests(bindings) : instance.requests
        for (const method of requests.methods) routes.set(method, requests)
        if (requests.work) works.push(requests.work)
        releases.push(registry.register('stage.extension.' + id, requests))
      }
    },
    works: () => [...works],
    // The extensions' own methods, for stage callers outside the HTTP dispatcher (clip export's recorded reads).
    handles: method => routes.has(method),
    call: (method, args, authority) => routes.get(method).call(method, args, authority),
    dispose() {
      if (disposed) return
      disposed = true
      const errors = []
      for (const release of releases.splice(0).reverse()) try {release()} catch (error) {errors.push(error)}
      routes.clear();works.length = 0
      for (const {instance} of instances.splice(0).reverse()) try {instance.dispose?.()} catch (error) {errors.push(error)}
      factories.clear()
      if (errors.length) throw new AggregateError(errors, 'Stage extension cleanup failed')
    }
  })
}
