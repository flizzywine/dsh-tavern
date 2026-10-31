// Optional modules contribute model declarations without exposing their runtime.
export function createModelSlotRegistry({warn = () => {}} = {}) {
  const providers = new Map()
  function register(owner, provider) {
    if (!owner || providers.has(owner)) throw new Error('Duplicate model slot owner')
    const entry = {...provider}
    providers.set(owner,entry)
    return () => {if(providers.get(owner) === entry)providers.delete(owner)}
  }
  async function rows() {
    const result = await Promise.all([...providers].map(async([owner,provider]) => {
      try {
        const rows = await provider.rows()
        return providers.get(owner) === provider ? structuredClone(rows) : []
      } catch(error) {try{warn(error)}catch{};return []}
    }))
    return result.flat()
  }
  function scoring() {
    for(const provider of providers.values()) {
      try {
        const config=provider.scoring?.()
        if(config)return structuredClone(config)
      } catch(error) {try{warn(error)}catch{}}
    }
    return null
  }
  return Object.freeze({register,rows,scoring})
}
