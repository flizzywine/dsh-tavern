import { createHash } from 'node:crypto'

const MAX_RECORD_BYTES = 32768
const MAX_STORE_BYTES = 2 * 1024 * 1024
const MAX_EXPORT_BYTES = 32 * 1024 * 1024
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

export function sanitizeRuntimeDiagnostics(value) {
  return redactDiagnostic((Array.isArray(value) ? value : []).slice(-50).map(item => ({
    kind: String(item?.kind || '').slice(0, 40), name: String(item?.name || '').slice(0, 100),
    level: item?.level === 'error' ? 'error' : 'warn',
    ready: item?.ready === true, subscribed: item?.subscribed === true, initializationFailed: item?.initializationFailed === true,
    scriptId: String(item?.scriptId || '').slice(0, 200), message: String(item?.message || '').slice(0, 4000)
  })))
}

function bounded(value) {
  const text = JSON.stringify(redactDiagnostic(value))
  if (Buffer.byteLength(text) <= MAX_RECORD_BYTES) return JSON.parse(text)
  return { stage: value.stage, diagnosticId: value.diagnosticId, at: value.at, truncated: true, preview: text.slice(0, 7000) }
}

/** Independent diagnostics: never rewrite chat state or append model-visible messages. */
export function createMvuDiagnosticStore(storage, { maxRecords = 200 } = {}) {
  maxRecords = Math.max(1, Math.min(200, Number(maxRecords) || 200))
  const path = id => 'diagnostics/mvu-' + createHash('sha256').update(String(id)).digest('hex') + '.json'
  return {
    async record(sessionId, value) {
      if (!sessionId) return
      await storage.updateJson(path(sessionId), previous => {
        const records = (previous?.records || []).concat(bounded({ ...value, at: Date.now() }))
        let dropped = Number(previous?.dropped) || 0
        while (records.length > maxRecords || Buffer.byteLength(JSON.stringify(records)) > MAX_STORE_BYTES) { records.shift(); dropped++ }
        return { version: 1, sessionId, dropped, records }
      })
    },
    async read(sessionId) {
      return await storage.readJson(path(sessionId)) || { version: 1, sessionId, dropped: 0, records: [] }
    }
  }
}

export function variableDiagnosticSummary(value) {
  return { hasStatData: Boolean(value && typeof value.stat_data === 'object' && value.stat_data !== null), hasSchema: Boolean(value?.schema), rootKeys: Object.keys(value || {}).slice(0, 40), statKeys: Object.keys(value?.stat_data || {}).slice(0, 40) }
}

// Small bounded STORE ZIP: no external dependency or changes to the native exporter.
export function diagnosticZip(entries) {
  const local = [], central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path), data = Buffer.from(entry.content)
    if (offset + data.length > MAX_EXPORT_BYTES) throw new Error('诊断包超过 32 MiB，请使用原生 Session 导出单独提供日志')
    let crc = 0xffffffff
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(0x21, 12) // Valid DOS date: 1980-01-01.
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); header.copy(directory, 6, 4, 30); directory.writeUInt32LE(offset, 42)
    local.push(header, name, data); central.push(directory, name)
    offset += header.length + name.length + data.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

export async function createMvuDiagnosticExport({ sessionId, backgroundSessionIds = [], store, sessions, persistence, query, attachments, environment = {} }) {
  const notes = ['包含对话文本、附件与变量信息，分享前请检查隐私。凭据已尽力脱敏。MVU 记录有容量限制，旧故障不会被追溯补录。']
  const ids = new Set([sessionId, ...backgroundSessionIds.filter(Boolean)])
  try {
    const lineage = await query?.traceSession(sessionId)
    const visit = nodes => { for (const node of nodes || []) { const id = node.session?.header?.id; if (id && !ids.has(id) && ids.size < 100) { ids.add(id); visit(node.descendants) } } }
    visit(lineage?.descendants)
  } catch { notes.push('无法读取完整 Session 子任务关系；仍包含已知后台 Session。') }
  const entries = []
  const media = new Map()
  const mediaExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
  function collectMedia(value) {
    if (!value || typeof value !== 'object') return
    if (value.type === 'image' && value.attachment && mediaExtensions[value.attachment.mediaType]) media.set(String(value.attachment.attachmentId), value.attachment)
    for (const child of Object.values(value)) if (child && typeof child === 'object') collectMedia(child)
  }
  let bytes = 0
  for (const id of ids) {
    try {
      const live = sessions?.get(id)
      if (live) await sessions.flush(live)
      const raw = await persistence?.readRaw(id)
      if (!raw) { notes.push('缺失 Session 日志：' + id); continue }
      if (bytes + Buffer.byteLength(raw.content) > MAX_EXPORT_BYTES - MAX_STORE_BYTES - 65536) { notes.push('容量限制，跳过 Session 日志：' + id); continue }
      const content = raw.content.split('\n').map(line => {
        if (!line) return ''
        try { const parsed = JSON.parse(line); collectMedia(parsed); return JSON.stringify(redactDiagnostic(parsed)) } catch { return '[无法解析的日志行，已省略]' }
      }).join('\n')
      bytes += Buffer.byteLength(content)
      entries.push({ path: id === sessionId ? 'session.jsonl' : 'subagents/' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_') + '/session.jsonl', content })
    } catch { notes.push('Session 日志读取失败：' + id) }
  }
  for (const [id, reference] of media) {
    try {
      const image = await attachments?.readImage(reference)
      if (!image?.data) { notes.push('缺失附件：' + id); continue }
      if (bytes + image.data.length > MAX_EXPORT_BYTES - MAX_STORE_BYTES - 65536) { notes.push('容量限制，跳过附件：' + id); continue }
      entries.push({ path: 'media/' + id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.' + mediaExtensions[reference.mediaType], content: image.data })
      bytes += image.data.length
    } catch { notes.push('附件读取失败：' + id) }
  }
  entries.push({ path: 'mvu/diagnostics.json', content: JSON.stringify(redactDiagnostic(await store.read(sessionId))) })
  entries.push({ path: 'mvu/environment.json', content: JSON.stringify(redactDiagnostic(environment), null, 2) })
  entries.push({ path: 'README.txt', content: notes.join('\n') })
  return { filename: 'dsh-tavern-diagnostics-' + String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.zip', buffer: diagnosticZip(entries) }
}
