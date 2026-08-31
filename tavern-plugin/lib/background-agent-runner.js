import { createBackgroundAgentSessions } from './background-agent-sessions.js'
import { createBackgroundAgentTask } from './background-agent-task.js'

export { executeBackgroundCompaction } from './background-agent-sessions.js'
export { maximumBackgroundTokens } from './background-agent-task.js'

// Preserve the host interface while keeping session ownership separate from task work.
export function createBackgroundAgentRunner(options) {
  const task = createBackgroundAgentTask(options || {})
  return createBackgroundAgentSessions(options, task)
}
