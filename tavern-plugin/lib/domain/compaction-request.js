import { boundedCompaction } from './bounded-compaction.js'
import { markRequestHandled, requestHandledBy } from './request-lineage.js'

// Internal metadata-only events are persisted on the Session surface but are
// not user utterances. Native compaction replays that surface independently of
// the normal request projection, so omit them at this request boundary too.
export function projectCompactionRequest(request) {
  if (request?.purpose !== 'compaction' || !Array.isArray(request.messages)) return request
  const messages = request.messages.filter(message => !(message?.role === 'user' &&
    Array.isArray(message.content) && message.content.length === 0 &&
    message.source?.kind === 'plugin' &&
    ['dsh-tavern', 'dsh-tavern-failed-turn-cleanup'].includes(message.source.plugin)))
  return messages.length === request.messages.length ? request : { ...request, messages }
}

/**
 * The single Tavern hook for summary requests. Every rewrite of the request
 * (metadata projection, then `prepare`, e.g. the story prompt) is applied here as
 * a plain transformation; only the final summarizer calls re-enter llm/stream.
 * `prepare` returns `{ request, appendix? }`; the appendix text is added to a
 * successful summary as its own block (the native engine keeps every text block).
 * Separate re-dispatching hooks previously re-processed each other's copies
 * (#146) and collided on their lineage marks (#148).
 */
export function installCompactionRequestProjection(ctx, ownsSession, prepare = async request => ({ request })) {
  // Segment requests re-enter llm/stream; copies other hooks make of them stay internal.
  const stream = request => ctx.llm.stream(markRequestHandled(request, 'compaction-projection'))
  ctx.on('llm/stream', (request, next) => {
    if (requestHandledBy(request, 'compaction-projection') || request?.purpose !== 'compaction' || !request.sessionId) return next()
    return (async function * () {
      if (!(await ownsSession(request.sessionId))) { yield* next(); return }
      const prepared = await prepare(projectCompactionRequest(request))
      yield* withAppendix(withTextFallback(ctx, prepared.request, stream), prepared.appendix)
    })()
  })
}

async function* withAppendix(events, appendix) {
  if (!appendix) { yield* events; return }
  let next = 0
  for await (const event of events) {
    if (Number.isInteger(event?.index)) next = Math.max(next, event.index + 1)
    if (event?.type === 'finish' && event.reason?.kind === 'stop') {
      yield { type: 'block-start', index: next, blockType: 'text' }
      yield { type: 'block-end', index: next, block: { type: 'text', text: appendix } }
    }
    yield event
  }
}

// Agents trained to answer through tools (the background Agent above all) can
// reply to the summary request with a tool call or nothing visible, and DSH then
// fails with "no text summary content". Retry once with the history quoted as
// plain data and no tools offered; the cache-friendly first attempt stays first.
async function* withTextFallback(ctx, request, stream) {
  const chunks = []
  for await (const chunk of boundedCompaction(ctx, request, stream)) chunks.push(chunk)
  const finish = chunks.find(chunk => chunk?.type === 'finish')?.reason?.kind
  const text = chunks.some(chunk => chunk?.type === 'block-end' && chunk.block?.type === 'text' && chunk.block.text.trim())
  if (text || !['stop', 'tool'].includes(finish)) { yield* chunks; return }
  ctx.logger?.info?.('Tavern compaction: summary had no text (' + finish + '), retrying as plain text without tools')
  yield* boundedCompaction(ctx, request, stream, { quoted: true })
}
