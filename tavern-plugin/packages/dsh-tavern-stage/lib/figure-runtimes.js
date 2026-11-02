// Runtime files stay private to their owner. Routes use the authenticated host dispatcher.
export function createFigureRuntimes() {
  const entries = new Map()
  let registry, disposed = false
  function attach(kind, entry) {
    if (!registry) return
    const {files, routes = {}} = entry.definition
    entry.release = registry.register('stage.figure.' + kind, {
      methods:Object.keys(routes),
      call:(method, args, authority, serverTemplate) => routes[method](args, authority, serverTemplate, files)
    })
  }
  return Object.freeze({
    register(kind, definition) {
      if (disposed) throw new Error('Figure runtimes disposed')
      if (entries.has(kind)) throw new Error('Figure runtime already registered: ' + kind)
      const entry = {definition}
      attach(kind, entry)
      entries.set(kind, entry)
      return () => {
        if (entries.get(kind) !== entry) return
        entry.release?.()
        entries.delete(kind)
      }
    },
    available:async kind => !disposed && !!(await entries.get(kind)?.definition.files?.available?.()),
    bind(requests) {
      if (registry || disposed) throw new Error('Figure runtimes already bound or disposed')
      registry = requests
      try {for (const [kind, entry] of entries) attach(kind, entry)}
      catch (error) {
        for (const entry of entries.values()) {entry.release?.();entry.release = null}
        registry = null
        throw error
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const entry of entries.values()) entry.release?.()
      entries.clear()
    }
  })
}
