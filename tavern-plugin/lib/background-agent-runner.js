import { createBackgroundAgentSessions } from './background-agent-sessions.js'
import { createBackgroundAgentTask } from './background-agent-task.js'

export { executeBackgroundCompaction } from './background-agent-sessions.js'
export { maximumBackgroundTokens } from './background-agent-task.js'

// Preserve the host interface while keeping session ownership separate from task work.
export function createBackgroundAgentRunner(options) {
  const task = createBackgroundAgentTask(options || {})
  const sessions = createBackgroundAgentSessions(options, task)
  return Object.freeze({ ...sessions, async run(input) {
    if (options?.allowRun && !await options.allowRun(input)) {
      sessions.cancel(input.sessionId)
      await sessions.releaseFor(input.sessionId)
      throw Object.assign(new Error('本局插件已关闭后台智能体，请使用前台对话'), { code: 'TAVERN_BACKGROUND_DISABLED' })
    }
    return sessions.run(input)
  } })
}
