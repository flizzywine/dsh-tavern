/**
 * What the player sees while a plugin settles a turn: which plugin, and whether its
 * agents (sessions created under the game) are still producing model output.
 */
export function createPluginSettlementProgress({ now = Date.now } = {}) {
  const runs = new Map()
  return Object.freeze({
    begin(gameId, plugin) {
      const run = { phase: 'preparing', startedAt: now(), lastProgressAt: now(), plugin }
      runs.set(gameId, run)
      return () => { if (runs.get(gameId) === run) runs.delete(gameId) }
    },
    /** `start` a model request, `output` received, `end` of the request. */
    model(gameId, event) {
      const run = runs.get(gameId)
      if (!run) return
      if (event === 'start') { run.phase = 'model'; run.lastProgressAt = now() }
      else if (event === 'output') run.lastProgressAt = now()
      else if (event === 'end') run.phase = 'tool'
    },
    snapshot(gameId) {
      const run = runs.get(gameId)
      return run ? { ...run } : null
    }
  })
}
