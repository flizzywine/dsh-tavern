// Session → live Agent lookup for surface writes that must open an edit turn.
// Released V4 numbers the next turn from agent.phase.lastTurn, so a write that
// opens a turn while the Agent is idle has to publish that turn as used.
let resolver = () => undefined

export function setAgentResolver(fn) {
  resolver = typeof fn === 'function' ? fn : () => undefined
}

// Only the Agent that holds this very Session. A detached copy (a dry-run
// preview restored from the same log) shares the id, and publishing its edit
// turn on the live Agent would make the next real turn skip a number — an
// invalid V4 log the host then refuses (renumbered by the turn repair, which
// leaves every stored turn reference pointing one turn off).
export function agentForSession(session) {
  try {
    const agent = resolver(session?.id)
    return agent && agent.session !== undefined && agent.session !== session ? undefined : agent
  } catch { return undefined }
}
