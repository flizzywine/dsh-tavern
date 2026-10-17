// Session → live Agent lookup for surface writes that must open an edit turn.
// Released V4 numbers the next turn from agent.phase.lastTurn, so a write that
// opens a turn while the Agent is idle has to publish that turn as used.
let resolver = () => undefined

export function setAgentResolver(fn) {
  resolver = typeof fn === 'function' ? fn : () => undefined
}

export function agentForSession(session) {
  try { return resolver(session?.id) } catch { return undefined }
}
