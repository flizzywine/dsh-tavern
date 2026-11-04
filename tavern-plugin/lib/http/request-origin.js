// The one browser-origin rule for the Tavern routes and the voice plugin (copied there by its build).
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
