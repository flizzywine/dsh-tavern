/** Native capacity protection is independent of Tavern's optional round schedule. */
export async function compactForegroundIfNeeded({ trigger, native, forced, pressure, scheduled, record }) {
  // Keep native pruning, retained-tail policy and bounded retries. In particular,
  // provider overflow must never wait for settlement or retry the background side.
  let result = await native()
  if (!result && trigger !== 'context-overflow') {
    const budget = await pressure()
    // an output *limit* is not occupied context. A near-window
    // default (DeepSeek: 256k of 258k) must not force compaction at 1% input.
    if (Number.isFinite(budget?.percent) && budget.percent >= 100) result = await forced()
  }
  if (result) {
    await record()
    return result
  }
  if (trigger === 'context-overflow') return null
  await scheduled()
  return null
}
