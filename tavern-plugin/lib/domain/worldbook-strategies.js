const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

/** Small registration seam: strategies choose projection; storage stays unchanged. */
export function createWorldbookStrategies({ nativeSkills }) {
  const strategies = new Map()
  function register({ id, label, description = '', project }) {
    if (typeof id !== 'string' || !ID.test(id) || id.length > 96) throw new Error('世界书策略编号无效')
    if (typeof label !== 'string' || !label.trim() || typeof description !== 'string' || typeof project !== 'function') throw new Error('世界书策略缺少名称或投影函数')
    if (id === 'legacy') throw new Error('外部注入策略已停用')
    if (strategies.has(id)) throw new Error('世界书策略已注册：' + id)
    const entry = { id, label: label.trim(), description, project }
    strategies.set(id, entry)
    return () => { if (strategies.get(id) === entry) strategies.delete(id) }
  }
  register({ id: 'native-skills', label: '主动检索', description: '关键词提供标题线索，模型按需搜索和读取资料', project: nativeSkills })
  return {
    register,
    has: id => strategies.has(id),
    list: () => [...strategies.values()].map(({ id, label, description }) => ({ id, label, description })),
    async project(input) {
      const id = input.chat?.worldbookStrategy || 'native-skills'
      // Plugin unload preserves the saved preference while restoring built-in retrieval.
      const strategy = strategies.get(id) || strategies.get('native-skills')
      return strategy.project(input)
    }
  }
}
