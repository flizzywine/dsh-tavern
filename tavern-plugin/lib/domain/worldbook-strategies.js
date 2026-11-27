const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

/** Small registration seam: strategies choose projection; storage stays unchanged. */
export function createWorldbookStrategies({ nativeSkills }) {
  const strategies = new Map()
  function register({ id, label, description = '', project, available = () => true }) {
    if (typeof id !== 'string' || !ID.test(id) || id.length > 96) throw new Error('世界书策略编号无效')
    if (typeof label !== 'string' || !label.trim() || typeof description !== 'string' || typeof project !== 'function') throw new Error('世界书策略缺少名称或投影函数')
    if (id === 'legacy') throw new Error('外部注入策略已停用')
    if (strategies.has(id)) throw new Error('世界书策略已注册：' + id)
    const entry = { id, label: label.trim(), description, project, available }
    strategies.set(id, entry)
    return () => { if (strategies.get(id) === entry) strategies.delete(id) }
  }
  register({ id: 'native-skills', label: '自动注入 + 主动检索', description: '关键词命中后按相关性自动注入最多 5 条，模型可按需检索其余资料', project: nativeSkills })
  return {
    register,
    has: id => strategies.has(id),
    list: () => [...strategies.values()].map(({ id, label, description }) => ({ id, label, description })),
    async listForGame(gameId) {
      const choices = await Promise.all([...strategies.values()].map(async entry => {
        if (!await entry.available(gameId) || strategies.get(entry.id) !== entry) return null
        return { id: entry.id, label: entry.label, description: entry.description }
      }))
      return choices.filter(Boolean)
    },
    async project(input) {
      const id = input.chat?.worldbookStrategy || 'native-skills'
      // Plugin unload preserves the saved preference while restoring built-in retrieval.
      const strategy = strategies.get(id) || strategies.get('native-skills')
      return strategy.project(input)
    }
  }
}
