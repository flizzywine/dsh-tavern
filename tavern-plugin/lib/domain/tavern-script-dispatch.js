import { redactDiagnostic } from './mvu-diagnostics.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

export const TAVERN_SCRIPT_EXECUTION_TIMEOUT_MS = 60000
export const TAVERN_SCRIPT_CLAIM_TIMEOUT_MS = 5000

/**
 * Own the lifecycle of Host work that must execute in the browser Tavern
 * sandbox. Signals only wake an executor; this module remains authoritative.
 */
export function createTavernScriptDispatch(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const executionTimeoutMs = Math.max(100, Number(options.executionTimeoutMs || options.timeoutMs) || TAVERN_SCRIPT_EXECUTION_TIMEOUT_MS)
  const claimTimeoutMs = Math.max(100, Number(options.claimTimeoutMs) || TAVERN_SCRIPT_CLAIM_TIMEOUT_MS)
  const presenceTtlMs = Math.max(executionTimeoutMs, Number(options.presenceTtlMs) || 120000)
  const publishSignal = typeof options.publishSignal === 'function' ? options.publishSignal : function () {}
  const records = new Map()
  const presence = new Map()
  const readyListeners = new Set()
  const settledListeners = new Set()
  let sequence = 0
  let leaseSequence = 0

  function publishReady(sessionId) {
    for (const listener of readyListeners) {
      try { listener(sessionId) } catch {}
    }
  }

  function resolveRecord(id, record, result) {
    if (records.get(id) !== record) return false
    records.delete(id)
    if (record.claimTimer !== null) clearTimeout(record.claimTimer)
    if (record.offerTimer !== null) clearTimeout(record.offerTimer)
    if (record.executionTimer !== null) clearTimeout(record.executionTimer)
    record.resolve(result)
    return true
  }

  function touch(sessionId, runtimeId = 'legacy', ready = false, initializationError = '') {
    const id = str(sessionId)
    const owner = str(runtimeId)
    if (id === '' || owner === '') return false
    const current = presence.get(id)
    if (current && current.owner !== owner && now() - current.seenAt <= presenceTtlMs) return false
    const wasReady = Boolean(current && current.owner === owner && now() - current.seenAt <= presenceTtlMs && current.ready === true)
    const error = redactDiagnostic(str(initializationError).slice(0, 4000)).trim()
    ready = ready === true && error === ''
    presence.set(id, { owner, seenAt: now(), ready, ...(error ? { initializationError: error } : {}) })
    if (error) {
      const record = records.get(id)
      if (record) resolveRecord(id, record, { handled: false, initializationFailed: true, error, args: clone(record.event.args) })
    }
    if (ready && !wasReady) publishReady(id)
    if ((ready && !wasReady) || (error && (!current || current.owner !== owner || now() - current.seenAt > presenceTtlMs || current.initializationError !== error))) {
      for (const listener of settledListeners) { try { listener(id) } catch {} }
    }
    return true
  }

  function available(sessionId, runtimeId = '', requireReady = false) {
    const current = presence.get(str(sessionId))
    if (!current || now() - current.seenAt > presenceTtlMs) return false
    if (str(runtimeId) !== '' && current.owner !== str(runtimeId)) return false
    return requireReady !== true || current.ready === true
  }

  function claim(sessionId, runtimeId = 'legacy', ready = false, initializationError = '') {
    const id = str(sessionId)
    if (!touch(id, runtimeId, ready, initializationError)) return { active: false, ready: false, event: null }
    const runtime = presence.get(id)
    const record = records.get(id)
    if (!runtime.ready || !record) return { active: true, ready: runtime.ready === true, event: null }
    if (record.phase === 'executing') return { active: true, ready: true, event: null }
    if (record.offeredTo !== '' && record.offeredTo !== str(runtimeId)) return { active: true, ready: true, event: null }
    if (record.phase === 'queued') {
      record.phase = 'offered'
      record.offeredTo = str(runtimeId)
      record.leaseToken = record.event.id + ':lease-' + (++leaseSequence)
      if (record.claimTimer !== null) clearTimeout(record.claimTimer)
      record.claimTimer = null
      record.offerTimer = setTimeout(function () {
        if (records.get(id) !== record || record.phase !== 'offered') return
        record.phase = 'queued'
        record.offeredTo = ''
        record.leaseToken = ''
        record.offerTimer = null
        record.claimTimer = setTimeout(function () {
          if (records.get(id) === record && record.phase === 'queued') presence.delete(id)
          resolveRecord(id, record, { handled: false, unavailable: true, claimTimedOut: true, phase: 'queued', args: clone(record.event.args) })
        }, claimTimeoutMs)
        publishSignal(id, { kind: 'runtime-work', version: record.event.id })
      }, claimTimeoutMs)
    }
    return { active: true, ready: true, event: clone(record.event), leaseToken: record.leaseToken }
  }

  function start(sessionId, eventId, leaseToken, runtimeId = 'legacy') {
    const id = str(sessionId)
    if (!available(id, runtimeId)) return { started: false }
    const record = records.get(id)
    if (!record || record.event.id !== str(eventId) || record.offeredTo !== str(runtimeId) || record.leaseToken !== str(leaseToken)) return { started: false }
    if (record.phase === 'executing') return { started: true, alreadyStarted: true }
    if (record.phase !== 'offered') return { started: false }
    record.phase = 'executing'
    if (record.offerTimer !== null) clearTimeout(record.offerTimer)
    record.offerTimer = null
    record.executionTimer = setTimeout(function () {
      resolveRecord(id, record, { handled: false, timedOut: true, phase: 'executing', args: clone(record.event.args) })
    }, executionTimeoutMs)
    return { started: true, alreadyStarted: false }
  }

  function complete(sessionId, eventId, args, runtimeId = 'legacy', leaseToken = '', error = '', diagnostics) {
    const id = str(sessionId)
    if (!available(id, runtimeId)) return false
    const record = records.get(id)
    if (!record || record.phase !== 'executing' || record.event.id !== str(eventId)
      || record.offeredTo !== str(runtimeId) || record.leaseToken !== str(leaseToken)) return false
    const extra = Array.isArray(diagnostics) ? { diagnostics: clone(diagnostics.slice(-50)) } : {}
    const initializationFailed = extra.diagnostics?.some(item => item.kind === 'initialization' && item.initializationFailed)
    const message = initializationFailed ? redactDiagnostic(str(error).slice(0, 4000)).trim() : str(error).trim()
    return resolveRecord(id, record, message === ''
      ? { handled: true, args: clone(Array.isArray(args) ? args : record.event.args), ...extra }
      : { handled: false, error: message, args: clone(Array.isArray(args) ? args : record.event.args), ...extra,
        ...(initializationFailed ? { initializationFailed: true } : {}) })
  }

  async function dispatch(sessionId, name, args = [], context = null, work = {}) {
    const id = str(sessionId)
    const state = status(id)
    if (state.initializationError) return { handled: false, initializationFailed: true, error: state.initializationError, args: clone(args) }
    if (id === '' || !available(id, '', true)) return { handled: false, unavailable: true, args: clone(args) }
    if (records.has(id)) return { handled: false, busy: true, args: clone(args) }
    const event = {
      id: str(work && work.eventId).trim() || 'script-work-' + (++sequence),
      name: str(name),
      args: clone(Array.isArray(args) ? args : []),
      context: clone(context)
    }
    return await new Promise(function (resolve) {
      const record = { event, resolve, phase: 'queued', offeredTo: '', leaseToken: '', claimTimer: null, offerTimer: null, executionTimer: null }
      record.claimTimer = setTimeout(function () {
        // A runtime that stays "ready" but cannot claim signalled work is no
        // longer a usable lease. Keeping that stale presence makes settlement
        // immediately redispatch forever. Its next real claim/heartbeat will
        // register a fresh ready transition and resume the deferred work once.
        if (records.get(id) === record && record.phase === 'queued') presence.delete(id)
        resolveRecord(id, record, { handled: false, unavailable: true, claimTimedOut: true, phase: 'queued', args: clone(event.args) })
      }, claimTimeoutMs)
      records.set(id, record)
      publishSignal(id, { kind: 'runtime-work', version: event.id })
    })
  }

  function subscribeReady(listener) {
    if (typeof listener !== 'function') return function () {}
    readyListeners.add(listener)
    return function () { readyListeners.delete(listener) }
  }

  function subscribeSettled(listener) {
    if (typeof listener !== 'function') return function () {}
    settledListeners.add(listener)
    return function () { settledListeners.delete(listener) }
  }

  function dispose(sessionId, runtimeId = '') {
    const id = str(sessionId)
    if (runtimeId !== '' && !available(id, runtimeId)) return false
    presence.delete(id)
    const record = records.get(id)
    if (!record) return true
    return resolveRecord(id, record, { handled: false, disposed: true, phase: record.phase, args: clone(record.event.args) })
  }

  function status(sessionId) {
    const current = presence.get(str(sessionId))
    const present = Boolean(current && now() - current.seenAt <= presenceTtlMs)
    const record = records.get(str(sessionId))
    return { present, ready: present && current.ready === true, busy: Boolean(record), phase: record ? record.phase : 'idle',
      ...(present && current.initializationError ? { initializationError: current.initializationError } : {}) }
  }

  return Object.freeze({ touch, available, claim, start, complete, dispatch, subscribeReady, subscribeSettled, dispose, status })
}
