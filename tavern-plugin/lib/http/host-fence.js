// Opaque card frames are cross-site even for local resources; only Host is shared here.
// Besides loopback, the Connection's configured trustedHosts qualify (exact host:port, or
// a port-less host on any port), so a trusted Serve/HTTPS entry reaches the same public
// assets. This is the official DNS-rebinding fence, never authentication.
export function isTrustedHostRequest(req, trustedHosts = []) {
  const url = parseFenceAuthority(req.headers.host)
  if (url === undefined) return false
  if (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)) return true
  return Array.isArray(trustedHosts) && trustedHosts.some(entry => {
    const trusted = parseFenceAuthority(entry)
    if (trusted === undefined || trusted.hostname !== url.hostname) return false
    return !/:\d+$/.test(entry) || trusted.port === url.port
  })
}

function parseFenceAuthority(value) {
  if (typeof value !== 'string') return undefined
  let url
  try { url = new URL('http://' + value) } catch { return undefined }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined
  return url
}
