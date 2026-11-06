// Observe response lifetimes without retaining URLs, headers, bodies or sockets.
// This measures only requests that reached the server, not browser queue time.
export function observeHttpRequests(server, report, { now = Date.now, interval = setInterval, cancel = clearInterval } = {}) {
  if (!server?.on) return () => {}
  const active = new Map()
  const samples = []
  let omitted = 0
  const classify = raw => {
    let path
    try { path = new URL(raw || '/', 'http://localhost').pathname } catch { return 'other' }
    if (path === '/plugins/events') return 'plugin-events'
    if (path === '/api/session/list') return 'session-list'
    if (path === '/api/subagents/list') return 'subagent-list'
    if (/^\/api\/dsh-tavern\/(claimTavernScriptWork|heartbeatTavernScriptRuntime|completeTavernHelperEvent|getSession|syncSession|captureDisplayRuntime|sceneImageStatus|getSceneImageSettings|getUpdateStatus)$/.test(path)) return path.split('/').pop()
    if (/^\/api\/dsh-tavern\/(static-assets|remote-assets)(\/|$)/.test(path)) return 'card-assets'
    if (path.startsWith('/api/dsh-tavern/')) return 'tavern-api'
    if (path.startsWith('/api/')) return 'host-api'
    return 'other'
  }
  const listener = (req, res) => {
    if (active.size >= 256) { omitted++; return }
    const key = {}
    const done = () => {
      active.delete(key)
      res.removeListener('finish', done)
      res.removeListener('close', done)
    }
    active.set(key, { at: now(), route: classify(req.url), dispose: done })
    res.once('finish', done)
    res.once('close', done)
  }
  server.on('request', listener)
  const timer = interval(() => {
    const at = now()
    const routes = new Map()
    let oldestMs = 0
    for (const row of active.values()) {
      const ageMs = Math.max(0, at - row.at)
      // HMR intentionally holds an SSE response open for the page lifetime.
      // Include it as occupancy context, but never let it evict real stalls.
      if (row.route !== 'plugin-events') oldestMs = Math.max(oldestMs, ageMs)
      const group = routes.get(row.route) || { route: row.route, count: 0, oldestMs: 0 }
      group.count++; group.oldestMs = Math.max(group.oldestMs, ageMs)
      routes.set(row.route, group)
    }
    if (oldestMs < 3000) return
    samples.push({ at, active: active.size, routes: [...routes.values()] })
    if (samples.length > 30) samples.shift()
    report({ scope: 'requests-received-by-server', sampleIntervalMs: 5000, slowThresholdMs: 3000, trackingLimit: 256, omitted, samples: structuredClone(samples) })
  }, 5000)
  timer?.unref?.()
  return () => {
    cancel(timer)
    server.removeListener('request', listener)
    for (const row of active.values()) row.dispose()
    active.clear()
  }
}
