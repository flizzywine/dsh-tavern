import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'

const filename = 'update-diagnostics.jsonl'
export function redactUpdateDiagnostic(value, maxLength = 6000) {
  return String(value ?? '').replace(/https?:\/\/[^\s<>"')]+/g, raw => {
    try { const url = new URL(raw); return url.origin + url.pathname } catch { return '[URL]' }
  }).replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]').replace(/((?:authorization|token|password|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, maxLength)
}
export function recordUpdateDiagnostic(dataRoot, record) {
  try {
    mkdirSync(dataRoot, { recursive: true })
    const file = path.join(dataRoot, filename)
    try { if (statSync(file).size > 1024 * 1024) renameSync(file, file + '.1') } catch {}
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...record }, (_, value) => typeof value === 'string' ? redactUpdateDiagnostic(value) : value) + '\n')
  } catch { /* Diagnostics must never prevent an update. */ }
}
export function readUpdateDiagnostics(dataRoot) {
  const records = []
  for (const suffix of ['.1', '']) {
    try {
      for (const line of readFileSync(path.join(dataRoot, filename + suffix), 'utf8').split('\n')) {
        try { if (line) records.push(JSON.parse(line)) } catch {}
      }
    } catch {}
  }
  return { version: 1, records }
}
