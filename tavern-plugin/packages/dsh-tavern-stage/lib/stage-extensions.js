// Extensions declare their services before stage service construction. No core RPC bypass.
export function createStageExtensions() {
  const factories = new Map(), instances = [], releases = [], deps = Object.create(null)
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
    bind(registry) {
      for (const {id, instance} of instances) {
        if (instance.requests) releases.push(registry.register('stage.extension.' + id, instance.requests))
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      const errors = []
      for (const release of releases.splice(0).reverse()) try {release()} catch (error) {errors.push(error)}
      for (const {instance} of instances.splice(0).reverse()) try {instance.dispose?.()} catch (error) {errors.push(error)}
      factories.clear()
      if (errors.length) throw new AggregateError(errors, 'Stage extension cleanup failed')
    }
  })
}
