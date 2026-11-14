// Capacity pressure never compacts under the manual policy: "manual" means the
// player decides when the history is summarized, not that the host gets to
// summarize at 50% of the window behind their back. Provider overflow remains
// the one exception — without that recovery the request simply fails.
export async function compactForegroundIfNeeded({ trigger, native, forced, pressure, scheduled, record, automatic = true }) {
  const overflow = trigger === 'context-overflow'
  if (!automatic && !overflow) return null
  // Keep native pruning, retained-tail policy and bounded retries. In particular,
  // provider overflow must never wait for settlement or retry the background side.
  let result = await native()
  if (!result && !overflow) {
    const budget = await pressure()
    // an output *limit* is not occupied context. A near-window
    // default (DeepSeek: 256k of 258k) must not force compaction at 1% input.
    if (Number.isFinite(budget?.percent) && budget.percent >= 100) result = await forced()
  }
  if (result) {
    await record()
    return result
  }
  if (overflow) return null
  await scheduled()
  return null
}
