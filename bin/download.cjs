'use strict'
// Shared network downloads for the installers and Windows Desktop package management.
// install.ps1 and install.sh embed this file verbatim because they run before any
// code is downloaded: edit it here, then run `node bin/build-installer-scripts.mjs`.
// Keep it dependency-free CommonJS for Node >= 22.19 (Desktop runs it under Electron).
//
// Timeouts follow one rule: a transfer fails when no bytes arrive for `stallMs`
// (slow but moving downloads keep going); `deadlineMs` is only a generous upper bound.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { inflateRawSync } = require('node:zlib')

const RUNTIME_PATH = /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|cordis\.patch\.yml|install\.ps1|install\.sh|android\/|bin\/|config\/|presets\/|patches\/|tavern-plugin\/)/
const EXCLUDED_PART = new Set(['.', '..', 'docs', 'tests', '__tests__', 'testsets'])

class DownloadError extends Error {
  constructor(message, { reason, attempts = [], cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DownloadError'
    this.reason = reason
    this.attempts = attempts
  }
}

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra })
}

const NETWORK_REASONS = [
  [/^(ENOTFOUND|EAI_AGAIN)$/, '域名解析失败'],
  [/^ECONNREFUSED$/, '连接被拒绝'],
  [/^(ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED)$/, '连接被中断'],
  [/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/, '连接超时'],
  [/^(ENETUNREACH|EHOSTUNREACH)$/, '网络不可达'],
  [/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL/, 'TLS 证书校验失败（可能被代理或安全软件拦截）'],
]

// One short Chinese reason per failure; the underlying error stays in `cause`.
function describeFailure(error) {
  if (!error) return '未知错误'
  if (error.code === 'STALLED' || error.code === 'DEADLINE' || error.code === 'HTTP' || error.code === 'CHECKSUM') return error.message
  if (error.name === 'TimeoutError') return '请求超时'
  if (error.name === 'AbortError') return '请求被中止'
  let current = error
  for (let depth = 0; current && depth < 4; depth++, current = current.cause) {
    const code = String(current.code || '')
    for (const [pattern, reason] of NETWORK_REASONS) if (pattern.test(code)) return `${reason}（${code}）`
  }
  return String(error.cause?.code || error.cause?.message || error.message || error)
}

const duration = ms => ms >= 60000 && ms % 60000 === 0 ? `${ms / 60000} 分钟` : `${Number((ms / 1000).toFixed(1))} 秒`

function hostOf(url) {
  try { return new URL(url).hostname } catch { return String(url) }
}

// Fetch one URL into memory, aborting when no data arrives for `stallMs`.
async function fetchBytes(url, { stallMs = 30000, signal, headers, onData, fetch: request = fetch } = {}) {
  const controller = new AbortController()
  let stalled = false, timer
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; controller.abort() }, stallMs) }
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  arm()
  try {
    const response = await request(url, { signal: combined, headers, redirect: 'follow' })
    if (!response.ok) {
      try { await response.body?.cancel() } catch {}
      throw failure('HTTP', `HTTP ${response.status}`, { status: response.status })
    }
    const total = Number(response.headers?.get?.('content-length')) || 0
    const chunks = []
    let received = 0
    if (response.body) for await (const chunk of response.body) {
      arm()
      const bytes = Buffer.from(chunk)
      chunks.push(bytes); received += bytes.length
      onData?.(received, total)
    }
    return Buffer.concat(chunks)
  } catch (error) {
    if (stalled) throw failure('STALLED', `${duration(stallMs)}没有收到数据`, { cause: error })
    throw error
  } finally { clearTimeout(timer) }
}

// Try `urls` in turn (cycling) until one returns bytes matching `sha256`/`size`.
async function download(urls, options = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
  if (!list.length) throw new TypeError('download() needs at least one URL')
  const { sha256, size, label = path.posix.basename(new URL(list[0]).pathname) || list[0], stallMs = 30000, deadlineMs,
    attempts = Math.max(2, list.length), retryDelayMs = 1000, signal, headers, onProgress, onAttempt, onRetry } = options
  const deadline = deadlineMs ? AbortSignal.timeout(deadlineMs) : undefined
  const limit = [signal, deadline].filter(Boolean)
  const combined = limit.length > 1 ? AbortSignal.any(limit) : limit[0]
  const records = []
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const url = list[(attempt - 1) % list.length]
    onAttempt?.({ url, host: hostOf(url), attempt, attempts })
    try {
      const bytes = await fetchBytes(url, { stallMs, signal: combined, headers, fetch: options.fetch,
        onData: (received, total) => onProgress?.({ url, host: hostOf(url), received, total, attempt, attempts }) })
      if (size !== undefined && bytes.length !== size) throw failure('CHECKSUM', `文件大小不符（应为 ${size} 字节，实际 ${bytes.length}）`)
      if (sha256 && createHash('sha256').update(bytes).digest('hex') !== String(sha256).toLowerCase()) throw failure('CHECKSUM', 'SHA-256 校验不符')
      return { bytes, url }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (deadline?.aborted) {
        last = failure('DEADLINE', `超过总时长上限 ${duration(deadlineMs)}`, { cause: error })
        records.push({ url, reason: last.message })
        break
      }
      last = error
      const reason = describeFailure(error)
      records.push({ url, reason })
      const willRetry = attempt < attempts
      onRetry?.({ url, host: hostOf(url), attempt, attempts, reason, willRetry, error })
      if (willRetry) {
        try { await delay(retryDelayMs * attempt, undefined, combined ? { signal: combined } : undefined) }
        catch { if (signal?.aborted) throw signal.reason; break }
      }
    }
  }
  const reason = describeFailure(last)
  throw new DownloadError(`${label} 下载失败（已尝试 ${records.length} 次）：${reason}`, { reason, attempts: records, cause: last })
}

// Download to `destination`; only a verified, complete file is ever published there.
async function downloadFile(urls, destination, options = {}) {
  const result = await download(urls, options)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const partial = `${destination}.download-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(partial, result.bytes)
    await fs.rename(partial, destination)
  } finally { await fs.rm(partial, { force: true }) }
  return result
}

function runtimeFiles(metadata) {
  if (!/^[0-9a-f]{40}$/i.test(String(metadata?.revision || ''))) throw new Error('运行清单缺少有效提交号')
  const files = (Array.isArray(metadata.files) ? metadata.files : [])
    .map(file => ({ ...file, path: String(file?.path || '') }))
    .filter(file => RUNTIME_PATH.test(file.path) && !file.path.split('/').some(part => EXCLUDED_PART.has(part)))
  for (const file of files) {
    if (file.path.includes('\\') || file.path.includes(':') || file.path.split('/').some(part => !part) || !/^[0-9a-f]{64}$/i.test(String(file.sha256 || ''))) {
      throw new Error(`运行清单包含无效文件：${file.path}`)
    }
  }
  if (!files.length) throw new Error('运行清单没有可下载的运行文件')
  return files
}

// jsDelivr's nodes keep separate caches of the mutable @branch manifest, and a purge is often
// throttled after a release: ask all of them and keep the newest (CI's release sequence).
const JSDELIVR_NODES = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net']
function manifestCandidates(metadataUrl, exact) {
  const url = new URL(metadataUrl)
  if (exact || url.hostname !== JSDELIVR_NODES[0] || !/@[^/]+\/dsh-tavern-runtime\.json$/.test(url.pathname)) return [metadataUrl]
  return JSDELIVR_NODES.map(host => { const each = new URL(url); each.hostname = host; return each.href })
}
function compareVersions(left, right) {
  const parts = value => String(value || '').split(/[-+]/)[0].split('.').map(part => Number(part) || 0)
  const [a, b] = [parts(left), parts(right)]
  for (let index = 0; index < 3; index++) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0)
  return 0
}
async function readManifest({ metadataUrl, exact, minVersion, stallMs, attempts, fetch: request, status = () => {} }) {
  const urls = manifestCandidates(metadataUrl, exact)
  const results = await Promise.allSettled(urls.map(async url => {
    const { bytes } = await download([url], { label: '运行清单', stallMs: Math.min(stallMs, 15000), attempts, fetch: request })
    const metadata = JSON.parse(bytes.toString('utf8'))
    runtimeFiles(metadata)
    return { url, metadata }
  }))
  const found = results.filter(result => result.status === 'fulfilled').map(result => result.value)
  if (!found.length) throw results[0].reason
  const sequence = item => Number(item.metadata.releaseSequence) || 0
  const best = found.reduce((newest, item) => sequence(item) > sequence(newest) ? item : newest)
  if (found.length > 1 && found.some(item => item.metadata.revision !== best.metadata.revision)) status(`下载源各节点版本不一，使用最新的 ${hostOf(best.url)}（v${best.metadata.version || '?'}）`)
  // Never install code older than this installer: a stale CDN would hand back a release built for another host.
  if (minVersion && compareVersions(best.metadata.version, minVersion) < 0) {
    throw Object.assign(new Error(`下载源（jsDelivr）还没更新到 v${minVersion}，当前只有 v${best.metadata.version || '未知'}。请过半小时左右重试；或安装 git 后重试（会直接从 GitHub 下载）。`), { code: 'DSH_TAVERN_CDN_STALE' })
  }
  return best.metadata
}

// The files of a zip (stored or deflated, no ZIP64): the runtime archive CI publishes holds well
// under 65535 entries and 4 GB.
function unzipEntries(buffer) {
  let end = -1
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65557); at--) if (buffer.readUInt32LE(at) === 0x06054b50) { end = at; break }
  if (end < 0) throw failure('ARCHIVE', '压缩包结构损坏（找不到目录）')
  const count = buffer.readUInt16LE(end + 10), offset = buffer.readUInt32LE(end + 16)
  const entries = new Map()
  let at = offset
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== 0x02014b50) throw failure('ARCHIVE', '压缩包目录损坏')
    const method = buffer.readUInt16LE(at + 10), compressed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24)
    const nameLength = buffer.readUInt16LE(at + 28), local = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32)
    if (name.endsWith('/')) continue
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw failure('ARCHIVE', `压缩包内容损坏：${name}`)
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const data = buffer.subarray(start, start + compressed)
    const bytes = method === 0 ? data : method === 8 ? inflateRawSync(data) : null
    if (!bytes || bytes.length !== size) throw failure('ARCHIVE', `压缩包内容损坏：${name}`)
    entries.set(name, bytes)
  }
  return entries
}

// CI publishes the manifest's files as one zip at a pinned commit; one request instead of hundreds.
function runtimeArchive(metadata) {
  const archive = metadata?.archive
  if (!archive || !/^[0-9a-f]{40}$/i.test(String(archive.commit || '')) || !/^[0-9a-f]{64}$/i.test(String(archive.sha256 || ''))
    || !/^[A-Za-z0-9._-]+\.zip$/.test(String(archive.path || '')) || !Number.isSafeInteger(archive.size) || archive.size <= 0) return null
  return archive
}

// Every jsDelivr node, starting with the one the installer named, for the immutable archive URL.
function archiveUrls(rootUrl, archive) {
  const first = new URL(`${rootUrl}@${archive.commit}/${archive.path}`)
  if (!JSDELIVR_NODES.includes(first.hostname)) return [first.href]
  return [first.hostname, ...JSDELIVR_NODES.filter(host => host !== first.hostname)].map(host => { const each = new URL(first); each.hostname = host; return each.href })
}

// Download the runtime files listed by a jsDelivr manifest into `destination`.
// Files whose bytes already match in `installed` are reused instead of downloaded.
async function downloadRuntime({ metadataUrl, rootUrl, destination, installed, concurrency = 16, stallMs = 30000,
  budgetMs = 300000, attempts = 2, status = () => {}, fetch: request, targetCommit = '', minVersion = '', exactManifest = false } = {}) {
  const source = hostOf(rootUrl)
  const metadata = await readManifest({ metadataUrl, exact: exactManifest, minVersion, stallMs, attempts, fetch: request, status })
  const files = runtimeFiles(metadata)
  // The @main manifest can lag (CDN cache, or CI not yet published). When the app
  // asked for a specific commit, refuse a different one rather than silently
  // installing an older build; the caller falls back to another source.
  const target = String(targetCommit || '').trim().toLowerCase()
  if (/^[0-9a-f]{40}$/.test(target) && String(metadata.revision).toLowerCase() !== target) {
    throw new Error(`jsDelivr 运行清单（${String(metadata.revision).slice(0, 12)}）与目标版本（${target.slice(0, 12)}）不一致，可能尚未同步`)
  }
  const controller = new AbortController()
  const budget = AbortSignal.timeout(budgetMs)
  const signal = AbortSignal.any([controller.signal, budget])
  const archive = runtimeArchive(metadata)
  if (archive) {
    try {
      await extractRuntimeArchive({ archive, files, rootUrl, destination, stallMs, signal, fetch: request, status })
      await fs.writeFile(path.join(destination, 'dsh-tavern-runtime.json'), `${JSON.stringify(metadata, null, 2)}\n`)
      return metadata
    } catch (error) {
      if (budget.aborted) throw new Error(`备用源下载超过 ${duration(budgetMs)}，将切换备用方案`, { cause: error })
      status(`代码压缩包不可用（${describeFailure(error)}），改为逐个文件下载…`)
    }
  }
  let next = 0, done = 0, reused = 0, received = 0, reportedAt = 0
  // A progress line every five seconds at most: the Windows installer appends each line to its log
  // and echoes it, and a pipe it reads slower than we write stalls this process (and the download).
  const report = (force = false) => {
    const now = Date.now()
    if (!force && now - reportedAt < 5000) return
    reportedAt = now
    status(`下载代码（${source}）：${done}/${files.length} 文件，复用 ${reused}，已下载 ${(received / 1048576).toFixed(1)} MB`)
  }
  report(true)
  const worker = async () => {
    while (next < files.length) {
      signal.throwIfAborted()
      const file = files[next++]
      const parts = file.path.split('/')
      let content
      if (installed) {
        try {
          const local = await fs.readFile(path.join(installed, ...parts))
          if (createHash('sha256').update(local).digest('hex') === file.sha256.toLowerCase()) { content = local; reused++ }
        } catch {}
      }
      if (!content) {
        const url = `${rootUrl}@${metadata.revision}/${parts.map(encodeURIComponent).join('/')}`
        content = (await download([url], { label: file.path, sha256: file.sha256, stallMs, attempts, signal, fetch: request,
          onRetry: ({ attempt, attempts: total, reason, willRetry }) => status(`下载失败（${source}）：${file.path}，${reason}；尝试 ${attempt}/${total}${willRetry ? '，正在重试' : '，将切换备用方案'}。`),
        })).bytes
        received += content.length
      }
      signal.throwIfAborted()
      const target = path.join(destination, ...parts)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
      done++
      report()
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
    report(true)
  } catch (error) {
    controller.abort()
    if (budget.aborted) throw new Error(`备用源下载超过 ${duration(budgetMs)}，将切换备用方案`, { cause: error })
    throw error
  }
  await fs.writeFile(path.join(destination, 'dsh-tavern-runtime.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  return metadata
}

// One zip, verified as a whole and then file by file against the manifest, before anything is written.
async function extractRuntimeArchive({ archive, files, rootUrl, destination, stallMs, signal, fetch: request, status }) {
  const urls = archiveUrls(rootUrl, archive)
  let reportedAt = 0
  const megabytes = bytes => (bytes / 1048576).toFixed(1)
  status(`下载代码压缩包（${hostOf(urls[0])}）：0/${megabytes(archive.size)} MB`)
  const { bytes, url } = await download(urls, { label: '代码压缩包', sha256: archive.sha256, size: archive.size, stallMs, signal, fetch: request,
    onProgress: ({ host, received }) => {
      const now = Date.now()
      if (now - reportedAt < 5000) return
      reportedAt = now
      status(`下载代码压缩包（${host}）：${megabytes(received)}/${megabytes(archive.size)} MB`)
    } })
  status(`下载代码压缩包（${hostOf(url)}）：${megabytes(archive.size)}/${megabytes(archive.size)} MB，正在解压 ${files.length} 个文件…`)
  const entries = unzipEntries(bytes)
  const verified = files.map(file => {
    const content = entries.get(file.path)
    if (!content || createHash('sha256').update(content).digest('hex') !== file.sha256.toLowerCase()) throw failure('ARCHIVE', `压缩包与运行清单不一致：${file.path}`)
    return { file, content }
  })
  for (const { file, content } of verified) {
    signal.throwIfAborted()
    const target = path.join(destination, ...file.path.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  status(`代码已就绪：${files.length} 个文件`)
}

const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']
const INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const envValue = (env, name) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1]

function readInternetSettings() {
  const output = require('node:child_process').execFileSync('reg', ['query', INTERNET_SETTINGS], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  const values = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_\w+\s+(.*?)\s*$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return values
}

function proxyUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

// Windows "system proxy" (WinINET) is invisible to Node fetch, curl, git and pnpm,
// which only read HTTP(S)_PROXY. Translate it into those variables when none is set.
// Returns the variables to add plus a display summary without credentials.
function proxyEnvironment(env = process.env, { platform = process.platform, readSettings = readInternetSettings } = {}) {
  const added = {}
  const useEnvProxy = () => { if (envValue(env, 'NODE_USE_ENV_PROXY') === undefined) added.NODE_USE_ENV_PROXY = '1' }
  if (PROXY_KEYS.some(key => envValue(env, key))) {
    useEnvProxy()
    return { added, source: 'environment' }
  }
  if (platform !== 'win32') return { added, source: null }
  let settings
  try { settings = readSettings() } catch { return { added, source: null } }
  if (Number(settings.ProxyEnable) === 1 && settings.ProxyServer) {
    const entries = {}
    for (const part of settings.ProxyServer.split(';').map(item => item.trim()).filter(Boolean)) {
      const [scheme, address] = part.includes('=') ? part.split('=', 2) : ['*', part]
      entries[scheme.toLowerCase()] = address
    }
    const http = entries.http || entries['*']
    const https = entries.https || http
    if (http || https) {
      if (http) added.HTTP_PROXY = proxyUrl(http)
      if (https) added.HTTPS_PROXY = proxyUrl(https)
      if (envValue(env, 'NO_PROXY') === undefined) {
        const bypass = String(settings.ProxyOverride || '').split(';').map(item => item.trim())
          .filter(item => item && item !== '<local>' && !item.slice(1).includes('*'))
          .map(item => item.replace(/^\*/, ''))
        added.NO_PROXY = [...new Set(['localhost', '127.0.0.1', '::1', ...bypass])].join(',')
      }
      useEnvProxy()
      return { added, source: 'system', summary: new URL(added.HTTPS_PROXY || added.HTTP_PROXY).host }
    }
    if (entries.socks) return { added, source: 'unsupported', summary: '系统代理只提供 SOCKS，安装程序无法使用；请在代理软件中开启 HTTP 代理或 TUN 模式' }
  }
  if (settings.AutoConfigURL) return { added, source: 'pac', summary: '系统代理使用 PAC 自动配置脚本，安装程序无法读取；如下载失败，请在代理软件中开启 TUN 模式或设置 HTTPS_PROXY' }
  return { added, source: null }
}

// Apply proxyEnvironment() to `env` and, when env is this process's environment,
// to this process's own fetch (Node >= 24.5 can switch the global proxy at runtime).
function applyProxyEnvironment(env = process.env, options) {
  const result = proxyEnvironment(env, options)
  Object.assign(env, result.added)
  if (result.added.HTTPS_PROXY || result.added.HTTP_PROXY) {
    try { require('node:http').setGlobalProxyFromEnv?.(env) } catch {}
  }
  return result
}

function parseOptions(args) {
  const options = {}, rest = []
  for (let index = 0; index < args.length; index++) {
    const match = /^--([a-z0-9-]+)$/.exec(args[index])
    if (match) options[match[1]] = args[++index]
    else rest.push(args[index])
  }
  return { options, rest }
}

const seconds = (value, fallback) => (value === undefined ? fallback : Number(value) * 1000)

// CLI used by the installer scripts:
//   node download.cjs file <destination> [--sha256 H] [--stall S] [--deadline S] [--attempts N] <url>...
//   node download.cjs runtime <metadata-url> <root-url> <destination> [<installed-dir>] [--stall S] [--budget S] [--min-version V]
//     (DSH_TAVERN_CDN_METADATA_URL set: that manifest only, no other jsDelivr nodes)
//   node download.cjs proxy-env   prints KEY=VALUE lines to add (Windows system proxy)
async function main(argv) {
  const [command, ...args] = argv
  const { options, rest } = parseOptions(args)
  const status = message => console.log(`DSH_STATUS ${message}`)
  if (command === 'file') {
    const [destination, ...urls] = rest
    if (!destination || !urls.length) throw new Error('用法：download.cjs file <目标文件> <URL>...')
    await downloadFile(urls, destination, { sha256: options.sha256, stallMs: seconds(options.stall, 30000),
      deadlineMs: seconds(options.deadline, undefined), attempts: options.attempts ? Number(options.attempts) : undefined })
    return
  }
  if (command === 'runtime') {
    const [metadataUrl, rootUrl, destination, installed] = rest
    if (!metadataUrl || !rootUrl || !destination) throw new Error('用法：download.cjs runtime <清单 URL> <CDN 根 URL> <目标目录> [已安装目录]')
    const metadata = await downloadRuntime({ metadataUrl, rootUrl: rootUrl.replace(/\/+$/, ''), destination, installed,
      stallMs: seconds(options.stall, 30000), budgetMs: seconds(options.budget, 300000), status,
      targetCommit: process.env.DSH_TAVERN_TARGET_COMMIT, minVersion: options['min-version'] || '',
      exactManifest: Boolean(process.env.DSH_TAVERN_CDN_METADATA_URL) })
    status(`下载代码完成：${metadata.revision.slice(0, 12)}`)
    return
  }
  if (command === 'proxy-env') {
    const { added, summary } = proxyEnvironment(process.env)
    for (const [key, value] of Object.entries(added)) console.log(`${key}=${value}`)
    if (summary) status(added.HTTPS_PROXY || added.HTTP_PROXY ? `使用系统代理：${summary}` : summary)
    return
  }
  throw new Error(`未知命令：${command || '(空)'}`)
}

module.exports = { download, downloadFile, downloadRuntime, unzipEntries, readManifest, manifestCandidates, compareVersions, describeFailure, runtimeFiles, proxyEnvironment, applyProxyEnvironment, DownloadError, RUNTIME_PATH }

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
