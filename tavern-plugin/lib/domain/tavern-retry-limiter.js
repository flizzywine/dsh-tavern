import { sessionEvents } from './session-events.js'
import { randomUUID } from 'node:crypto'

const POLICY_KEY = 'dsh-tavern:max-attempts:2'
const MAX_RETRIES = 1

function retryable(payload) {
  const policy = payload && payload.retryPolicy
  if (!policy) return false
  // Overflow is recovered by compacting, not by resending the same request.
  if (payload.failure && payload.failure.code === 'CONTEXT_WINDOW_EXCEEDED') return false
  if (policy.mode === 'always') return true
  return Array.isArray(policy.retryableCodes) && policy.retryableCodes.includes(payload.failure && payload.failure.code)
}

function priorRetry(session, payload) {
  const events = sessionEvents(session)
  return events.findLast(function (event) {
    const data = event && event.data
    return event && event.type === 'llm/retry' && data &&
      data.turn === payload.turn && data.step === payload.step &&
      data.provider === payload.provider && data.policyKey === POLICY_KEY
  })
}

function cancellableDelay(delayMs, signal) {
  if (signal && signal.aborted) return Promise.resolve(false)
  return new Promise(function (resolve) {
    const timer = setTimeout(function () {
      if (signal) signal.removeEventListener('abort', abort)
      resolve(true)
    }, delayMs)
    function abort() {
      clearTimeout(timer)
      resolve(false)
    }
    if (signal) signal.addEventListener('abort', abort, { once: true })
  })
}

export function createTavernRetryLimiter(options = {}) {
  const owns = typeof options.owns === 'function' ? options.owns : function () { return false }
  const wait = typeof options.wait === 'function' ? options.wait : cancellableDelay
  const id = typeof options.id === 'function' ? options.id : function () { return randomUUID() }
  // 设置 › 高级 › 请求失败自动重试. Off ends the failed request here: neither this
  // limiter nor DSH's own retry policy (dsh-llm-retry, up to five requests) runs.
  const enabled = typeof options.enabled === 'function' ? options.enabled : function () { return true }

  // An unreadable settings file keeps the shipped behaviour instead of failing the turn.
  async function retryAllowed() {
    try { return await enabled() !== false } catch { return true }
  }

  async function handle(payload, next) {
    if (!await owns(payload.agent)) return next()
    if (!retryable(payload)) return next()
    if (!await retryAllowed()) return undefined
    const session = payload.agent && payload.agent.session
    if (!session || typeof session.append !== 'function') return next()
    const previous = priorRetry(session, payload)
    const previousRetry = Number(previous && previous.data && previous.data.retry) || 0
    if (previousRetry >= MAX_RETRIES) return undefined

    const retry = previousRetry + 1
    const retryId = previous && previous.data && previous.data.retryId || id()
    const configuredDelay = Number(payload.retryPolicy && payload.retryPolicy.initialDelayMs)
    const delayMs = Number.isFinite(configuredDelay) && configuredDelay > 0 ? configuredDelay : 500
    session.append('llm/retry', {
      retryId,
      turn: payload.turn,
      step: payload.step,
      provider: payload.provider,
      mode: 'normal',
      policyKey: POLICY_KEY,
      retry,
      maxRetries: MAX_RETRIES,
      delayMs,
      failure: payload.failure
    })
    if (!await wait(delayMs, payload.signal)) return undefined
    session.append('llm/retry-started', { retryId, turn: payload.turn, step: payload.step, retry })
    return { kind: 'retry' }
  }

  return Object.freeze({ handle })
}
