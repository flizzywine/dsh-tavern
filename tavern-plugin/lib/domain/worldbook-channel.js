// Where a world-book entry asks to be injected.
//
// 'auto'   — the engine decides from the content: static constant bodies join the
//            stable prefix (cache friendly), anything that re-renders每轮 joins the
//            per-round tail.
// 'prefix' — pin to the stable prefix (the session system prompt). Cheap to resend,
//            but any edit to it rewrites the head and drops the provider cache.
// 'tail'   — pin to the per-round tail message. Always next to the newest messages,
//            higher attention, still charged against the token budget.
//
// The value lives in `extensions.tavern_channel` on the entry so SillyTavern
// round-trips keep it; the view exposes it as `channel`.
const str = value => value == null ? '' : String(value)

export const WORLD_BOOK_CHANNELS = Object.freeze(['auto', 'prefix', 'tail'])

export function worldBookChannelValue(value) {
  const text = str(value)
  return WORLD_BOOK_CHANNELS.includes(text) ? text : 'auto'
}

/** The channel an entry pinned, whether it comes from a projection or a raw document. */
export function worldBookChannel(entry) {
  return worldBookChannelValue(entry?.channel ?? entry?.tavernChannel)
}
