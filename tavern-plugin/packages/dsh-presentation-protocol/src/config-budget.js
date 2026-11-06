const bounded = (value, fallback, max) => Number.isInteger(value) && value > 0 ? Math.min(max, value) : fallback
export function normalizeStageBudget(value = {}) {
  return { maxToolCalls: bounded(value.maxToolCalls, 6, 64), maxBeatsPerCall: bounded(value.maxBeatsPerCall, 8, 64), maxOpsPerCall: bounded(value.maxOpsPerCall, 32, 256) }
}
