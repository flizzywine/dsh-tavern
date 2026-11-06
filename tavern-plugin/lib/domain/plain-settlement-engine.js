import { plainSettlementPlan } from './background-pipeline.js'
import { settlementTurn } from './chat-session-state.js'
import { producerSource } from './message-source.js'
import { POSTURE_SUBMIT_TOOL_NAME, lastSubmittedPosture, normalizePostureSubmission } from './posture-submission.js'
import { projectAgentMessageText } from './runtime-content-projection.js'
import { settleUserText } from './settlement-turn.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// The settlement of a game without official MVU variables (Wiki「设计：background-task-pipeline」,
// engines 2 and 3): nothing to do when no item wants this turn; otherwise a plugin may replace
// the posture settlement, and Tavern's own background agent runs when none does (or it fails).
// The agent's tools and notes come from the settlement items. Returns { text, result }.
// `deps` is read on each call, so a test may swap a service after creation.
export function createPlainSettlementEngine(deps) {
  // Seam to the plugin layer: a plugin may replace the posture settlement of a game
  // without official MVU. Any failure falls back to Tavern's own settlement.
  async function settleByPlugin({ snapshot, card, signal, backgroundTasksSettings }) {
    const { pluginApi, pluginSettlementProgress } = deps
    const latest = [...(snapshot.messages || [])].reverse().find(message => message?.role === 'assistant')
    const replaced = await pluginApi.replaceSettlement({ gameId: snapshot.sessionId, turn: settlementTurn(snapshot), signal,
      onStart: plugin => pluginSettlementProgress.begin(snapshot.sessionId, plugin),
      text: latest ? projectAgentMessageText(latest, { charName: card && card.name, macroState: snapshot.macroState }) : '',
      posture: str(snapshot.posture), tasks: { posture: backgroundTasksSettings.posture === true } })
    if (!replaced) return null
    const result = replaced.posture ? { ...normalizePostureSubmission({ posture: replaced.posture }, { charName: card && card.name, macroState: snapshot.macroState }) } : {}
    return { text: JSON.stringify({ plugin: replaced.owner, ...result }), result }
  }

  async function runAgent({ snapshot, taskRun, card, signal, trace, backgroundTasksSettings }) {
    const { backgroundModelSelection, postureItem, backgroundAgentRunner, agentRegistry, sessionStore } = deps
    const selection = backgroundModelSelection(snapshot)
    if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
    let submittedPosture = null
    let settlementToolTail = Promise.resolve()
    const plan = plainSettlementPlan({ posture: backgroundTasksSettings.posture ? postureItem : null })
    const run = await backgroundAgentRunner.run({
      onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
      task: 'settlement',
      turn: settlementTurn(snapshot),
      backgroundTasks: backgroundTasksSettings,
      persistent: true,
      persistentSessionId: trace.sessionId,
      rewindTo: taskRun.participantRequest.rewindTo,
      selection,
      messages: [{
        id: 'settle-' + Date.now().toString(36),
        role: 'user',
        regexPlacement: 2,
        content: [{ type: 'text', text: settleUserText(snapshot, backgroundTasksSettings.posture, taskRun.participantRequest.rewindTo == null ? lastSubmittedPosture(trace.sessionId && (agentRegistry.get(trace.sessionId)?.session || sessionStore.get(trace.sessionId))) : '') }],
        source: producerSource('dsh-tavern')
      }],
      system: plan.system,
      tools: plan.tools,
      maxToolCalls: 12,
      sessionId: snapshot.sessionId,
      webSearchEnabled: snapshot.webSearchEnabled === true,
      signal,
      stopToolsWhen: function () { return submittedPosture !== null },
      acceptWithoutText: function () { return submittedPosture !== null },
      onToolCall(call) {
        const pending = settlementToolTail.then(async function () {
          if (!backgroundTasksSettings.posture || !call || call.name !== POSTURE_SUBMIT_TOOL_NAME) {
            return JSON.stringify({ ok: false, retryable: true, error: '当前任务只允许调用人物设计工具和 posture_submit' })
          }
          try {
            submittedPosture = normalizePostureSubmission(call.arguments, {
              charName: card && card.name,
              macroState: snapshot.macroState
            })
            return JSON.stringify({ ok: true })
          } catch (error) {
            return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
          }
        })
        settlementToolTail = pending.catch(function () {})
        return pending
      }
    })
    await settlementToolTail
    if (backgroundTasksSettings.posture && submittedPosture === null) throw new Error('后台 Agent 未调用 posture_submit 提交有效姿势')
    const result = { ...(submittedPosture || {}) }
    trace.sessionId = str(run.traceSessionId)
    trace.boundary = Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
    return { text: str(run.text) || JSON.stringify(result), result }
  }

  async function run(turn) {
    const { snapshot, backgroundTasksSettings } = turn
    if (!backgroundTasksSettings.posture && !await deps.settlementItems.wanted({ gameId: snapshot.sessionId })) return { text: '', result: {} }
    // A plugin replaced this settlement; its validated result is committed like Tavern's own.
    return await settleByPlugin(turn) || await runAgent(turn)
  }

  return Object.freeze({ run })
}
