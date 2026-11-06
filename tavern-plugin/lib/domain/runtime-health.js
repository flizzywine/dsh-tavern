import os from 'node:os'

// What the debugging Agent may read about Tavern itself (not a card): how slow recent requests
// were and where the time went, the latest Tavern warnings and errors, and the runtime it runs on.
// Only fixed metadata, timings and Tavern's own log lines; secrets in a line are masked.

const LOG_LIMIT = 200
const LINE_CHARS = 400
const SECRET = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|token=[A-Za-z0-9._-]{8,}|api[_-]?key["':=\s]+[A-Za-z0-9._-]{8,})/gi

function text(args) {
  return args.map(value => value instanceof Error ? value.message : typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) } catch { return String(value) } })()).join(' ')
}

/** Keeps Tavern's own console warnings and errors (lines naming dsh-tavern) in a small ring. */
export function createRuntimeLogBuffer({ now = Date.now } = {}) {
  const lines = []
  function record(level, args) {
    const message = text(args)
    if (!message.includes('dsh-tavern')) return
    lines.push({ at: now(), level, message: message.replace(SECRET, '[已隐藏]').slice(0, LINE_CHARS) })
    if (lines.length > LOG_LIMIT) lines.shift()
  }
  /** Wraps console.warn/error; returns the undo. Output is unchanged. */
  function install(target = console) {
    const original = { warn: target.warn, error: target.error }
    target.warn = function (...args) { record('warn', args); return original.warn.apply(this, args) }
    target.error = function (...args) { record('error', args); return original.error.apply(this, args) }
    return () => { target.warn = original.warn; target.error = original.error }
  }
  return Object.freeze({ install, record, read: () => lines.slice() })
}

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function requestRow(row) {
  return {
    method: row.method, at: new Date(row.receivedAt).toISOString(), durationMs: row.durationMs, failed: row.failed === true,
    eventLoopDelayMaxMs: row.eventLoopDelayMaxMs, concurrent: row.active, activity: row.activity, viewRebuild: row.viewRebuild,
    slowestStages: [...(row.stages || [])].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5)
  }
}

/** One report for the Agent: environment, request timings and recent Tavern log lines. */
export function runtimeHealthReport({ version, performance, logs, process: proc = process, now = Date.now }) {
  const timings = performance.read()
  const durations = timings.recent.map(row => row.durationMs)
  const memory = proc.memoryUsage()
  return {
    tavernVersion: version, node: proc.versions?.node, platform: proc.platform, arch: proc.arch,
    cpus: os.cpus().length, systemMemoryMB: Math.round(os.totalmem() / 1048576), freeMemoryMB: Math.round(os.freemem() / 1048576),
    uptimeMinutes: Math.round(proc.uptime() / 60),
    processMemoryMB: { rss: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576) },
    requests: {
      note: '只记录打开游戏、读取本局视图、开局等页面请求的服务端耗时；不含模型生成时间，也不含浏览器里的渲染卡顿。',
      recentCount: durations.length,
      p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95), maxMs: durations.length ? Math.max(...durations) : 0,
      slow: timings.slow.slice(-20).reverse().map(requestRow),
      openings: timings.openings.slice(-10).reverse().map(requestRow)
    },
    logs: logs.read().slice(-80).reverse().map(line => ({ at: new Date(line.at).toISOString(), level: line.level, message: line.message })),
    generatedAt: new Date(now()).toISOString()
  }
}
