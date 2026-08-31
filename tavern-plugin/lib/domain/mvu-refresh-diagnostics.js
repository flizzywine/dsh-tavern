// Temporary alpha probe. Keep payloads content-free; never log caller objects.
export const MVU_REFRESH_DIAGNOSTIC_TAG = '[DEBUG-mvu-refresh-v1]'
const stages = new Set(['server-view', 'server-publish', 'server-dedup', 'server-subscribe', 'server-unsubscribe', 'client-view', 'client-sse', 'client-sse-error', 'frame-effect', 'frame-send', 'frame-noop', 'frame-ready', 'frame-resync', 'frame-receive', 'frame-reject', 'frame-applied', 'frame-event-start', 'frame-event-end', 'frame-event-error', 'frame-dom'])
const numbers = ['revision', 'baseRevision', 'currentRevision', 'turn', 'messageCount', 'operationCount', 'eventCount', 'listenerCount', 'mutationCount', 'at']
const identifiers = ['sessionId', 'pageId', 'token', 'event', 'kind']

export function sanitizeMvuRefreshDiagnostic(input) {
  if (!input || !stages.has(input.stage)) return null
  const entry = { stage: input.stage }
  for (const key of numbers) {
    if (Number.isSafeInteger(input[key]) && input[key] >= 0) entry[key] = input[key]
  }
  for (const key of identifiers) {
    if (typeof input[key] === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(input[key])) entry[key] = input[key]
  }
  return entry
}

export function logMvuRefreshDiagnostic(input, logger = console) {
  const entry = sanitizeMvuRefreshDiagnostic(input)
  if (!entry) return false
  // A broken diagnostic sink must never affect state or event delivery.
  try { logger.info(MVU_REFRESH_DIAGNOSTIC_TAG, JSON.stringify({ ...entry, loggedAt: Date.now() })) } catch {}
  return true
}
