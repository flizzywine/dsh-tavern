import { randomUUID } from 'node:crypto'

// Best effort display only. The existing HTTP path still owns submission,
// recovery and completion. ComfyUI reports steps for the current node.
export function createComfyProgress({ connect = (url, headers) => new WebSocket(url, { headers }) } = {}) {
  let current = null
  let disposed = false

  function close() {
    const previous = current
    current = null
    if (!previous) return
    clearTimeout(previous.timeout)
    try { previous.socket?.close() } catch {}
  }

  function sweep(endpoint, isActive) {
    if (!current) return
    if (endpoint !== current.endpoint) { close(); return }
    for (const [id, job] of current.jobs) {
      if (!isActive(job) || job.comfyId !== id || job.controller?.signal.aborted) current.jobs.delete(id)
    }
    if (!current.jobs.size) close()
  }

  function watch(endpoint, headers, job) {
    if (disposed || !endpoint || !job.comfyId) return undefined
    if (current?.endpoint !== endpoint) {
      close()
      const clientId = randomUUID()
      const connection = { endpoint, clientId, jobs: new Map(), socket: null }
      current = connection
      try {
        const url = new URL(endpoint + '/ws')
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('clientId', clientId)
        const socket = connect(url, headers)
        connection.socket = socket
        connection.timeout = setTimeout(() => { try { socket.close() } catch {} }, 5000)
        connection.timeout.unref?.()
        const clearConnectTimeout = () => clearTimeout(connection.timeout)
        socket.addEventListener('open', clearConnectTimeout)
        socket.addEventListener('close', clearConnectTimeout)
        socket.addEventListener('error', clearConnectTimeout)
        socket.addEventListener('message', ({ data }) => {
          if (current !== connection || typeof data !== 'string' || data.length > 4096) return
          let event
          try { event = JSON.parse(data) } catch { return }
          if (event?.type !== 'progress') return
          const { prompt_id: id, value, max } = event.data ?? {}
          const target = connection.jobs.get(id)
          if (!target || id !== target.comfyId || target.controller?.signal.aborted || !['pending', 'running'].includes(target.state)) return
          if (!Number.isFinite(value) || !Number.isFinite(max) || value <= 0 || max <= 0 || value > max) return
          target.percent = Math.max(target.percent || 0, Math.min(99, Math.floor(100 * value / max)))
        })
      } catch { /* A proxy or old runtime can lack WebSocket support. */ }
    }
    current.jobs.set(job.comfyId, job)
    return current.clientId
  }

  return { watch, sweep, dispose() { disposed = true; close() } }
}
