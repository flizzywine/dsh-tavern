// Optional RPC owners declare a bounded method set. Core routes are reserved.
export function createExtensionRequests({reserved = []} = {}) {
  const core = new Set(reserved), routes = new Map(), owners = new Set()
  const unavailable = () => Object.assign(new Error('Extension request owner unavailable'),{code:'EXTENSION_UNAVAILABLE'})
  function register(owner, provider) {
    if (!owner || owners.has(owner)) throw new Error('Duplicate request owner')
    const methods = [...new Set(provider.methods)]
    if (typeof provider.call !== 'function' || methods.some(method => typeof method !== 'string' || !method || core.has(method) || method.startsWith('gameplay.') || routes.has(method))) throw new Error('Invalid or occupied extension method')
    const entry = {provider,active:true}
    for(const method of methods)routes.set(method,entry)
    owners.add(owner)
    return () => {
      if(!entry.active)return
      entry.active=false;owners.delete(owner)
      for(const method of methods)if(routes.get(method)===entry)routes.delete(method)
    }
  }
  return Object.freeze({register,
    handles:method => routes.has(method),
    remoteRead:method => routes.get(method)?.provider.remoteRead?.(method) === true,
    async call(method,...args) {
      const entry=routes.get(method)
      if(!entry)throw unavailable()
      const result=await entry.provider.call(method,...args)
      if(!entry.active)throw unavailable()
      return result
    }
  })
}
