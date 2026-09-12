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

export function sanitizeModuleFailure(value) {
  if (!value || value.phase !== 'module-load') return null
  const url = raw => {
    try { const parsed = new URL(String(raw)); return /^https?:$/.test(parsed.protocol) ? (parsed.origin + parsed.pathname).slice(0, 500) : '' } catch { return '' }
  }
  return {
    phase: 'module-load', reason: ['offline', 'http', 'unknown'].includes(value.reason) ? value.reason : 'unknown',
    message: redactMvuLoadError(value.message || '', 1000),
    references: (Array.isArray(value.references) ? value.references : []).slice(0, 8).map(url).filter(Boolean),
    resources: (Array.isArray(value.resources) ? value.resources : []).slice(0, 8)
      .filter(entry => entry && Number.isInteger(entry.status) && entry.status >= 400 && entry.status <= 599)
      .map(entry => ({ url: url(entry.url), status: entry.status })).filter(entry => entry.url)
  }
}

export function sanitizeRuntimeDiagnostics(value) {
  return redactDiagnostic((Array.isArray(value) ? value : []).slice(-50).map(item => ({
    kind: String(item?.kind || '').slice(0, 40), name: String(item?.name || '').slice(0, 100),
    level: item?.level === 'error' ? 'error' : 'warn',
    ready: item?.ready === true, subscribed: item?.subscribed === true, initializationFailed: item?.initializationFailed === true,
    scriptId: String(item?.scriptId || '').slice(0, 200), message: String(item?.message || '').slice(0, 4000)
  })))
}

export function redactMvuLoadError(value, limit = 2000) {
  return redactDiagnostic(String(value || ''))
    .replace(/[A-Za-z]:[\\/][^\r\n"'<>;]*/g, '[local path]')
    .replace(/\/(?:Users|home|private|var|tmp|Volumes|opt)\/[^\r\n"'<>;]*/g, '[local path]')
    .slice(0, limit)
}

/** An explicit allowlist: neither response bodies nor arbitrary request headers enter logs. */
export function sanitizeMvuLoadDiagnostic(value) {
  const phases = ['download-started', 'download-response', 'download-completed', 'download-failed',
    'retry-scheduled', 'retry-exhausted', 'manual-retry', 'disposed', 'execution-started', 'execution-completed', 'execution-failed',
    'initialization-timing', 'subscriptions-ready', 'initialization-waiting', 'initialization-ready', 'initialization-failed', 'initialization-timeout']
  if (!value || !phases.includes(value.phase)) return null
  const result = { phase: value.phase }
  if (value.phase === 'initialization-timing') {
    const stages = new Set(['companion-barrier', 'variable-initialized', 'companion-module', 'worldbook-read', 'prompt-write', 'message-write', 'variable-write', 'script-callback', 'prompt-drain'])
    const number = n => Number.isSafeInteger(n) && n >= 0 ? n : 0
    result.timings = { elapsedMs: number(value.timings?.elapsedMs), dropped: number(value.timings?.dropped),
      entries: (Array.isArray(value.timings?.entries) ? value.timings.entries : []).slice(0, 32).filter(row => stages.has(row?.stage)).map(row => ({
        stage: row.stage, scriptId: redactMvuLoadError(row.scriptId, 200),
        ...Object.fromEntries(['count', 'failures', 'totalMs', 'maxMs', 'pending', 'oldestPendingMs'].map(key => [key, number(row[key])]))
      })) }
  }

  for (const [key, limit] of Object.entries({ loadId: 100, contentType: 120, bodyKind: 40, errorName: 80,
    message: 2000, serverError: 2000, browser: 120, platform: 40, runtimeMode: 20, failureStep: 40 })) {
    if (typeof value[key] === 'string') result[key] = redactMvuLoadError(value[key], limit)
  }
  for (const key of ['cycle', 'attempt', 'at', 'durationMs', 'delayMs', 'httpStatus', 'contentLength', 'receivedChars']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key]
  }
  if (typeof value.responsePath === 'string') {
    try { result.responsePath = redactMvuLoadError(new URL(value.responsePath, 'http://diagnostic.invalid').pathname, 300) } catch {}
  }
  if (typeof value.redirected === 'boolean') result.redirected = value.redirected
  return result
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

export async function createMvuDiagnosticExport({ cardDiagnostics, performanceDiagnostics, updateDiagnostics, sessionId, backgroundSessionIds = [], store, sessions, persistence, query, attachments, sceneDiagnostics, compatibilityDiagnostics, apiDiagnostics, displayDiagnostics, environment = {} }) {
  const notes = ['包含对话文本、附件与变量信息，分享前请检查隐私。凭据已尽力脱敏。MVU 记录有容量限制，旧故障不会被追溯补录。']
  notes.push('mvu/diagnostics.json 中 stage=regeneration-target 是正文重新生成的目标定位证据：记录失败分支、消息结构、轮次和会话绑定摘要，不记录正文或指导意见；只对更新后再次操作生效。')
  notes.push('stage=script-runtime 的 moduleFailure 记录模块加载失败原因、最多 8 个脚本引用及同期浏览器可见的失败资源和 HTTP 状态；引用和同期资源不等于完整失败依赖链。跨域资源可能不提供状态；unknown 不代表断网。URL 不含凭据和查询参数，不记录脚本或响应体。仅更新后再次失败才会记录。')
  notes.push('stage=mvu-load 记录下载响应类型、状态、有限的错误信息、尝试次数和执行阶段；不记录完整脚本或响应体。mvu/environment.json 的 mvuAsset 是当前服务进程共享的最近文件读取/校验观察，不代表导出会话在故障时的文件状态；导出不会重新加载文件。日志限量、异步写入，关闭页面或写盘失败可能漏记，旧错误不能追溯补录。')
  if (updateDiagnostics) notes.push('update/diagnostics.json 为本机更新记录，包含检查来源、回退原因和安装结果；限量保留，不补录安装此版本前的故障。')
  notes.push('mvu/diagnostics.json 中 initialization-timing 记录 MVU 初始化的伴随脚本、世界书读取、变量初始化回调、提示词队列及写入耗时。按脚本聚合，约每 5 秒采样，最多记录启动后 3 分钟；pending 表示仍在等待，超时提示不代表任务取消。总耗时可包含并发重叠，不等于页面等待时间；不记录正文和变量值。')
  const ids = new Set([sessionId, ...backgroundSessionIds.filter(Boolean), ...(sceneDiagnostics?.records || []).map(record => record.traceSessionId).filter(Boolean)])
  const sceneContent = sceneDiagnostics ? JSON.stringify(redactDiagnostic(sceneDiagnostics)) : ''
  const sceneBytes = Buffer.byteLength(sceneContent)
  const compatibilityContent = compatibilityDiagnostics ? JSON.stringify(redactDiagnostic(compatibilityDiagnostics)) : ''
  const compatibilityBytes = Buffer.byteLength(compatibilityContent)
  const apiContent = apiDiagnostics ? JSON.stringify(redactDiagnostic(apiDiagnostics)) : ''
  const apiBytes = Buffer.byteLength(apiContent)
  if (apiBytes) notes.push('compatibility/api-calls.json 记录经过宿主 RPC 的调用结果、耗时与事件归属。保留最近 200 条失败或拒绝，以及 30 条成功调用；参数仅记录类型和大小，不记录参数值或返回正文。未知脚本归属不会推测；未经过兼容层的调用不保证捕获。')
  const performanceContent = performanceDiagnostics ? JSON.stringify(performanceDiagnostics) : ''
  if (performanceContent) notes.push('performance/summary.json 是当前服务进程和最近上报浏览器的限量性能摘要，不限于本会话；重启重置。接口耗时可能包含模型或生图等待，不代表主线程卡顿。浏览器长任务仅统计超过 100ms 的任务；不支持该 API 时不代表没有卡顿。')
  const displayContent = displayDiagnostics ? JSON.stringify(redactDiagnostic(displayDiagnostics)) : ''
  const displayBytes = Buffer.byteLength(displayContent)
  let cardContent = cardDiagnostics ? JSON.stringify(redactDiagnostic(cardDiagnostics), null, 2) : ''
  if (Buffer.byteLength(cardContent) > 8 * 1024 * 1024) {
    cardContent = JSON.stringify({ version: 1, omitted: true, reason: '人物卡资料超过 8 MiB，请单独提供人物卡。' })
  }
  const cardBytes = Buffer.byteLength(cardContent)
  if (cardBytes) notes.push('card/context.json 包含导出时的人物卡、脚本与正则配置、绑定世界书，可能包含作者内容与个人修改；不保证与故障发生时完全一致。凭据及 URL 查询参数已尽力脱敏，复现外部资源问题时可能仍需原始资源。超过 8 MiB 时仅记录省略原因。')
  const logLimit = MAX_EXPORT_BYTES - MAX_STORE_BYTES - 65536 - sceneBytes - compatibilityBytes - apiBytes - displayBytes - cardBytes - Buffer.byteLength(performanceContent)
  if (compatibilityBytes) notes.push('compatibility/missing-capabilities.json 区分接口探测（lookup）、空操作（noop）和拒绝执行（rejected）。次数按脚本运行实例累计；不表示能力已实现。只记录参数类型，不记录参数值；脚本归属为运行时当前脚本，脱离事件的异步回调可能不精确。记录限量且异步写入，突然关闭页面可能漏记。')
  if (sceneBytes) notes.push('scene-images/diagnostics.json 包含生图材料、方案、请求参数、耗时与失败；不包含生图图片字节。记录有容量限制，未记录的旧任务不追溯补录。用量未提供不代表零费用。')
  try {
    const lineage = await query?.traceSession(sessionId)
    const visit = nodes => { for (const node of nodes || []) { const id = node.session?.header?.id; if (id && !ids.has(id) && ids.size < 100) { ids.add(id); visit(node.descendants) } } }
    visit(lineage?.descendants)
  } catch { notes.push('无法读取完整 Session 子任务关系；仍包含已知后台 Session。') }
  const entries = []
  if (performanceContent) entries.push({ path: 'performance/summary.json', content: performanceContent })
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
      if (bytes + Buffer.byteLength(raw.content) > logLimit) { notes.push('容量限制，跳过 Session 日志：' + id); continue }
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
      if (bytes + image.data.length > logLimit) { notes.push('容量限制，跳过附件：' + id); continue }
      entries.push({ path: 'media/' + id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.' + mediaExtensions[reference.mediaType], content: image.data })
      bytes += image.data.length
    } catch { notes.push('附件读取失败：' + id) }
  }
  if (cardBytes) entries.push({ path: 'card/context.json', content: cardContent })
  entries.push({ path: 'mvu/diagnostics.json', content: JSON.stringify(redactDiagnostic(await store.read(sessionId))) })
  entries.push({ path: 'mvu/environment.json', content: JSON.stringify(redactDiagnostic(environment), null, 2) })
  if (updateDiagnostics) entries.push({ path: 'update/diagnostics.json', content: JSON.stringify(redactDiagnostic(updateDiagnostics)) })
  if (apiDiagnostics) entries.push({ path: 'compatibility/api-calls.json', content: apiContent })
  if (compatibilityBytes) entries.push({ path: 'compatibility/missing-capabilities.json', content: compatibilityContent })
  if (sceneBytes) entries.push({ path: 'scene-images/diagnostics.json', content: sceneContent })
  if (displayBytes) {
    entries.push({ path: 'display/diagnostics.json', content: displayContent })
    notes.push('display/diagnostics.json 包含最近界面采集的控制台、异常和网络摘要，不含 DOM。仅对更新后重新操作生效；采集为异步，请操作后等待数秒再导出。')
  }
  entries.push({ path: 'README.txt', content: notes.join('\n') })
  return { filename: 'dsh-tavern-diagnostics-' + String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.zip', buffer: diagnosticZip(entries) }
}
