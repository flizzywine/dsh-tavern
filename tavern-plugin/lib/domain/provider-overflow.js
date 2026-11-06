// Provider wording that means "context window exceeded" but that DSH's
// classifier (dsh-llm + pi-ai) does not recognize yet. Without the standard
// code, DSH skips its compact-and-retry recovery and surfaces the raw error.
const UNRECOGNIZED_OVERFLOW = [
  /prompt exceeds max length/i, // Zhipu GLM, error code 1261
]

export const CONTEXT_WINDOW_EXCEEDED = 'CONTEXT_WINDOW_EXCEEDED'

/** Any failure that means the request did not fit the model's context window. */
export function isContextOverflow(failure) {
  return failure?.code === CONTEXT_WINDOW_EXCEEDED
    || /maximum context length|context (?:length|window) (?:exceeded|limit exceeded)/i.test(failure?.message || '')
    || isUnrecognizedOverflow(failure)
}

export function isUnrecognizedOverflow(failure) {
  if (!failure || failure.code === CONTEXT_WINDOW_EXCEEDED) return false
  const text = [failure.message, failure.detail, failure.body].filter(value => typeof value === 'string').join('\n')
  return UNRECOGNIZED_OVERFLOW.some(pattern => pattern.test(text))
}

/** agent/request-error handler: relabel before later handlers read the code. */
export function normalizeProviderOverflow(payload, next) {
  if (isUnrecognizedOverflow(payload?.failure)) payload.failure = { ...payload.failure, code: CONTEXT_WINDOW_EXCEEDED }
  return next()
}
