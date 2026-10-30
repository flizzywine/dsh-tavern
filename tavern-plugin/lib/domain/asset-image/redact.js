import { redactDiagnostic } from '../mvu-diagnostics.js'

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
