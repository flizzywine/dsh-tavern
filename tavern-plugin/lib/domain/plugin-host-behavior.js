// Declarations are scoped by the same ownership checks as other card APIs.
// Deny wins: one plugin cannot re-enable work another active card plugin disabled.
export function createHostBehaviorPolicies({ allowed }) {
  const entries = new Map()
  return {
    register(owner, input) {
      if (!input || Object.keys(input).some(key => key !== 'backgroundAgents') || typeof input.backgroundAgents !== 'boolean') throw new TypeError('hostBehavior 需要 { backgroundAgents: boolean }')
      if (entries.has(owner)) throw new Error('插件已声明宿主行为')
      const entry = { backgroundAgents: input.backgroundAgents }
      entries.set(owner, entry)
      return () => { if (entries.get(owner) === entry) entries.delete(owner) }
    },
    async forGame(gameId) {
      for (const [owner, entry] of entries) {
        if (!entry.backgroundAgents && await Promise.resolve().then(() => allowed(owner, gameId)).catch(() => false)) return { backgroundAgents: false }
      }
      return { backgroundAgents: true }
    }
  }
}
