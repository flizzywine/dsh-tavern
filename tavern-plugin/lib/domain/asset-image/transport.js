// Only known transport codes cross the diagnostic boundary. Error messages,
// stacks, headers and arbitrary properties may contain credentials or content.
const codes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID'])

export function imageNetworkCodes(error) {
  const result = new Set(), seen = new Set()
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 4) return
    seen.add(value)
    if (codes.has(value.code)) result.add(value.code)
    visit(value.cause, depth + 1)
    if (Array.isArray(value.errors)) for (const child of value.errors.slice(0, 8)) visit(child, depth + 1)
  }
  visit(error, 0)
  return [...result]
}
