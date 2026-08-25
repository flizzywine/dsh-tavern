export async function waitForAgentSession(options) {
  const registry = options.registry
  const sessionId = options.sessionId
  const sleep = options.sleep
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : 321
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs >= 0 ? options.intervalMs : 25

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const agent = registry !== undefined && typeof registry.get === 'function' ? registry.get(sessionId) : undefined
    if (agent !== undefined && agent.session !== undefined) return agent
    if (attempt + 1 < attempts) await sleep(intervalMs)
  }

  throw new Error('无法写入 DSH 会话开场白: ' + sessionId)
}
