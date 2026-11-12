import { markRequestHandled, requestHandledBy } from './request-lineage.js'

// Provider-signed reasoning (Anthropic thinking signatures, OpenAI encrypted reasoning
// items, and relays that carry either over another wire) is valid only after the exact
// conversation it was produced after; Anthropic rejects it anywhere else with 400
// "Invalid signature in thinking block … bound to a different conversation".
// Unsigned reasoning (DeepSeek's reasoning_content) is bound to nothing.

const MARK = 'prefix-bound-reasoning'

/** Whether the adapter's replay metadata carries a signature for one of the message's reasoning blocks. */
export function hasSignedReasoning(message) {
  const blocks = message?.role === 'assistant' ? message.source?.replayState?.blocks : undefined
  return Array.isArray(blocks) && blocks.some(block => block?.type === 'reasoning' && (block.thinkingSignature !== undefined || block.redacted === true))
}

/**
 * The one way a reasoning block leaves a replayed message whose prefix changed.
 * Reasoning is not story content: whole blocks go, including redacted ones. The
 * adapter's replay metadata indexes the original block array and pairs reply items
 * with the dropped reasoning (OpenAI rejects a message item without its reasoning
 * item), so it goes too and the host sends the provider-neutral form.
 * @returns the message itself when it has no reasoning, a copy without it, or null when nothing is left.
 */
export function withoutReplayReasoning(message) {
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return message
  const content = message.content.filter(block => block.type !== 'reasoning')
  if (content.length === message.content.length) return message
  if (!content.length) return null
  const { replayState, ...source } = message.source || {}
  return { ...message, content, ...(message.source ? { source } : {}) }
}

/**
 * Assistant messages whose prefix a surface replacement rewrote after they were produced.
 * A replacement (compaction checkpoint, edited or restored message, trimmed import)
 * keeps the position of what it replaces but takes a new, higher seq, so every older
 * node after it now follows a prefix it was not produced after.
 */
export function rebasedMessageIds(session) {
  const ids = new Set()
  let newest = -1
  for (const seq of session?.surface?.nodes || []) {
    if (seq > newest) { newest = seq; continue }
    const event = session.eventAt(seq)
    if (event?.type === 'assistant/message' && event.data?.message?.id) ids.add(event.data.message.id)
  }
  return ids
}

/** The request with signed reasoning removed from rebased messages; the request itself when there is none. */
export function projectRebasedReasoning(request, session) {
  const rebased = rebasedMessageIds(session)
  if (!rebased.size) return request
  let changed = false
  const messages = request.messages.flatMap(message => {
    if (!rebased.has(message?.id) || !hasSignedReasoning(message)) return [message]
    changed = true
    const kept = withoutReplayReasoning(message)
    return kept ? [kept] : []
  })
  return changed ? { ...request, messages } : request
}

/**
 * Every model request of a Tavern session, whatever its wire API, drops signed reasoning
 * its prefix no longer matches. The projection is a pure function of the surface, so each
 * later request sends the same bytes and the prompt cache holds. Summary requests drop all
 * reasoning in their own projection (compaction-request.js).
 */
export function installPrefixBoundReasoningProjection(ctx, { ownsSession, session }) {
  ctx.on('llm/stream', (request, next) => {
    if (request?.purpose === 'compaction' || !request?.sessionId || requestHandledBy(request, MARK) ||
      !Array.isArray(request.messages) || !request.messages.some(hasSignedReasoning)) return next()
    const projected = projectRebasedReasoning(request, session(request.sessionId))
    if (projected === request) return next()
    return (async function * () {
      if (!(await ownsSession(request.sessionId))) { yield * next(); return }
      yield * ctx.llm.stream(markRequestHandled(projected, MARK))
    })()
  })
}
