import { readCompactionPressure, requirePressureNumber } from './compaction-pressure-guard.js'

// Background maintenance runs inside the owning Agent turn, never through the
// idle Tavern compaction queue (which would wait for this same task to finish).
export async function compactBackgroundIfNeeded({ trigger, forced, native, pressure, automatic = true }) {
  // Native policy owns its threshold, pruning, retained tail and retries. Extra
  // task budgeting must never veto that check, even when metadata is unavailable.
  // Overflow recovery stays enabled under the manual policy: a background task
  // that runs out of window has no other way back.
  if (trigger === 'context-overflow') return forced()
  if (!automatic) return null
  const result = await native()
  if (result) return result
  const budget = await pressure()
  // output allowance alone must never force a tiny task to compact.
  if (!Number.isFinite(budget?.inputTokens) || !Number.isFinite(budget?.capacity)
    || budget.capacity <= 0 || budget.inputTokens < budget.capacity) return null
  return forced()
}

// Use the current task's route and output limit, not the last task's model.
// The meter includes durable system/tools/history; pending messages have not
// entered that surface yet. Provider-confirmed overflow remains the fallback
// for estimation error and models without capacity metadata.
export async function measureBackgroundBudget({ agent, background, signal, llm, meter, pending = [], logger = console }) {
  return readCompactionPressure(agent.session, signal, logger, async () => {
    const selection = background.selection
    const info = await llm.resolveModelInfo(selection.provider, selection.model, signal)
    const capacity = requirePressureNumber(info?.context?.contextWindow, 'capacity', true)
    const previous = agent.session.requestHeader()
    const envelope = previous ? { ...previous, config: { ...previous.config, ...selection } } : undefined
    const inputTokens = requirePressureNumber(meter.measure(agent.session, envelope).totalTokens
      + pending.reduce((sum, message) => sum + meter.estimateMessage(message), 0), 'input tokens')
    return { inputTokens, outputTokens: background.maxTokens ?? info.defaultMaxTokens ?? 0, capacity }
  })
}
