import { createHash } from 'node:crypto'
import { redactDiagnostic } from './mvu-diagnostics.js'

const tracked = /^(?:.*TavernHelper.*|getFullPromptTemplateState|saveFullPromptTemplateState|saveFullPromptTemplateSettings|saveFullPromptTemplateGlobals|saveTavernChatData|saveTavernExtensionSettings|loadTavernWorldInfo|saveTavernWorldInfo|callOpeningRuntime)$/
const pathFor = id => 'diagnostics/api-calls-' + createHash('sha256').update(id).digest('hex') + '.json'

// Values and property names may contain private story data. Neither is retained.
export function summarizeApiArgument(value) {
  if (value === null) return { type: 'null' }
  if (typeof value === 'string') return { type: 'string', length: value.length }
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (typeof value === 'object') return { type: 'object', fields: Object.keys(value).length }
  return { type: typeof value }
}

function redactApiError(error, args) {
  let text = String(error?.message || error), remaining = 256
  function visit(value, depth = 0) {
    if (remaining-- <= 0 || depth > 8) return
    if (typeof value === 'string' && value.length >= 4) text = text.split(value).join('[argument]')
    else if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child, depth + 1)
  }
  visit(args)
  return redactDiagnostic(text).slice(0, 1000)
}

export function createTavernApiDiagnostics(storage) {
  const buffers = new Map(), tails = new Map(), droppedBuffers = new Map()
  let timer
  function bounded(rows) {
    const failures = rows.filter(row => row.status !== 'success').slice(-200)
    const recent = rows.filter(row => row.status === 'success').slice(-30)
    const keep = new Set([...failures, ...recent])
    return rows.filter(row => keep.has(row))
  }
  function flush(id) {
    const rows = buffers.get(id) || []
    buffers.delete(id)
    const dropped = droppedBuffers.get(id) || 0
    droppedBuffers.delete(id)
    const previous = tails.get(id) || Promise.resolve()
    if (!rows.length) return previous
    const next = previous.catch(() => {}).then(() => storage.updateJson(pathFor(id), old => {
      const all = [...(old?.records || []), ...rows], records = bounded(all)
      return { version: 1, sessionId: id, dropped: (old?.dropped || 0) + dropped + all.length - records.length, records }
    }))
    tails.set(id, next)
    next.finally(() => { if (tails.get(id) === next) tails.delete(id) }).catch(() => {})
    return next
  }
  function record(id, row) {
    const all = [...(buffers.get(id) || []), row]
    const kept = bounded(all)
    droppedBuffers.set(id, (droppedBuffers.get(id) || 0) + all.length - kept.length)
    buffers.set(id, kept)
    if (!timer) {
      timer = setTimeout(() => {
        timer = undefined
        for (const sessionId of buffers.keys()) void flush(sessionId).catch(() => {})
      }, 500)
      timer.unref?.()
    }
  }
  return {
    recordResourceSave(sessionId, summary) {
      if (!sessionId) return
      record(sessionId, { at: Date.now(), method: 'resource-save', ...summary })
    },
    async observe(method, args, run) {
      const sessionId = typeof args?.sessionId === 'string' ? args.sessionId : ''
      if (!tracked.test(method) || !sessionId) return run()
      const started = Date.now(), owner = args?.apiCallOrigin || {}
      const row = { at: started, method, scriptId: redactDiagnostic(String(owner.scriptId || '').slice(0, 200)),
        scriptName: redactDiagnostic(String(owner.scriptName || '').slice(0, 200)),
        eventId: redactDiagnostic(String(args.eventId || owner.eventId || '').slice(0, 200)),
        requestId: redactDiagnostic(String(owner.requestId || '').slice(0, 100)),
        lifecycleRevision: Number.isSafeInteger(args.expectedLifecycleRevision) ? args.expectedLifecycleRevision : null,
        turn: Number.isSafeInteger(args.turn) ? args.turn : null,
        messageId: Number.isSafeInteger(args.option?.message_id) ? args.option.message_id : null,
        attribution: owner.scriptId ? 'runtime-request' : 'unknown',
        arguments: Object.values(args || {}).slice(0, 16).map(summarizeApiArgument) }
      try {
        const result = await run()
        row.status = result?.stale || result?.rejected ? 'rejected' : 'success'
        if (row.status === 'rejected') row.reason = result?.stale ? 'stale-target' : 'operation-not-applied'
        return result
      } catch (error) {
        row.status = /MISMATCH|UNSUPPORTED|CONFLICT|STALE|FORBIDDEN|INVALID/.test(String(error?.code || ''))
          || /不支持|不能|只能|不属于|已过期|无权|拒绝/.test(String(error?.message || '')) ? 'rejected' : 'failed'
        row.errorCode = redactDiagnostic(String(error?.code || '').slice(0, 100))
        row.error = redactApiError(error, args)
        throw error
      } finally {
        row.durationMs = Date.now() - started
        // Diagnostics must never change the result of the observed operation.
        try { record(sessionId, row) } catch {}
      }
    },
    async read(id) {
      await flush(id)
      return await storage.readJson(pathFor(id)) || { version: 1, sessionId: id, dropped: 0, records: [] }
    }
  }
}
