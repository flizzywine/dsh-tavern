const secretKey = /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret)$/i

export function redactDiagnostic(value, depth = 0) {
  if (depth > 24) return '[depth limit]'
  if (typeof value === 'string') return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, address => {
      try { const url = new URL(address); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href } catch { return '[URL redacted]' }
    })
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|key|api_key|apiKey|access_token|auth|secret|password)=)[^\s&#"'<>]*/gi, '$1[REDACTED]')
    .replace(/((?:api[-_]?key|access[-_]?token|password|secret|authorization)["']?\s*[=:]\s*["']?)[^\s,;"'<>]+/gi, '$1[REDACTED]')
  if (Array.isArray(value)) return value.map(item => redactDiagnostic(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED]' : redactDiagnostic(item, depth + 1)]))
  return value
}

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
