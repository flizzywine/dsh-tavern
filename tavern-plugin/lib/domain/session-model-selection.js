// DSH 0.2.2 fixes the step model before pre-step and removed the session
// controller's selectForNextRequest. An Agent now owns its selection:
// agent.model.select() records a durable model/selection event for that Session
// only, without saving a global default - the same guarantee the old controller
// call gave us. Keep both routes so one build runs on 0.2.1 and 0.2.2 hosts.

// Returns false on hosts without AgentModel (0.2.1), where the caller's mutable
// selection state stays in charge. Safe to call before every request.
export function applyAgentModelSelection(agent, selection) {
  if (typeof agent?.model?.select !== 'function') return false
  agent.model.select(selection)
  return true
}

export function selectSessionModel({ agent, controller, selection, unsupported = 'DSH 不支持独立会话模型选择' }) {
  if (applyAgentModelSelection(agent, selection)) return
  if (typeof controller?.agents?.selectForNextRequest === 'function') {
    controller.agents.selectForNextRequest(agent, selection)
    return
  }
  throw new Error(unsupported)
}
