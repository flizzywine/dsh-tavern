// llm/stream hooks re-dispatch rewritten requests as NEW objects, and other hooks
// copy them again ({ ...request }). An identity guard (WeakSet) recognizes only
// the exact object a hook created, so two re-dispatching hooks re-process each
// other's copies forever (issue #146: projection and workspace presentation
// ping-ponged until the host heap ran out). The lineage mark is an enumerable
// symbol property: spread/Object.assign copy it, JSON and providers never see it.
// Marking returns a copy: the request may belong to the host or another hook, and
// the host may hand it over frozen (issue #148: manual story compaction failed).
const HANDLED = Symbol.for('dsh-tavern.request-handled')

/** A copy of the request recording that `stage` produced it (and every copy derived from it). */
export function markRequestHandled(request, stage) {
  if (request === null || typeof request !== 'object') return request
  const previous = Array.isArray(request[HANDLED]) ? request[HANDLED] : []
  return { ...request, [HANDLED]: Object.freeze(previous.includes(stage) ? previous : previous.concat(stage)) }
}

/** True when `stage` already produced this request or an ancestor it was copied from. */
export function requestHandledBy(request, stage) {
  return request !== null && typeof request === 'object' && Array.isArray(request[HANDLED]) && request[HANDLED].includes(stage)
}
