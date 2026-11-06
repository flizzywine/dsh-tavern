import { readCompactionPressure, requirePressureNumber } from './compaction-pressure-guard.js'

/** Match the host's next-request route, including defaults before the first header. */
export async function measureForegroundPressure({ agent, signal, pendingMessages = [], projections, defaultModel, llm, meter, logger = console }) {
  if (!agent) return null
  return readCompactionPressure(agent.session, signal, logger, async () => {
    const previous = agent.session.requestHeader()
    const state = projections?.stateOf(agent.session, 'modelSelection')
    const target = state?.pending ?? previous?.config ?? state?.lastUsed ?? defaultModel?.currentSelection()
    if (!target?.provider || !target?.model) throw new Error('Unavailable compaction model selection')
    const info = await llm.resolveModelInfo(target.provider, target.model, signal)
    const capacity = requirePressureNumber(info?.context?.contextWindow, 'capacity', true)
    const envelope = previous ? { ...previous, config: { ...previous.config, ...target } } : undefined
    const pendingTokens = pendingMessages.reduce((sum, message) => sum + meter.estimateMessage(message), 0)
    const inputTokens = requirePressureNumber(meter.measure(agent.session, envelope).totalTokens + pendingTokens, 'input tokens')
    const outputTokens = target.maxTokens ?? info.defaultMaxTokens ?? 0
    return { percent: 100 * inputTokens / capacity, budgetPercent: 100 * (inputTokens + outputTokens) / capacity }
  })
}
