import { createHash } from 'node:crypto'
import { redactDiagnostic } from './mvu-diagnostics.js'

const maxBytes = 2 * 1024 * 1024
const maxRecordBytes = 128 * 1024
const pathFor = chatId => 'diagnostics/scene-' + createHash('sha256').update(String(chatId)).digest('hex') + '.json'

export function redactSceneDiagnostic(value, secrets = [], depth = 0) {
  if (depth > 24) return '[depth limit]'
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[image bytes omitted]'
  if (typeof value === 'string') {
    for (const secret of secrets.filter(item => typeof item === 'string' && item)) value = value.replaceAll(secret, '[REDACTED]')
    return redactDiagnostic(value.replace(/data:image\/[^\s"']+/gi, '[image bytes omitted]'))
  }
  if (Array.isArray(value)) return value.map(item => redactSceneDiagnostic(item, secrets, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(?:base64|b64_json|image_data|image_bytes|image_base64)$/i.test(key) || value.type === 'image' && key === 'data' ? '[image bytes omitted]'
      : /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret)$/i.test(key) ? '[REDACTED]'
        : redactSceneDiagnostic(item, secrets, depth + 1)]))
  return value
}

function bounded(record) {
  if (Buffer.byteLength(JSON.stringify(record)) <= maxRecordBytes) return record
  // Keep identity, outcomes and timing when a huge workflow/plan must be omitted.
  const { details, ...summary } = record
  return { ...summary, truncated: true, details: { omitted: 'attempt-details-size-limit', preview: JSON.stringify(details).slice(0, 16000) } }
}

/** Bounded attempt journal. Separate from paid job state: a failed diagnostic
 * write is never permission to retry a provider request. */
export function createSceneImageDiagnostics(store) {
  return {
    async record(chatId, value, secrets = []) {
      if (!chatId || !value?.requestId || !value.targetKey) return
      const clean = redactSceneDiagnostic(value, secrets)
      const at = Date.now()
      await store.updateJson(pathFor(chatId), previous => {
        const records = previous?.records || []
        const old = records.find(item => item.requestId === clean.requestId && item.targetKey === clean.targetKey)
        const events = [...(old?.events || [])]
        const last = events.at(-1)
        if (!last || last.stage !== clean.stage || last.status !== clean.status || clean.event) events.push({ at, stage: clean.stage, status: clean.status, ...(clean.event ? { event: clean.event } : {}) })
        const stageDurationsMs = {}
        for (let index = 0; index < events.length; index++) {
          const event = events[index]
          if (event.status !== 'running') continue
          stageDurationsMs[event.stage] = (stageDurationsMs[event.stage] || 0) + Math.max(0, (events[index + 1]?.at || at) - event.at)
        }
        const record = bounded({ ...old, ...clean, updatedAt: at, events: events.slice(-100),
          stageDurationsMs,
          droppedEvents: (old?.droppedEvents || 0) + Math.max(0, events.length - 100),
          ...(clean.status !== 'running' ? { durationMs: Math.max(0, at - (clean.createdAt || old?.createdAt || at)) } : {}) })
        const next = records.filter(item => item !== old).concat(record)
        let dropped = previous?.dropped || 0
        while (next.length > 100 || Buffer.byteLength(JSON.stringify(next)) > maxBytes) { next.shift(); dropped++ }
        return { version: 1, chatId, dropped, records: next }
      })
    },
    async read(chatId) {
      return await store.readJson(pathFor(chatId)) || { version: 1, chatId, dropped: 0, records: [] }
    }
  }
}

export function sceneAttemptDiagnostic(sessionId, record, event) {
  const version = record.versions?.find(item => item.requestId === record.requestId)
  return { requestId: record.requestId, targetKey: record.key, sessionId, turn: record.turn, kind: record.kind,
    createdAt: record.createdAt, completedAt: record.completedAt, status: record.status, stage: record.stage,
    outcome: record.outcome, recovery: record.recovery, error: record.error, traceSessionId: record.traceSessionId,
    ...(event ? { event } : {}),
    usage: { status: 'not-provided', note: '文字请求与用量以子 Session 逐次记录为准；未提供的图片用量不推测为零。' },
    details: { configuration: record.configuration, instruction: record.instruction, baseVersionId: record.baseVersionId,
      diagnostics: record.diagnostics, providerTask: record.providerTask, providerRequests: record.providerRequests,
      plan: record.plan, prompt: record.prompt, generation: version?.generation, attachment: version?.attachment,
      versionId: version?.id } }
}
