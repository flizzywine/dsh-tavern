// 生图链路诊断日志（默认关闭、旁路、只写本机）。
// 开关文件：<插件目录>/diagnostics.json，例如：
//   { "enabled": true, "contentMode": "full", "nextTraceOnly": true }
// nextTraceOnly=true 时，开始一次记录后本模块会把开关文件改回 enabled:false。
// 设计约束：本模块任何函数都不抛异常、不改变调用方的数据；关闭时尽量零开销。
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULTS = { enabled: false, contentMode: 'summary', nextTraceOnly: true, maxTraces: 10, maxTotalBytes: 20 * 1024 * 1024, retentionHours: 24, maxFieldChars: 200000 }
const SECRET_KEYS = /(authorization|cookie|token|api[-_]?key|secret|password|passwd|bearer)/i

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex')
}

export function createDiagnostics({ root, logger, secrets = () => [] } = {}) {
  const switchPath = join(root, 'diagnostics.json')
  const baseDir = join(root, 'diagnostics')
  const traces = new Map() // traceId -> { dir, seq, mode, bytes }
  const jobTrace = new Map() // jobId -> { traceId, imageIndex }
  let errors = 0
  let completedBytes = 0

  const readSwitch = () => {
    try { return { ...DEFAULTS, ...JSON.parse(readFileSync(switchPath, 'utf8')) } } catch { return { ...DEFAULTS } }
  }
  const redact = text => {
    let out = String(text)
    for (const secret of secrets() ?? []) {
      const s = String(secret ?? '')
      if (s.length >= 6) out = out.split(s).join('[REDACTED]')
    }
    return out.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
  }
  // 只把"像密钥的键名"下的字符串值换掉；数字（例如 token 用量）保留。
  const scrub = (value, depth = 0) => {
    if (depth > 12) return '[depth]'
    if (typeof value === 'string') return redact(value)
    if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1))
    if (value && typeof value === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(value)) out[k] = (SECRET_KEYS.test(k) && typeof v === 'string') ? '[REDACTED]' : scrub(v, depth + 1)
      return out
    }
    return value
  }
  // full 模式保留文本；summary 模式只留哈希和长度。
  const content = (trace, text) => {
    const s = String(text ?? '')
    if (trace.mode !== 'full') return { sha256: sha256(s), chars: s.length }
    if (s.length > trace.maxFieldChars) return { text: s.slice(0, trace.maxFieldChars), truncated: true, chars: s.length, sha256: sha256(s) }
    return { text: s, chars: s.length, sha256: sha256(s) }
  }
  const prune = cfg => {
    try {
      mkdirSync(baseDir, { recursive: true })
      const now = Date.now()
      for (const [id, trace] of traces) {
        if (now - trace.updatedAt > Math.max(1, cfg.retentionHours) * 3600e3) {
          traces.delete(id)
          for (const job of trace.jobs) jobTrace.delete(job)
        }
      }
      const dirs = readdirSync(baseDir).filter(name => !traces.has(name)).map(name => {
        const dir = join(baseDir, name)
        let bytes = 0, mtime = 0
        try {
          for (const f of readdirSync(dir, { recursive: true })) {
            try { const st = statSync(join(dir, String(f))); if (st.isFile()) bytes += st.size; mtime = Math.max(mtime, st.mtimeMs) } catch {}
          }
        } catch {}
        return { dir, bytes, mtime }
      }).sort((a, b) => b.mtime - a.mtime)
      const activeBytes = [...traces.values()].reduce((sum, trace) => sum + trace.bytes, 0)
      completedBytes = 0
      dirs.forEach((d, i) => {
        const old = now - d.mtime > cfg.retentionHours * 3600e3
        if (old || i >= Math.max(0, cfg.maxTraces - traces.size - 1) || activeBytes + completedBytes + d.bytes > cfg.maxTotalBytes) {
          rmSync(d.dir, { recursive: true, force: true })
        } else completedBytes += d.bytes
      })
    } catch { errors++ }
  }

  function begin(meta = {}) {
    try {
      const cfg = readSwitch()
      if (cfg.enabled !== true) return null
      if (cfg.nextTraceOnly !== false) {
        try { writeFileSync(switchPath, JSON.stringify({ ...cfg, enabled: false, lastTraceAt: new Date().toISOString() }, null, 2)) } catch { errors++ }
      }
      prune(cfg)
      const traceId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)
      const dir = join(baseDir, traceId)
      mkdirSync(dir, { recursive: true })
      traces.set(traceId, { dir, seq: 0, mode: cfg.contentMode === 'full' ? 'full' : 'summary', bytes: 0, maxBytes: cfg.maxTotalBytes, maxFieldChars: cfg.maxFieldChars, jobs: new Set(), ended: false, updatedAt: Date.now() })
      record(traceId, 'trace-begin', { schemaVersion: 1, contentMode: cfg.contentMode, ...meta })
      logger?.info?.('dsh-tavern-image: 诊断记录已开始 ' + traceId)
      return traceId
    } catch { errors++; return null }
  }

  // payload 里形如 { $text: '...' } 的字段会按 contentMode 处理为全文或哈希。
  function record(traceId, stage, payload = {}, extra = {}) {
    if (!traceId) return
    const trace = traces.get(traceId)
    if (!trace) return
    try {
      const shaped = JSON.parse(JSON.stringify(payload ?? {}, (k, v) => (v && typeof v === 'object' && '$text' in v) ? content(trace, v.$text) : v))
      const line = JSON.stringify({ traceId, seq: ++trace.seq, at: new Date().toISOString(), stage, ...extra, data: scrub(shaped) }) + '\n'
      const bytes = Buffer.byteLength(line)
      const total = completedBytes + [...traces.values()].reduce((sum, item) => sum + item.bytes, 0)
      if (total + bytes > trace.maxBytes) {
        if (!trace.overflow) {
          trace.overflow = true
          const marker = JSON.stringify({ traceId, stage: 'log-capacity-reached', note: '后续事件未记录，本次证据不完整' }) + '\n'
          const markerBytes = Buffer.byteLength(marker)
          if (total + markerBytes <= trace.maxBytes) {
            appendFileSync(join(trace.dir, 'events.jsonl'), marker)
            trace.bytes += markerBytes
          }
        }
        return
      }
      trace.bytes += bytes
      trace.updatedAt = Date.now()
      appendFileSync(join(trace.dir, 'events.jsonl'), line)
    } catch { errors++ }
  }

  const release = (id, trace) => {
    if (!trace.ended || trace.jobs.size) return
    completedBytes += trace.bytes
    traces.delete(id)
  }
  const end = id => {
    const trace = traces.get(id)
    if (trace) { trace.ended = true; release(id, trace) }
  }
  const bindJob = (jobId, traceId, imageIndex) => {
    const trace = traces.get(traceId)
    if (!trace || !jobId) return
    const id = String(jobId)
    trace.jobs.add(id)
    jobTrace.set(id, { traceId, imageIndex })
  }
  const finishJob = jobId => {
    const id = String(jobId)
    const hit = jobTrace.get(id)
    if (!hit) return
    jobTrace.delete(id)
    const trace = traces.get(hit.traceId)
    if (trace) { trace.jobs.delete(id); release(hit.traceId, trace) }
  }
  const recordJob = (jobId, stage, payload) => {
    const hit = jobTrace.get(String(jobId))
    if (hit) record(hit.traceId, stage, payload, { imageIndex: hit.imageIndex, jobId: String(jobId) })
  }
  const text = value => ({ $text: String(value ?? '') })
  const status = () => ({ active: traces.size, errors })
  return { begin, end, record, bindJob, finishJob, recordJob, text, status }
}
