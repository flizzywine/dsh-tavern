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

/**
 * The channel a whole book asks its entries to use. Stored on the document root
 * (`extensions.tavern_channel`, with a bare `channel` accepted from hand-written
 * books) so one switch covers every entry that has no channel of its own.
 */
export function worldBookDefaultChannel(book) {
  const extensions = book?.extensions
  const extension = extensions && typeof extensions === 'object' ? extensions.tavern_channel : undefined
  return worldBookChannelValue(book?.channel ?? extension)
}
