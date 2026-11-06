// Normalize only the text handed to Tavern's native skill provider. Keep the
// host filesystem, permissions, watchers and on-disk user files untouched.
export function createSkillTextContext(ctx) {
  const wrappers = new WeakMap()
  return new Proxy(ctx, {
    get(target, key) {
      if (key === 'get') return function (name, ...args) {
        const service = target.get(name, ...args)
        if (name !== 'fs' || !service) return service
        if (!wrappers.has(service)) wrappers.set(service, new Proxy(service, {
          get(fs, property) {
            if (property === 'readText') return async (...readArgs) => (await fs.readText(...readArgs)).replace(/^\uFEFF/, '')
            const value = Reflect.get(fs, property, fs)
            return typeof value === 'function' ? value.bind(fs) : value
          }
        }))
        return wrappers.get(service)
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
