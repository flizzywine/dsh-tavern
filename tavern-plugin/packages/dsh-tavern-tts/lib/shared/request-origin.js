// Generated from Tavern host HTTP routes by build.mjs; do not edit.
// The one browser-origin rule for the Tavern routes, the voice plugin and the asset library (copied
// there by their builds).
// Callers authenticate first: the host Connection's login cookie admits the request.
// A browser always marks a cross-site request with Origin and/or Sec-Fetch-Site, so a request with
// neither is a non-browser client, such as the desktop app forwarding its own authenticated request
// after removing both headers.
export const DESKTOP_APP_ORIGIN = 'dsh-app://app'

// Origin, when present, names this Host (http or https behind a TLS proxy) or the desktop app.
function originMatchesHost(origin, host) {
  return origin === 'http://' + host || origin === 'https://' + host || origin === DESKTOP_APP_ORIGIN
}

export function isSameOriginRequest({ host, origin, fetchSite }) {
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false
  return !origin || originMatchesHost(origin, host)
}

// The origin an authenticated same-origin request acts for: a browser page's own Origin, or this
// Host over HTTP for the desktop app, so its leases and links resolve like a local page's.
export function requestAuthorityOrigin({ host, origin, fetchSite }) {
  if (!host || !isSameOriginRequest({ host, origin, fetchSite })) return undefined
  return origin && origin !== DESKTOP_APP_ORIGIN ? origin : 'http://' + host
}
