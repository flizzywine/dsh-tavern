import { createHash } from 'node:crypto'
import { redactDiagnostic } from './mvu-diagnostics.js'

// Explicitly audited gaps only. Never claim every unknown property is a function.
export const TAVERN_COMPATIBILITY_CAPABILITIES = Object.freeze([
  ...['scrollChatToBottom', 'showLoader', 'hideLoader', 'unregisterMacro', 'unregisterFunctionTool'].map(name => ({ surface: 'SillyTavern', name, policy: 'noop' })),
  ...['registerMacro', 'registerFunctionTool', 'getRequestHeaders', 'getChatCompletionModel'].map(name => ({ surface: 'SillyTavern', name, policy: 'reject' })),
  ...['generate', 'generateRaw', 'stopGeneration', 'deleteLastMessage', 'deleteMessage', 'clearChat', 'reloadCurrentChat', 'openCharacterChat', 'openGroupChat', 'executeSlashCommandsWithOptions'].map(name => ({ surface: 'SillyTavern', name, policy: 'missing' })),
  ...['generate', 'generateRaw', 'triggerSlash'].map(name => ({ surface: 'TavernHelper', name, policy: 'missing' }))
].map(entry => Object.freeze({ ...entry, id: entry.surface + '.' + entry.name })))

const catalog = new Map(TAVERN_COMPATIBILITY_CAPABILITIES.map(entry => [entry.id, entry]))
const types = new Set(['undefined', 'null', 'boolean', 'number', 'bigint', 'string', 'symbol', 'function', 'object'])
const hash = value => createHash('sha256').update(value).digest('hex')

/** Aggregate runtime snapshots separately from Chat, Frames and model-visible state. */
export function createTavernCompatibilityDiagnosticStore(storage, { maxRecords = 400 } = {}) {
  maxRecords = Math.max(1, Math.min(400, Number(maxRecords) || 400))
  const path = id => 'diagnostics/compatibility-' + hash(String(id)) + '.json'
  return {
    async record(sessionId, runtimeId, input) {
      if (!sessionId || typeof runtimeId !== 'string' || !runtimeId || runtimeId.length > 200) return
      const incoming = (Array.isArray(input) ? input : []).slice(0, 64).flatMap(item => {
        const entry = catalog.get(item?.capabilityId)
        if (!entry || typeof item.scriptId !== 'string' || !item.scriptId || item.scriptId.length > 200 || !Number.isSafeInteger(item.count) || item.count < 1) return []
        return [{
          key: hash(JSON.stringify([runtimeId, item.scriptId, entry.id])),
          runtimeId: hash(runtimeId), scriptId: redactDiagnostic(item.scriptId),
          scriptName: redactDiagnostic(String(item.scriptName || '').slice(0, 200)),
          capabilityId: entry.id, operation: entry.policy === 'missing' ? 'lookup' : 'call',
          result: entry.policy === 'missing' ? 'unavailable' : entry.policy === 'noop' ? 'noop' : 'rejected',
          attribution: 'runtime-current-script', count: item.count,
          argumentTypes: entry.policy === 'missing' ? [] : (Array.isArray(item.argumentTypes) ? item.argumentTypes : []).slice(0, 12).map(type => types.has(type) ? type : 'unknown')
        }]
      })
      if (!incoming.length) return
      await storage.updateJson(path(sessionId), previous => {
        const records = new Map((previous?.records || []).map(record => [record.key, record]))
        const now = Date.now()
        for (const item of incoming) {
          const old = records.get(item.key)
          // Cumulative snapshots make retries and out-of-order deliveries idempotent.
          if (old && old.count >= item.count) continue
          records.delete(item.key)
          records.set(item.key, { ...item, firstSeenAt: old?.firstSeenAt || now, lastSeenAt: now })
        }
        let dropped = Number(previous?.dropped) || 0
        while (records.size > maxRecords) { records.delete(records.keys().next().value); dropped++ }
        return { version: 1, sessionId, dropped, records: [...records.values()] }
      })
    },
    async read(sessionId) {
      return await storage.readJson(path(sessionId)) || { version: 1, sessionId, dropped: 0, records: [] }
    }
  }
}
