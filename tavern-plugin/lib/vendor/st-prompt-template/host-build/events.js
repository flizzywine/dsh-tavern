/** Awaitable per-instance events; ordering matches upstream makeFirst/makeLast usage. */
export function createTemplateEvents() {
  const listeners = new Map()
  const api = {
    on(name, fn) {
      if (typeof name !== 'string' || !name || typeof fn !== 'function') throw new TypeError('Invalid template event listener')
      const list = listeners.get(name) || []
      if (!list.includes(fn)) list.push(fn)
      listeners.set(name, list)
      return api
    },
    removeListener(name, fn) {
      const list = (listeners.get(name) || []).filter(item => item !== fn)
      if (list.length) listeners.set(name, list); else listeners.delete(name)
      return api
    },
    makeFirst(name, fn) { api.removeListener(name, fn); api.on(name, fn); const list = listeners.get(name); list.unshift(list.pop()); return api },
    makeLast(name, fn) { api.removeListener(name, fn); return api.on(name, fn) },
    once(name, fn) { const once = async (...args) => { api.removeListener(name, once); return await fn(...args) }; return api.on(name, once) },
    async emit(name, ...args) { for (const fn of [...(listeners.get(name) || [])]) await fn(...args) },
    clear() { listeners.clear() },
    count() { return [...listeners.values()].reduce((sum, list) => sum + list.length, 0) }
  }
  return api
}
