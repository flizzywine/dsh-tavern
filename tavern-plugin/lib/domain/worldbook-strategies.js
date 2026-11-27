const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

/** Plugins opt into each request. Competing claims use the built-in strategy. */
export function createWorldbookStrategies({ nativeSkills }) {
  const strategies = new Map()
  function register({ id, label, description = '', project, shouldUse }) {
    if (typeof id !== 'string' || !ID.test(id) || id.length > 96) throw new Error('世界书策略编号无效')
    if (typeof label !== 'string' || !label.trim() || typeof description !== 'string' || typeof project !== 'function') throw new Error('世界书策略缺少名称或投影函数')
    if (typeof shouldUse !== 'function') throw new TypeError('世界书策略缺少启用条件')
    if (id === 'legacy' || id === 'native-skills') throw new Error('世界书策略编号由宿主保留')
    if (strategies.has(id)) throw new Error('世界书策略已注册：' + id)
    const entry = { id, project, shouldUse }
    strategies.set(id, entry)
    return () => { if (strategies.get(id) === entry) strategies.delete(id) }
  }
  return {
    register,
    async project(input) {
      if (!strategies.size || (input.purpose && input.purpose !== 'generation')) return nativeSkills(input)
      const entries = [...strategies.values()]
      const enabled = await Promise.all(entries.map(entry => entry.shouldUse(input)))
      const matches = entries.filter((entry, index) => enabled[index] && strategies.get(entry.id) === entry)
      return matches.length === 1 ? matches[0].project(input) : nativeSkills(input)
    }
  }
}
