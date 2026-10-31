$ErrorActionPreference = 'Stop'
$PreviousConsoleOutputEncoding = [Console]::OutputEncoding
$PreviousOutputEncoding = $OutputEncoding

$InstallHost = if ($env:DSH_TAVERN_HOST) { $env:DSH_TAVERN_HOST } else { 'desktop' }
if ($InstallHost -notin @('desktop', 'cli')) { throw "只支持官方桌面和独立命令行，不支持宿主：$InstallHost" }

$Repository = if ($env:DSH_TAVERN_REPOSITORY) { $env:DSH_TAVERN_REPOSITORY } else { 'flizzywine/dsh-tavern' }
$RepositoryUrl = if ($env:DSH_TAVERN_GIT_URL) { $env:DSH_TAVERN_GIT_URL } else { "https://github.com/$Repository.git" }
$ArchiveUrl = if ($env:DSH_TAVERN_ARCHIVE_URL) { $env:DSH_TAVERN_ARCHIVE_URL } else { "https://codeload.github.com/$Repository/zip/refs/heads/main" }
$CommitUrl = if ($env:DSH_TAVERN_COMMIT_URL) { $env:DSH_TAVERN_COMMIT_URL } else { "https://api.github.com/repos/$Repository/commits/main" }
# This installer's release (package.json, written by bin/build-installer-scripts.mjs): never install older code.
$InstallerVersion = '3.2.0'
$CdnMetadataUrl = if ($env:DSH_TAVERN_CDN_METADATA_URL) { $env:DSH_TAVERN_CDN_METADATA_URL } else { "https://cdn.jsdelivr.net/gh/$Repository@main/dsh-tavern-runtime.json" }
$CdnRootUrl = if ($env:DSH_TAVERN_CDN_ROOT_URL) { $env:DSH_TAVERN_CDN_ROOT_URL.TrimEnd('/') } else { "https://cdn.jsdelivr.net/gh/$Repository" }
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' }
$LegacyDshRoot = if ($env:DSH_TAVERN_LEGACY_DSH_HOME) { $env:DSH_TAVERN_LEGACY_DSH_HOME } else { $DshRoot }
if ($InstallHost -eq 'cli') {
  # CLI directory selection: explicit paths and existing installations never prompt.
  $DefaultCliRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh-tavern'
  $CurrentCliRoot = (Get-Location).ProviderPath
  $DshRoot = $env:DSH_TAVERN_CLI_HOME
  if (-not $DshRoot) {
    if ((Test-Path -LiteralPath (Join-Path $CurrentCliRoot 'apps/dsh-tavern/.dsh-tavern-local.json') -PathType Leaf) -or (Test-Path -LiteralPath (Join-Path $CurrentCliRoot '.dsh-tavern-install-root') -PathType Leaf)) { $DshRoot = $CurrentCliRoot }
    elseif ((Test-Path -LiteralPath (Join-Path $DefaultCliRoot 'apps/dsh-tavern/.dsh-tavern-local.json') -PathType Leaf) -or (Test-Path -LiteralPath (Join-Path $DefaultCliRoot '.dsh-tavern-install-root') -PathType Leaf)) { $DshRoot = $DefaultCliRoot }
    else {
      if ([Console]::IsInputRedirected) { throw '无法交互选择安装目录。请设置 DSH_TAVERN_CLI_HOME 后重新运行。' }
      Write-Host "请选择 CLI 安装目录：`n  1. 默认目录：$DefaultCliRoot`n  2. 当前目录：$CurrentCliRoot（回车默认）`n  3. 其他目录"
      Write-Host '程序、运行时和游戏数据存入所选目录；命令入口和包管理器缓存可能位于目录外。'
      while (-not $DshRoot) {
        $Choice = Read-Host '请选择 [1/2/3，默认 2]'
        switch ($Choice) {
          '1' { $DshRoot = $DefaultCliRoot }
          '2' { $DshRoot = $CurrentCliRoot }
          '' { $DshRoot = $CurrentCliRoot }
          '3' {
            $SelectedCliRoot = Read-Host '请输入完整安装路径'
            if ($SelectedCliRoot -match '^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)') { $DshRoot = $SelectedCliRoot }
            else { Write-Host '请输入完整路径，例如 D:\Games\dsh-tavern。' }
          }
          default { Write-Host '请输入 1、2 或 3。' }
        }
      }
    }
  }
  $DshRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DshRoot)
  $WindowsRoot = [IO.Path]::GetFullPath($env:WINDIR).TrimEnd('\')
  if ($DshRoot.TrimEnd('\') -ieq $WindowsRoot -or $DshRoot.StartsWith($WindowsRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "不能将酒馆安装到 Windows 系统目录：$DshRoot。请重新运行并选择其他目录，例如 D:\Games\dsh-tavern。"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $DshRoot 'apps/dsh-tavern/.dsh-tavern-local.json') -PathType Leaf) -and -not (Test-Path -LiteralPath (Join-Path $DshRoot '.dsh-tavern-install-root') -PathType Leaf)) {
    foreach ($Entry in @('apps', 'runtime', 'tools', 'profiles', 'profile-data', 'source-cache', 'logs', 'backups', 'settings.yaml')) {
      if (Test-Path -LiteralPath (Join-Path $DshRoot $Entry)) { throw "安装目录存在冲突：$DshRoot\$Entry。请选择空目录，或使用原有安装目录。" }
    }
  }
  Write-Host "CLI 安装目录：$DshRoot"
}

$InstallationLocationModuleSource = @'
// Dependency-free: embedded in standalone installers before downloaded code exists.
// A relocated installation keeps logical aliases for old shortcuts and profile links.
// Installers MUST write the physical app directory, never replace those aliases.
const fs = require('node:fs')
const path = require('node:path')
const fail = message => { throw Object.assign(new Error(`酒馆安装目录记录不安全，未修改安装：${message}`), { code: 'INSTALLATION_LOCATION_UNSAFE' }) }
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const inside = (child, root) => { const relative = path.relative(process.platform === 'win32' ? root.toLowerCase() : root, process.platform === 'win32' ? child.toLowerCase() : child); return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) }
const overlaps = (left, right) => same(left, right) || inside(left, right) || inside(right, left)
function ordinaryAncestors(directory) {
  let current = path.resolve(directory)
  for (;;) {
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`目录祖先不能是链接或文件：${current}`)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
        fail(`无法验证目录祖先：${current} (${error.code || error.name})`)
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}
// Only the configured home's parent chain is trusted to contain user-profile
// redirects. Never realpath a managed child: that would hide a replaced .dsh,
// state directory, or installation alias before it can be validated.
function trustedHome(dshHome) {
  const logical = path.resolve(dshHome)
  let ancestor = path.dirname(logical)
  const missing = []
  for (;;) {
    try {
      const physicalParent = fs.realpathSync(ancestor)
      if (!fs.statSync(physicalParent).isDirectory()) fail('用户目录祖先不是目录')
      const logicalParent = path.dirname(logical)
      const canonicalParent = path.join(physicalParent, ...missing.reverse())
      const physical = path.join(canonicalParent, path.basename(logical))
      ordinaryAncestors(physical)
      return { logical, physical, map(value) {
        const resolved = path.resolve(value)
        return same(resolved, logicalParent) || inside(resolved, logicalParent) ? path.join(canonicalParent, path.relative(logicalParent, resolved)) : resolved
      } }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
        fail(`无法验证用户目录祖先：${ancestor} (${error.code || 'UNKNOWN'})`)
      }
      // An existing dangling redirect is not a missing ordinary directory.
      try { if (fs.lstatSync(ancestor).isSymbolicLink()) fail(`用户目录链接不可用：${ancestor}`) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      const parent = path.dirname(ancestor)
      if (parent === ancestor) fail('无法解析用户目录')
      missing.push(path.basename(ancestor)); ancestor = parent
    }
  }
}
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/u.test(value) || !same(path.resolve(value), value)) fail('路径不是规范的绝对路径')
  return value
}
function resolveInstallationApp({ dshHome, appDir } = {}) {
  const trusted = trustedHome(dshHome), home = trusted.physical
  ordinaryAncestors(path.join(home, 'profile-bridge'))
  const requested = appDir ? path.resolve(appDir) : path.join(trusted.logical, 'apps', 'dsh-tavern')
  const journal = path.join(home, 'profile-bridge', 'installation-operation.json')
  try {
    if (fs.lstatSync(journal).isSymbolicLink()) fail('安装管理事务记录不能是链接')
    const operation = JSON.parse(fs.readFileSync(journal, 'utf8'))
    if (operation?.schemaVersion !== 1 || !['completed', 'rolled-back'].includes(operation.phase)) fail('上次安装管理尚未安全结束，请先恢复事务与备份')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
      fail(`无法读取安装管理事务记录：${journal} (${error.code || error.name})`)
    }
  }
  const filename = path.join(home, 'profile-bridge', 'installation.json')
  let record
  try {
    if (fs.lstatSync(filename).isSymbolicLink()) fail('安装记录不能是链接')
    record = JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return requested
    if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
    fail(`无法读取 ${filename} (${error.code || error.name})`)
  }
  if (record?.schemaVersion !== 1 || record.phase !== 'completed' || !Array.isArray(record.entries)) fail('迁移尚未完成或记录格式不受支持')
  const destination = trusted.map(absolute(record.destination))
  const logicalApp = trusted.map(absolute(record.appDir))
  if (overlaps(destination, home) || overlaps(destination, logicalApp)) fail('迁移目标不能与共享 DSH 或原安装目录重叠')
  ordinaryAncestors(destination)
  const entries = record.entries
  if (entries.length !== 3 || new Set(entries.map(e => e?.kind)).size !== 3 || entries.some(e => !['app', 'profile', 'data'].includes(e?.kind))) fail('迁移目录清单不完整')
  const seen = new Set()
  for (const entry of entries) {
    const from = trusted.map(absolute(entry.from)), to = trusted.map(absolute(entry.to))
    if (overlaps(destination, from)) fail('迁移目标不能与原目录重叠')
    ordinaryAncestors(path.dirname(from))
    const expected = entry.kind === 'app' ? logicalApp : entry.kind === 'profile' ? path.join(home, 'profiles', 'tavern') : path.join(home, 'profile-data', 'tavern')
    if (!same(from, expected) || !inside(to, destination) || !same(to, path.join(destination, entry.kind)) || seen.has(to)) fail('迁移目录不匹配')
    seen.add(to)
    try {
      // No aliased destination ancestors: copied trees must remain on the chosen volume.
      if (!same(fs.realpathSync(destination), destination) || !same(fs.realpathSync(to), to) || !fs.lstatSync(to).isDirectory()) fail('迁移目标包含链接或不是目录')
      if (!fs.lstatSync(from).isSymbolicLink() || !same(trusted.map(path.resolve(path.dirname(from), fs.readlinkSync(from))), to) || !same(fs.realpathSync(from), to)) fail('原目录入口已被更改')
    } catch (error) {
      if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
      fail(`目录不可用：${from} → ${to}`)
    }
  }
  const physicalApp = trusted.map(entries.find(entry => entry.kind === 'app').to)
  if (appDir && !same(trusted.map(requested), logicalApp) && !same(trusted.map(requested), physicalApp)) fail('指定目录与已迁移的酒馆冲突')
  return physicalApp
}
module.exports = { resolveInstallationApp, trustedHome }
if (require.main === module) {
  try { console.log(resolveInstallationApp({ dshHome: process.argv[2], appDir: process.argv[3] || undefined })) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
'@
$AppDir = if ($env:DSH_TAVERN_APP_DIR) { $env:DSH_TAVERN_APP_DIR } else { Join-Path $DshRoot 'apps\dsh-tavern' }
$RuntimeRoot = Join-Path $DshRoot 'tools'
$PnpmVersion = '11.25.0'
$CommandBin = Join-Path $DshRoot 'bin'
$SourceCache = Join-Path $DshRoot 'source-cache\dsh-tavern.git'
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("dsh-tavern-install-" + [Guid]::NewGuid().ToString('N'))
$TargetCommit = if ($env:DSH_TAVERN_TARGET_COMMIT) { $env:DSH_TAVERN_TARGET_COMMIT } else { '' }
$RuntimePaths = @(
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cordis.patch.yml',
  'install.ps1',
  'install.sh',
  'bin',
  'config',
  'presets',
  'patches',
  'tavern-plugin'
)

# A program reading the output (the in-app updater) gets the DSH_STATUS lines it parses; a person
# at a console gets three numbered steps with one short line per update, and the details go to the
# diagnostics log only.
$FriendlyOutput = -not [Console]::IsOutputRedirected
$InstallStarted = Get-Date
$InstallSteps = @{ '下载代码' = 1; '安装依赖' = 2; '本地配置' = 3 }
$script:CurrentInstallStep = 0
function Write-InstallStatus([string]$Message) {
  if (-not $FriendlyOutput) { Write-Host ("DSH_STATUS " + $Message); return }
  $Stage = ($Message -split '[：（(，]', 2)[0]
  if ($Stage -like '下载代码*' -or $Stage -like '下载源*' -or $Stage -like '代码*') { $Stage = '下载代码' }
  $Number = $InstallSteps[$Stage]
  if ($Number -and $Number -ne $script:CurrentInstallStep) {
    $script:CurrentInstallStep = $Number
    Write-Host ''
    Write-Host ("[$Number/3] " + $Stage) -ForegroundColor Cyan
  }
  $Detail = if ($Message.StartsWith($Stage + '：')) { $Message.Substring($Stage.Length + 1) } else { $Message }
  Write-Host ('      ' + $Detail)
}

# The first desktop install links the desktop profile to Tavern, which needs DeepSeek Harness
# closed (later in-app updates rewrite the linked profile while it runs).
function Test-DesktopLinked {
  $Live = Join-Path $DshRoot 'profiles\desktop'
  $Tavern = Join-Path $DshRoot 'profiles\tavern'
  try {
    $Item = Get-Item -LiteralPath $Live -Force -ErrorAction Stop
    if (-not $Item.LinkType -or -not (Test-Path -LiteralPath $Tavern)) { return $false }
    $Target = [string]@($Item.Target)[0]
    if (-not [IO.Path]::IsPathRooted($Target)) { $Target = Join-Path (Split-Path -Parent $Live) $Target }
    return [IO.Path]::GetFullPath($Target).TrimEnd('\') -ieq [IO.Path]::GetFullPath($Tavern).TrimEnd('\')
  } catch { return $false }
}
# Close DeepSeek Harness for a first install, before minutes of downloads rather than at the end.
# Returns whether it was running, so the installer reopens it when done.
function Close-DesktopForFirstInstall {
  if ($InstallHost -ne 'desktop' -or (Test-DesktopLinked)) { return $false }
  if (-not @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count) { return $false }
  Write-InstallStatus '首次安装需要先退出 DeepSeek Harness，正在关闭（装完会自动重新打开）…'
  Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | ForEach-Object { try { [void]$_.CloseMainWindow() } catch {} }
  for ($Wait = 0; $Wait -lt 10 -and @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count; $Wait++) { Start-Sleep -Seconds 1 }
  Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count) { throw '无法自动关闭 DeepSeek Harness：请在任务栏右下角托盘图标上右键退出，再重新运行安装命令。' }
  return $true
}

function Test-Command([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-Command([string]$Name) {
  $WindowsShim = Get-Command "$Name.cmd" -ErrorAction SilentlyContinue
  if ($null -ne $WindowsShim) { return $WindowsShim.Source }
  $Command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -ne $Command) { return $Command.Source }
  return $null
}

function Assert-LastCommand([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

function Invoke-SourceDownload([string]$Uri, [string]$Destination, [int]$DeadlineSec = 900) {
  # PowerShell 5.1's .NET sockets can be blocked while curl/Node still work.
  # Only publish a completed download; a failed transport must not leave bytes behind.
  # A transfer fails after 30 s without data; $DeadlineSec is only an upper bound.
  $Partial = $Destination + '.download-' + [Guid]::NewGuid().ToString('N')
  $PreviousPreference = $ErrorActionPreference
  try {
    $Downloaded = $false
    $CurlCommand = Resolve-Command 'curl.exe'
    if ($null -ne $CurlCommand) {
      $ErrorActionPreference = 'Continue'
      $CurlOutput = & $CurlCommand --fail --location --silent --show-error --connect-timeout 20 --speed-limit 1 --speed-time 30 --max-time $DeadlineSec --output $Partial --url $Uri 2>&1
      $Downloaded = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $Partial -PathType Leaf))
      $ErrorActionPreference = $PreviousPreference
    }
    if (-not $Downloaded) {
      if (Test-Path -LiteralPath $Partial) { Remove-Item -LiteralPath $Partial -Force }
      $ErrorActionPreference = 'Continue'
      $NodeOutput = & node (Get-DownloadModule) file $Partial --stall 30 --deadline $DeadlineSec --attempts 1 $Uri 2>&1
      $NodeCode = $LASTEXITCODE
      $ErrorActionPreference = $PreviousPreference
      if ($NodeCode -ne 0) { throw "下载失败，Node 退出码 ${NodeCode}：$($NodeOutput -join "`n")" }
    }
    Move-Item -LiteralPath $Partial -Destination $Destination -Force
  }
  finally {
    $ErrorActionPreference = $PreviousPreference
    if (Test-Path -LiteralPath $Partial) { Remove-Item -LiteralPath $Partial -Force }
  }
}

# Shared download module: bin/download.cjs, embedded by bin/build-installer-scripts.mjs.
$DownloadModuleSource = @'
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
'@
function Get-DownloadModule {
  $ModulePath = Join-Path $TempDir 'download.cjs'
  if (-not (Test-Path -LiteralPath $ModulePath)) { [IO.File]::WriteAllText($ModulePath, $DownloadModuleSource, (New-Object Text.UTF8Encoding($false))) }
  return $ModulePath
}

# Shared module: bin/installation-state.cjs, embedded by bin/build-installer-scripts.mjs.
$InstallationStateModuleSource = @'
'use strict'
// Dependency-free installation ownership, also embedded in standalone bootstraps.
// An abandoned lock is reclaimed only when every recorded writer (owner and
// registered stage processes) is gone, or after an idle period longer than any
// supervised stage may run. Otherwise a closed window locks the user out forever.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const LOCK_NAME = '.tavern-install.lock'
const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
const failure = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra })
const lockPath = dshHome => path.join(path.resolve(dshHome), LOCK_NAME)
const uncertain = lockDir => ({ lockDir, state: 'uncertain', unsafeToRetry: true })
// Longer than the whole supervised update (30 minutes), which refreshes progress per stage.
const STALE_IDLE_MS = 60 * 60 * 1000
// A dead owner may have just spawned descendants that registered nothing yet.
const DEAD_OWNER_GRACE_MS = 60 * 1000

function readInstallation(dshHome) {
  const lockDir = lockPath(dshHome)
  try {
    if (!fs.lstatSync(lockDir).isDirectory()) return uncertain(lockDir)
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'))
    if (!owner || typeof owner.attemptId !== 'string' || !owner.attemptId || typeof owner.generation !== 'string') return uncertain(lockDir)
    return { ...owner, lockDir }
  } catch (error) {
    if (error.code === 'ENOENT') {
      try { fs.lstatSync(lockDir) } catch (missing) { if (missing.code === 'ENOENT') return null }
    }
    return uncertain(lockDir)
  }
}

function assertOwner(dshHome, attemptId, generation) {
  const owner = readInstallation(dshHome)
  if (!owner || owner.attemptId !== attemptId || (generation && owner.generation !== generation)) {
    throw failure('INSTALLATION_OWNERSHIP_LOST', '安装任务已失去所有权，已停止写入。', { owner })
  }
  return owner
}

// Serialize all metadata changes, cancellation, final file promotions and release.
// A crashed mutation also fails closed; there is no lease timeout/automatic eviction.
function withMutation(dshHome, attemptId, generation, callback) {
  const lockDir = lockPath(dshHome)
  const gate = path.join(lockDir, '.mutation')
  const deadline = Date.now() + 5000
  const gateToken = randomUUID()
  for (;;) {
    assertOwner(dshHome, attemptId, generation)
    try {
      fs.mkdirSync(gate)
    } catch (error) {
      // Windows can report a sharing/delete-pending violation while another
      // process removes this gate. Wait for mkdir to succeed; never remove a
      // competing gate or enter the callback without acquiring it ourselves.
      if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
      if (Date.now() >= deadline) {
        // A permanent permissions failure must keep its original diagnostics.
        if (error.code !== 'EEXIST') throw error
        throw failure('INSTALLATION_STATE_BUSY', '安装状态正在写入或尚未安全结束，请勿并行重试。')
      }
      sleep(10)
      continue
    }
    // We own the directory now. A failed token write retains it conservatively
    // and must not be retried as if another process held the gate.
    fs.writeFileSync(path.join(gate, 'token'), gateToken, { flag: 'wx', mode: 0o600 })
    break
  }
  try {
    const result = callback(assertOwner(dshHome, attemptId, generation))
    if (result && typeof result.then === 'function') throw new TypeError('withOwnership callback must be synchronous')
    return result
  } finally {
    // release() renames the entire directory while holding this gate. Never touch
    // a gate belonging to an installation that appeared at the old path afterward.
    try {
      if (fs.readFileSync(path.join(gate, 'token'), 'utf8') === gateToken) {
        fs.unlinkSync(path.join(gate, 'token'))
        fs.rmdirSync(gate)
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

function writeRecord(lockDir, basename, value) {
  const filename = path.join(lockDir, basename)
  const temporary = path.join(lockDir, `.owner-${randomUUID()}.tmp`)
  let fd
  try {
    fd = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`)
    fs.fsyncSync(fd)
    fs.closeSync(fd); fd = undefined
    // Do not unlink the destination as an overwrite fallback: preserve the last
    // complete owner if antivirus/sharing violations prevent atomic replacement.
    for (let retry = 0; ; retry++) {
      try { fs.renameSync(temporary, filename); break } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || retry >= 5) throw error
        sleep(10 * (retry + 1))
      }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

const writeOwner = (lockDir, owner) => writeRecord(lockDir, 'owner.json', owner)

function releaseOwner(dshHome, attemptId, generation, pid) {
  return withMutation(dshHome, attemptId, generation, owner => {
    if (pid !== undefined && owner.pid !== pid) throw failure('INSTALLATION_OWNERSHIP_LOST', '仅安装任务的所有者可以释放安装锁。')
    if (owner.unsafeToRetry || owner.state === 'blocked') throw failure('INSTALLATION_UNSAFE', '安装子进程尚未确认停止，已保留安装锁，禁止再次写入。', { owner, unsafeToRetry: true })
    const lockDir = lockPath(dshHome)
    const removed = `${lockDir}.released-${randomUUID()}`
    fs.renameSync(lockDir, removed)
    // This unique, just-renamed directory is ours. No user installation files or
    // a successor's lock can be removed by delayed cleanup.
    fs.rmSync(removed, { recursive: true, force: true })
    return true
  })
}

function makeHandle(dshHome, initialOwner, { created = false, adopted = false } = {}) {
  const { attemptId, generation } = initialOwner
  const mayRelease = created || adopted
  let released = false
  return {
    attemptId, lockDir: lockPath(dshHome), created, adopted, joined: !mayRelease,
    get owner() { return assertOwner(dshHome, attemptId, generation) },
    assertOwnership() { return assertOwner(dshHome, attemptId, generation) },
    withOwnership(callback) { return withMutation(dshHome, attemptId, generation, callback) },
    update(patch) {
      return withMutation(dshHome, attemptId, generation, owner => {
        // Only adoption can change PID/generation. A nested installer may mark the
        // shared task unsafe, but no later progress update can silently clear it.
        const next = { ...owner, ...patch, attemptId, generation, pid: owner.pid,
          dshHome: owner.dshHome, startedAt: owner.startedAt,
          unsafeToRetry: Boolean(owner.unsafeToRetry || patch.unsafeToRetry), updatedAt: Date.now() }
        if (owner.unsafeToRetry || next.unsafeToRetry) next.state = 'blocked'
        delete next.lockDir
        writeOwner(lockPath(dshHome), next)
        return { ...next, lockDir: lockPath(dshHome) }
      })
    },
    // ownerDone: the owner itself retains on its way out, so its PID (often the
    // user's interactive shell) no longer proves a writer is alive.
    retain(reason, { ownerDone = false } = {}) {
      return this.update({ state: 'blocked', unsafeToRetry: true, blockedReason: String(reason || 'Unverified process cleanup'), ...(ownerDone ? { ownerDone: true } : {}) })
    },
    release() {
      if (!mayRelease || released) return false
      const result = releaseOwner(dshHome, attemptId, generation, initialOwner.pid)
      released = true
      return result
    },
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

// Owner plus every PID recorded under processes/<stage>/ (registrations and supervisors).
function recordedPids(lockDir, owner) {
  const pids = new Set(!owner?.ownerDone && Number.isSafeInteger(owner?.pid) && owner.pid > 1 ? [owner.pid] : [])
  const base = path.join(lockDir, 'processes')
  let stages = []
  try { stages = fs.readdirSync(base) } catch (error) { if (error.code !== 'ENOENT') return null }
  for (const stage of stages) {
    let names
    try { names = fs.readdirSync(path.join(base, stage)) } catch { continue }
    for (const name of names.filter(name => /^(\d+|supervisor)\.json$/.test(name))) {
      try {
        const pid = JSON.parse(fs.readFileSync(path.join(base, stage, name), 'utf8')).pid
        if (Number.isSafeInteger(pid) && pid > 1) pids.add(pid)
      } catch (error) { if (error.code !== 'ENOENT') return null }
    }
  }
  return pids
}

function lastActivity(lockDir, owner) {
  let latest = Math.max(0, ...[owner?.updatedAt, owner?.progressAt, owner?.startedAt].filter(Number.isFinite))
  for (const name of ['.', 'owner.json']) {
    try { latest = Math.max(latest, fs.statSync(path.join(lockDir, name)).mtimeMs) } catch {}
  }
  return latest
}

function staleReason(lockDir, owner, now = Date.now()) {
  const idle = now - lastActivity(lockDir, owner)
  if (idle > STALE_IDLE_MS) return 'idle'
  if (owner?.state === 'uncertain') return ''
  // The launched updater adopts its reservation before writing anything. If that
  // process is gone and the reservation is still unadopted, nobody can be writing.
  if (owner?.state === 'reserved') return Number.isSafeInteger(owner.launcherPid) && owner.launcherPid > 1 && !alive(owner.launcherPid) ? 'launcher-exited' : ''
  // A finished owner spawns nothing more; its stage processes register before running.
  if (!owner?.ownerDone && idle < DEAD_OWNER_GRACE_MS) return ''
  const pids = recordedPids(lockDir, owner)
  return pids && (pids.size > 0 || owner?.ownerDone) && [...pids].every(pid => !alive(pid)) ? 'writers-exited' : ''
}

// Move a stale lock aside atomically, then confirm it was the one judged stale.
function reclaimStale(dshHome, owner) {
  const lockDir = lockPath(dshHome)
  const reason = staleReason(lockDir, owner)
  if (!reason) return false
  const removed = `${lockDir}.stale-${randomUUID()}`
  try { fs.renameSync(lockDir, removed) } catch (error) {
    if (error.code === 'ENOENT') return true
    return false
  }
  let moved = null
  try { moved = JSON.parse(fs.readFileSync(path.join(removed, 'owner.json'), 'utf8')) } catch {}
  if ((moved?.generation || '') !== (owner?.generation || '')) {
    // A successor took the path between our read and rename; give it back.
    try { fs.renameSync(removed, lockDir) } catch {}
    return false
  }
  try { fs.rmSync(removed, { recursive: true, force: true }) } catch {}
  process.stderr.write(`已清理残留的安装锁（${{ idle: '超过 1 小时无进展', 'launcher-exited': '更新进程未开始安装就已退出' }[reason] || '原安装进程均已退出'}）：${lockDir}\n`)
  return true
}

function busy(owner, lockDir) {
  const since = Number.isFinite(owner?.startedAt) ? `（开始于 ${new Date(owner.startedAt).toLocaleString()}）` : ''
  return failure('INSTALLATION_BUSY', `已有安装或更新任务占用此目录${since}，请等待其结束。若确认没有安装在运行，可删除 ${lockDir} 后重试；1 小时无进展也会自动解除。`, { owner, lockDir })
}

function acquireInstallation(options = {}) {
  const { dshHome, sourceRoot = '', statusFile = '', adopt = false, state = 'running' } = options
  if (typeof dshHome !== 'string' || !dshHome) throw new TypeError('dshHome is required')
  const explicitAttempt = typeof options.attemptId === 'string' && options.attemptId.length > 0
  const attemptId = explicitAttempt ? options.attemptId : randomUUID()
  const pid = options.pid === undefined ? (state === 'reserved' ? 0 : process.pid) : options.pid
  if (!Number.isSafeInteger(pid) || pid < 0) throw new TypeError('pid must be a non-negative integer')
  const lockDir = lockPath(dshHome)
  fs.mkdirSync(path.resolve(dshHome), { recursive: true })
  for (let reclaimed = false; ;) {
    try { fs.mkdirSync(lockDir); break } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = readInstallation(dshHome)
      if (!explicitAttempt || owner?.attemptId !== attemptId) {
        if (!reclaimed && reclaimStale(dshHome, owner)) { reclaimed = true; continue }
        throw busy(owner, lockDir)
      }
      if (owner.unsafeToRetry || owner.state === 'blocked') throw failure('INSTALLATION_UNSAFE', '上次安装尚未安全结束，安装目录仍被锁定。', { owner, unsafeToRetry: true })
      if (!adopt) return makeHandle(dshHome, owner)
      const adoptedOwner = withMutation(dshHome, attemptId, owner.generation, current => {
        if (current.state !== 'reserved' || current.pid) throw failure('INSTALLATION_BUSY', '此安装任务已经开始，不能再次启动。', { owner: current })
        // Rotate fencing generation so the old reservation handle cannot release or
        // overwrite a running child, even if its delayed spawn callback fires.
        const next = { ...current, generation: randomUUID(), pid, state: 'running',
          sourceRoot: sourceRoot || current.sourceRoot, statusFile: statusFile || current.statusFile, updatedAt: Date.now() }
        delete next.lockDir
        writeOwner(lockDir, next)
        return next
      })
      return makeHandle(dshHome, adoptedOwner, { adopted: true })
    }
  }
  const owner = { attemptId, generation: randomUUID(), pid, startedAt: Date.now(),
    sourceRoot, statusFile, state, dshHome: path.resolve(dshHome) }
  // An initialization error retains the mkdir reservation conservatively. A
  // racing reader never treats an absent/partial owner file as an unlocked home.
  writeOwner(lockDir, owner)
  return makeHandle(dshHome, owner, { created: true })
}

function requestCancellation(dshHome, attemptId) {
  for (;;) {
    const owner = assertOwner(dshHome, attemptId)
    try {
      return withMutation(dshHome, attemptId, owner.generation, current => {
        const filename = path.join(lockPath(dshHome), 'cancel-request.json')
        const request = { attemptId, requestedAt: Date.now() }
        if (!fs.existsSync(filename)) writeRecord(lockPath(dshHome), 'cancel-request.json', request)
        return { ...request, owner: current }
      })
    } catch (error) {
      // Adoption rotates generation without changing this logical attempt. A
      // cancellation arriving at that exact boundary still belongs to the child.
      const current = readInstallation(dshHome)
      if (error.code === 'INSTALLATION_OWNERSHIP_LOST' && current?.attemptId === attemptId && current.generation !== owner.generation) continue
      throw error
    }
  }
}

function cancellationRequested(dshHome, attemptId) {
  const owner = readInstallation(dshHome)
  if (!owner || owner.attemptId !== attemptId) return false
  try {
    const request = JSON.parse(fs.readFileSync(path.join(lockPath(dshHome), 'cancel-request.json'), 'utf8'))
    return request.attemptId === attemptId && readInstallation(dshHome)?.generation === owner.generation
  } catch { return false }
}

// Explicit recovery only. The caller must first close and verify the complete
// durable process registry, including descendants; owner PID death is NOT proof.
function releaseStoppedInstallation({ dshHome, attemptId, generation, processesVerifiedStopped } = {}) {
  if (processesVerifiedStopped !== true || !generation) throw failure('INSTALLATION_UNSAFE', '释放安装锁前必须确认所有安装子进程均已停止。', { unsafeToRetry: true })
  return withMutation(dshHome, attemptId, generation, owner => {
    if (owner.pid) {
      try { process.kill(owner.pid, 0) } catch (error) {
        if (error.code === 'ESRCH') {
          const removed = `${lockPath(dshHome)}.released-${randomUUID()}`
          fs.renameSync(lockPath(dshHome), removed)
          fs.rmSync(removed, { recursive: true, force: true })
          return true
        }
        throw failure('INSTALLATION_UNSAFE', '无法确认安装所有者已经停止。', { unsafeToRetry: true })
      }
      throw failure('INSTALLATION_BUSY', '安装所有者仍在运行，不能释放安装锁。', { owner })
    }
    const removed = `${lockPath(dshHome)}.released-${randomUUID()}`
    fs.renameSync(lockPath(dshHome), removed)
    fs.rmSync(removed, { recursive: true, force: true })
    return true
  })
}

function main(argv) {
  const [command, ...args] = argv
  const flags = {}
  for (let index = 0; index < args.length; index += 2) flags[args[index].replace(/^--/, '')] = args[index + 1]
  const dshHome = flags.home
  if (command === 'acquire') {
    const handle = acquireInstallation({ dshHome, attemptId: flags.attempt, pid: Number(flags.pid), sourceRoot: flags.source || '', statusFile: flags.status || '' })
    const result = { attemptId: handle.attemptId, lockDir: handle.lockDir, created: handle.created, generation: handle.owner.generation }
    // Shells consume plain lines, not eval or executable text from user paths.
    if (flags.format === 'lines') console.log(`${result.attemptId}\n${result.lockDir}\n${result.created ? '1' : '0'}\n${result.generation}`)
    else console.log(JSON.stringify(result))
    return
  }
  if (command === 'release') {
    if (!flags.attempt || !flags.generation || !flags.pid) throw new TypeError('release requires attempt, generation and pid')
    return releaseOwner(dshHome, flags.attempt, flags.generation, Number(flags.pid))
  }
  if (command === 'check') {
    const owner = assertOwner(dshHome, flags.attempt)
    if (owner.unsafeToRetry || owner.state === 'blocked') throw failure('INSTALLATION_UNSAFE', '安装子进程尚未确认停止。', { unsafeToRetry: true })
    if (cancellationRequested(dshHome, flags.attempt)) throw failure('INSTALLATION_CANCELLED', '安装任务已请求中止。')
    return
  }
  if (command === 'retain') return acquireInstallation({ dshHome, attemptId: flags.attempt }).retain(flags.reason, { ownerDone: flags['owner-done'] === '1' })
  throw new Error(`Unknown installation-state command: ${command}`)
}

module.exports = { acquireInstallation, readInstallation, reclaimStaleInstallation: reclaimStale, requestCancellation, cancellationRequested, releaseStoppedInstallation, LOCK_NAME }
if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) { console.error(`${error.code || 'INSTALLATION_ERROR'}: ${error.message}`); process.exitCode = 1 }
}
'@
$InstallationOwner = $null
$InstallFailure = $null
$InstallationCompleted = $false
$InstallationStateModule = Join-Path $TempDir 'installation-state.cjs'
$PreviousInstallationAttempt = $env:DSH_TAVERN_INSTALL_ATTEMPT
$PreviousInstallationLock = $env:DSH_TAVERN_INSTALL_LOCK

$PreviousTavernAppDir = $env:DSH_TAVERN_APP_DIR
$PreviousDshHome = $env:DSH_HOME
$PreviousCliHome = $env:DSH_TAVERN_CLI_HOME
$PreviousLegacyHome = $env:DSH_TAVERN_LEGACY_DSH_HOME
$PreviousPath = $env:Path
$PreviousUpdateAttempt = $env:DSH_TAVERN_UPDATE_ATTEMPT
$PreviousNpmRegistry = $env:npm_config_registry
$PreviousPnpmRegistry = $env:pnpm_config_registry
$PreviousPnpmUpdateNotifier = $env:pnpm_config_update_notifier
$AddedProxyNames = @()
$StagedInstall = $false
$AppSwapped = $false
$PreviousApp = $false
$Stager = $null
try {
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
  $OutputEncoding = [Console]::OutputEncoding
  $env:DSH_HOME = $DshRoot
  if ($InstallHost -eq 'cli') {
    $env:DSH_TAVERN_CLI_HOME = $DshRoot
    $env:DSH_TAVERN_LEGACY_DSH_HOME = $LegacyDshRoot
  }
  # Child npm/pnpm processes, including Profile and plugin installs, inherit this.
  $env:npm_config_registry = if ($env:DSH_TAVERN_NPM_REGISTRY) { $env:DSH_TAVERN_NPM_REGISTRY } else { 'https://registry.npmmirror.com' }
  # pnpm 11 reads pnpm_config_* instead of npm_config_*.
  $env:pnpm_config_registry = $env:npm_config_registry
  # A pending optional version check can keep pnpm alive after it prints Done.
  $env:pnpm_config_update_notifier = 'false'
  if ($InstallHost -eq 'desktop') {
    # Custom install folders are found through the running app or its uninstall entry.
    # Only official DeepSeek Harness is supported.
    $DesktopNames = @('DeepSeek Harness')
    # Ignore standalone Node executables when discovering the desktop host.
    $DesktopCandidates = @($env:DSH_DESKTOP_APP_EXECUTABLE)
    if ($env:DSH_DESKTOP_NODE_EXECUTABLE -and (Split-Path -Leaf $env:DSH_DESKTOP_NODE_EXECUTABLE) -notmatch '^node(\.exe)?$') { $DesktopCandidates += $env:DSH_DESKTOP_NODE_EXECUTABLE }
    foreach ($DesktopName in $DesktopNames) {
      $DesktopCandidates += (Join-Path $env:LOCALAPPDATA ('Programs\' + $DesktopName + '\' + $DesktopName + '.exe'))
      if ($env:ProgramFiles) { $DesktopCandidates += (Join-Path $env:ProgramFiles ($DesktopName + '\' + $DesktopName + '.exe')) }
      # NSIS entries may omit InstallLocation; the uninstaller and icon paths name the same folder.
      $DesktopCandidates += @(Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like ($DesktopName + '*') } | ForEach-Object {
          $Folders = @($_.InstallLocation)
          foreach ($Entry in @($_.DisplayIcon, $_.UninstallString)) {
            if ($Entry -match '^\s*"([^"]+)"' -or $Entry -match '^\s*([^,]+?\.(exe|ico))') { $Folders += (Split-Path -Parent $Matches[1]) }
          }
          $Folders | Where-Object { $_ } | ForEach-Object { Join-Path $_ ($DesktopName + '.exe') }
        })
      $DesktopCandidates += @(Get-Process -Name $DesktopName -ErrorAction SilentlyContinue | ForEach-Object { $_.Path })
    }
    $OfficialDesktopExecutable = $DesktopCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if (-not $OfficialDesktopExecutable) {
      # A community app installed instead of the official one gets told where its installer is.
      $CommunityDesktop = @('DSH NEXT', 'DSH Desktop') | Where-Object {
        $Name = $_
        (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA ('Programs\' + $Name + '\' + $Name + '.exe'))) -or
        ($env:ProgramFiles -and (Test-Path -LiteralPath (Join-Path $env:ProgramFiles ($Name + '\' + $Name + '.exe')))) -or
        @(Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
          'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like ($Name + '*') }).Count -gt 0 -or
        @(Get-Process -Name $Name -ErrorAction SilentlyContinue).Count -gt 0
      } | Select-Object -First 1
      if ($CommunityDesktop) { throw ('检测到社区版 ' + $CommunityDesktop + '，当前版本只支持官方 DeepSeek Harness（https://deepseek.com/harness/）。继续用社区版请改用稳定版的安装命令：https://github.com/flizzywine/dsh-tavern/blob/stable/README.md') }
      throw '请先安装官方 DeepSeek Harness（https://deepseek.com/harness/）（装在其他位置时，可用 DSH_DESKTOP_APP_EXECUTABLE 指定程序路径）'
    }
    $FirstDesktopInstall = -not (Test-DesktopLinked)
    $ReopenDesktop = Close-DesktopForFirstInstall
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
    $OfficialDesktopModuleSource = @'
// Bootstrap for official DeepSeek Harness only. Electron reads packaged app.asar files.
const fs = require('node:fs');
const path = require('node:path');
const OFFICIAL = '@deepseek-ai/dsh-desktop';
const APP_NAMES = ['DeepSeek Harness'];
// Read archive metadata under plain Node as well, so unsupported hosts fail before mutation.
function asarRead(archive, relative, contents) {
  const fd = fs.openSync(archive, 'r');
  try {
    const sizes = Buffer.alloc(16);
    fs.readSync(fd, sizes, 0, 16, 0);
    const headerSize = sizes.readUInt32LE(4), jsonSize = sizes.readUInt32LE(12);
    const json = Buffer.alloc(jsonSize);
    fs.readSync(fd, json, 0, jsonSize, 16);
    let entry = JSON.parse(json.toString('utf8'));
    for (const part of relative.split(/[\\/]/).filter(Boolean)) entry = entry?.files?.[part];
    if (!entry || entry.files) return null;
    if (!contents) return '';
    if (entry.unpacked || !Number.isSafeInteger(Number(entry.offset))) return null;
    const data = Buffer.alloc(entry.size);
    fs.readSync(fd, data, 0, entry.size, 8 + headerSize + Number(entry.offset));
    return data.toString('utf8');
  } catch { return null; } finally { fs.closeSync(fd); }
}
// Split a path at the archive that contains it; null when it is not inside one. A directory named
// *.asar is not told apart here: exists() finds its files directly, and asarRead fails on it.
// (A trailing-separator check does not work: on Windows "app.asar\\" exists for the file too.)
function inAsar(file) {
  const match = /^(.*?\.asar)[\\/](.+)$/.exec(file);
  return match ? { archive: match[1], relative: match[2] } : null;
}
// A file the runner can load: on disk, or inside app.asar (readable under Electron only).
function exists(file) {
  if (fs.existsSync(file)) return true;
  const packed = inAsar(file);
  return packed !== null && fs.existsSync(packed.archive) && asarRead(packed.archive, packed.relative, false) !== null;
}
function packageName(app) {
  try { return JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).name || ''; } catch {}
  try { return app.endsWith('.asar') ? String(JSON.parse(asarRead(app, 'package.json', true) || '{}').name || '') : ''; } catch { return ''; }
}
function layout(executable, platform = process.platform) {
  const resources = platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources') : path.join(path.dirname(executable), 'resources');
  const unpacked = path.join(resources, 'app'), packed = path.join(resources, 'app.asar');
  const app = fs.existsSync(path.join(unpacked, 'package.json')) ? unpacked : packed;
  const name = packageName(app);
  const host = path.join(app, 'dsh');
  return { resources, app, name, host, bootstrap: path.join(host, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'), pnpm: path.join(resources, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') };
}
function prepare({ executable, home, env = process.env, platform = process.platform }) {
  if (!executable || !home) throw Error('请先安装官方 DeepSeek Harness，并指定安装目录');
  const paths = layout(executable, platform);
  if (paths.name !== OFFICIAL) throw Error('桌面版仅支持官方 DeepSeek Harness：' + executable
    + '（读到的应用包名：' + (paths.name || '无法读取') + '，应用目录：' + paths.app + '）');
  const bootstrap = paths.bootstrap;
  for (const file of [bootstrap, paths.pnpm]) if (!exists(file)) throw Error('桌面运行时不完整：' + file);
  const runner = executable;
  const dshRunner = runner, pnpmRunner = runner;
  const runnerOf = name => name === 'dsh' ? dshRunner : name === 'pnpm' ? pnpmRunner : runner;
  const variableOf = name => name === 'dsh' ? 'DSH_DESKTOP_DSH_RUNNER' : name === 'pnpm' ? 'DSH_DESKTOP_PNPM_RUNNER' : 'DSH_DESKTOP_NODE_EXECUTABLE';
  const bin = path.join(home, 'tools', 'official-desktop', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  for (const [name, entry] of [['node', null], ['pnpm', paths.pnpm], ['dsh', bootstrap]]) {
    const file = path.join(bin, name + (platform === 'win32' ? '.cmd' : ''));
    const text = platform === 'win32'
      ? '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%' + variableOf(name) + '%" --expose-internals ' + (entry ? '"%' + (name === 'dsh' ? 'DSH_DESKTOP_DSH_BOOTSTRAP' : 'DSH_DESKTOP_PNPM_ENTRY') + '%" ' : '') + '%*\r\nexit /b %errorlevel%\r\n'
      : '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ' + quote(runnerOf(name)) + ' --expose-internals ' + (entry ? quote(entry) + ' ' : '') + '"$@"\n';
    fs.writeFileSync(file, text, { mode: 0o755 });
  }
  const key = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  // NODE_EXECUTABLE runs installer code and `node`; PNPM_RUNNER runs pnpm; DSH_RUNNER runs the DSH entry.
  return { DSH_HOME: path.resolve(home), DSH_DESKTOP_NODE_EXECUTABLE: runner, DSH_DESKTOP_APP_EXECUTABLE: executable,
    DSH_DESKTOP_PNPM_RUNNER: pnpmRunner, DSH_DESKTOP_DSH_RUNNER: dshRunner, DSH_DESKTOP_DSH_BOOTSTRAP: bootstrap, DSH_DESKTOP_PNPM_ENTRY: paths.pnpm,
    DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: path.join(paths.host, 'package.json'),
    [key]: bin + (platform === 'win32' ? ';' : ':') + (env[key] || '') };
}
function discover(env = process.env, platform = process.platform) {
  // A standalone node executable is not a desktop host.
  const node = env.DSH_DESKTOP_NODE_EXECUTABLE && !/^node(\.exe)?$/i.test(path.basename(env.DSH_DESKTOP_NODE_EXECUTABLE)) ? env.DSH_DESKTOP_NODE_EXECUTABLE : undefined;
  const candidates = [env.DSH_DESKTOP_APP_EXECUTABLE, node, process.versions.electron ? process.execPath : undefined];
  for (const app of APP_NAMES) {
    if (platform === 'darwin') candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`, path.join(require('node:os').homedir(), `Applications/${app}.app/Contents/MacOS/${app}`));
    if (platform === 'win32') for (const root of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles]) if (root) candidates.push(path.join(root, app, app + '.exe'));
  }
  const executable = candidates.find(file => file && fs.existsSync(file));
  if (!executable) throw Error('找不到官方 DeepSeek Harness；请先安装，或用 DSH_DESKTOP_APP_EXECUTABLE 指定程序路径');
  return executable;
}
// Installer code always runs under the official app's Electron.
function runner(executable) { return executable; }
module.exports = { layout, prepare, discover, runner, APP_NAMES };
if (require.main === module) {
  try {
    const result = prepare({ executable: process.versions.electron ? process.execPath : discover(), home: process.argv[2] });
    if (process.argv.includes('--shell')) for (const [key, value] of Object.entries(result)) console.log('export ' + key + "='" + value.replaceAll("'", "'\\''") + "'");
    else console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
'@
    $OfficialDesktopModule = Join-Path $TempDir 'official-desktop-runtime.cjs'
    [IO.File]::WriteAllText($OfficialDesktopModule, $OfficialDesktopModuleSource, (New-Object Text.UTF8Encoding($false)))
    $PreviousElectronNode = $env:ELECTRON_RUN_AS_NODE
    try {
      $env:ELECTRON_RUN_AS_NODE = '1'
      # The desktop app is a GUI-subsystem program: & neither waits for it nor sets
      # $LASTEXITCODE, so the check failed every time. Run it as a waited child process.
      $DesktopStart = New-Object System.Diagnostics.ProcessStartInfo
      # Use the official desktop Electron runtime.
      $DesktopRunner = $OfficialDesktopExecutable
      $env:DSH_DESKTOP_APP_EXECUTABLE = $OfficialDesktopExecutable
      $DesktopStart.FileName = $DesktopRunner
      $DesktopStart.Arguments = (@('--expose-internals', $OfficialDesktopModule, $DshRoot) | ForEach-Object { '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }) -join ' '
      $DesktopStart.UseShellExecute = $false
      $DesktopStart.CreateNoWindow = $true
      $DesktopStart.RedirectStandardOutput = $true
      $DesktopStart.RedirectStandardError = $true
      $DesktopStart.StandardOutputEncoding = $DesktopStart.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
      $DesktopProcess = [System.Diagnostics.Process]::Start($DesktopStart)
      $DesktopErrors = $DesktopProcess.StandardError.ReadToEndAsync()
      $DesktopEnvironment = $DesktopProcess.StandardOutput.ReadToEnd()
      $DesktopProcess.WaitForExit()
      if ($DesktopProcess.ExitCode -ne 0) { throw ('桌面运行环境校验失败：' + $DesktopErrors.Result.Trim()) }
      ($DesktopEnvironment | ConvertFrom-Json).PSObject.Properties | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, [string]$_.Value, 'Process') }
    } finally { $env:ELECTRON_RUN_AS_NODE = $PreviousElectronNode }
  }
  if (-not (Test-Command 'node')) {
    Start-Process 'https://nodejs.org/'
    throw '未找到 Node.js。请安装 Node.js 22.19 或更高版本，然后重新运行本命令。'
  }

  $NodeVersionText = (& node --version).Trim()
  $NodeVersion = [version]$NodeVersionText.TrimStart('v')
  if ($NodeVersion -lt [version]'22.19.0') {
    throw "Node.js 版本过低，需要 22.19 或更高版本（当前：$NodeVersionText）。"
  }
  # Reserve before installation markers, persistent PATH, logs or source writes.
  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  [IO.File]::WriteAllText($InstallationStateModule, $InstallationStateModuleSource, (New-Object Text.UTF8Encoding($false)))
  $OwnerArguments = @($InstallationStateModule, 'acquire', '--home', $DshRoot, '--pid', [string]$PID, '--source', $AppDir)
  if ($env:DSH_TAVERN_INSTALL_ATTEMPT) { $OwnerArguments += @('--attempt', $env:DSH_TAVERN_INSTALL_ATTEMPT) }
  $OwnerJson = & node @OwnerArguments
  Assert-LastCommand '已有安装任务占用此目录，尚未安全结束。'
  $InstallationOwner = ($OwnerJson -join "`n") | ConvertFrom-Json
  $env:DSH_TAVERN_INSTALL_ATTEMPT = $InstallationOwner.attemptId
  $env:DSH_TAVERN_INSTALL_LOCK = $InstallationOwner.lockDir
  # Resolve under the installation lease before any source/profile writes.
  $InstallationLocationModule = Join-Path $TempDir 'installation-location.cjs'
  [IO.File]::WriteAllText($InstallationLocationModule, $InstallationLocationModuleSource, (New-Object Text.UTF8Encoding($false)))
  # Keep stdout exclusively for the resolved path; surface the resolver's actual
  # reason instead of classifying every filesystem failure as a migration error.
  $LocationErrorFile = Join-Path $TempDir 'installation-location-error.log'
  $PreviousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $ResolvedAppDir = & node $InstallationLocationModule $DshRoot $env:DSH_TAVERN_APP_DIR 2> $LocationErrorFile
    $LocationExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $PreviousPreference }
  if ($LocationExitCode -ne 0) {
    $LocationReason = (Get-Content -LiteralPath $LocationErrorFile -Raw -ErrorAction SilentlyContinue)
    if ([string]::IsNullOrWhiteSpace($LocationReason)) { $LocationReason = '无法验证安装目录；请检查目录权限与链接。' }
    throw "安装目录安全检查失败，未修改安装：$LocationReason"
  }
  $AppDir = ($ResolvedAppDir -join "`n").Trim()
  $env:DSH_TAVERN_APP_DIR = $AppDir
  if ($InstallHost -eq 'cli') {
    Set-Content -LiteralPath (Join-Path $DshRoot '.dsh-tavern-install-root') -Value 'cli-v1'
  }
  $GitCommand = Resolve-Command 'git'
  $NpmCommand = Resolve-Command 'npm'
  if ($InstallHost -eq 'cli' -and $null -eq $NpmCommand) { throw '未找到 npm，请重新安装 Node.js。' }

  if ($InstallHost -eq 'cli') {
    $env:Path = "$RuntimeRoot;$env:Path"
    $env:DSH_TAVERN_BIN_DIR = $CommandBin
    $env:Path = "$CommandBin;$env:Path"
    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $UserEntries = @($UserPath -split ';' | Where-Object { $_ -ne '' })
    if (-not ($UserEntries | Where-Object { $_.TrimEnd('\') -ieq $CommandBin.TrimEnd('\') })) {
      $NewUserPath = (@($UserEntries) + $CommandBin) -join ';'
      [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
    }
  }

  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  # node, curl, git and pnpm ignore the Windows system proxy; export it as HTTP(S)_PROXY
  # when none is set (bin/download.cjs proxy-env). Detection must never block installation.
  $PreviousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    foreach ($ProxyLine in @(& node (Get-DownloadModule) proxy-env 2>$null)) {
      if ([string]$ProxyLine -match '^([A-Z_]+)=(.*)$') { $AddedProxyNames += $Matches[1]; Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2] }
      elseif ([string]$ProxyLine -like 'DSH_STATUS *') { Write-InstallStatus ([string]$ProxyLine).Substring(11) }
    }
  } catch { Write-Warning "无法读取系统代理设置：$($_.Exception.Message)" }
  finally { $ErrorActionPreference = $PreviousPreference }
  $UpdateLogRoot = if ($env:DSH_TAVERN_UPDATE_LOG_ROOT) { $env:DSH_TAVERN_UPDATE_LOG_ROOT } else { Join-Path $DshRoot 'profile-data/tavern/data' }
  $UpdateAttempt = if ($env:DSH_TAVERN_UPDATE_ATTEMPT) { $env:DSH_TAVERN_UPDATE_ATTEMPT } else { $env:DSH_TAVERN_INSTALL_ATTEMPT }
  $env:DSH_TAVERN_UPDATE_ATTEMPT = $UpdateAttempt
  $UpdateLogger = Join-Path $TempDir 'update-log.cjs'
  [IO.File]::WriteAllText($UpdateLogger, @'
const fs=require('node:fs'),path=require('node:path');
try {
 const [root,event,step,exitCode,startedAt,file]=process.argv.slice(2).map(v=>v==='-'?'':v);
 const clean=value=>String(value||'').replace(/https?:\/\/[^\s<>"')]+/g,raw=>{try{const u=new URL(raw);return u.origin+u.pathname}catch{return '[URL]'}}).replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]').replace(/((?:authorization|token|password|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]');
 let output=file&&fs.existsSync(file)?clean(fs.readFileSync(file,'utf8')):'';
 const outputCharacters=output.length;
 if(output.length>6000)output=output.slice(0,3000)+'\n[中间输出省略]\n'+output.slice(-3000);
 const record={at:new Date().toISOString(),pid:process.ppid,attemptId:process.env.DSH_TAVERN_UPDATE_ATTEMPT,event,step,exitCode:exitCode===''?undefined:Number(exitCode),durationMs:startedAt?Date.now()-Number(startedAt):undefined,output,outputCharacters};
 fs.mkdirSync(root,{recursive:true});const target=path.join(root,'update-diagnostics.jsonl');
 try{if(fs.statSync(target).size>1048576){try{fs.unlinkSync(target+'.1')}catch{}fs.renameSync(target,target+'.1')}}catch{}
 fs.appendFileSync(target,JSON.stringify(record)+'\n');
}catch{process.exitCode=1}
'@, (New-Object Text.UTF8Encoding($false)))
  function Write-UpdateLog([string]$Event, [string]$Step, [string]$Code = '', [string]$Started = '', [string]$OutputFile = '') {
    try {
      $LogArgs = @($UpdateLogRoot, $Event, $Step, $Code, $Started, $OutputFile) | ForEach-Object { if ($_ -eq '') { '-' } else { $_ } }
      & node $UpdateLogger @LogArgs *> $null
      if ($LASTEXITCODE -eq 0) { return }
    } catch {}
    # Logging must still work when the Desktop Node shim itself is broken.
    try {
      $Text = if ($OutputFile -and (Test-Path -LiteralPath $OutputFile)) { [IO.File]::ReadAllText($OutputFile) } else { '' }
      $Text = [regex]::Replace($Text, 'https?://[^\s<>"'')]+', { param($m) try { $u = [Uri]$m.Value; $u.GetLeftPart([UriPartial]::Authority) -replace '://[^/]*@', '://' } catch { '[URL]' } })
      $Text = $Text -replace '(?i)Bearer\s+[^\s,;]+', 'Bearer [redacted]' -replace '(?i)((?:authorization|token|password|api[_-]?key)\s*[:=]\s*)[^\s,;]+', '$1[redacted]'
      $Count = $Text.Length
      if ($Count -gt 6000) { $Text = $Text.Substring(0,3000) + "`n[中间输出省略]`n" + $Text.Substring($Count-3000) }
      $Record = @{ at = [DateTime]::UtcNow.ToString('o'); attemptId = $env:DSH_TAVERN_UPDATE_ATTEMPT; event = $Event; step = $Step; output = $Text; outputCharacters = $Count }
      if ($Code -ne '') { $Record.exitCode = [int]$Code }
      if ($Started -ne '') { $Record.durationMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long]$Started }
      New-Item -ItemType Directory -Force -Path $UpdateLogRoot | Out-Null
      $LogPath = Join-Path $UpdateLogRoot 'update-diagnostics.jsonl'
      if ((Test-Path -LiteralPath $LogPath) -and (Get-Item -LiteralPath $LogPath).Length -gt 1048576) { Move-Item -LiteralPath $LogPath -Destination "$LogPath.1" -Force }
      [IO.File]::AppendAllText($LogPath, (($Record | ConvertTo-Json -Compress) + "`n"), (New-Object Text.UTF8Encoding($false)))
    } catch { Write-Warning "诊断日志写入失败：$($_.Exception.Message)" }
  }
  function Assert-InstallFiles([string]$Root) {
    foreach ($Relative in @('package.json', 'pnpm-lock.yaml', 'bin\dsh-compatibility.mjs', 'tavern-plugin\lib\domain\host-compatibility.js', 'bin\dsh-tavern.mjs', 'config\dsh-compatibility.json')) {
      $Required = Join-Path $Root $Relative
      if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { throw "安装文件不完整，缺少：$Required" }
    }
  }
  function Invoke-UpdateGit([string]$Step, [string[]]$GitArgs) {
    $Started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $GitStatus = switch ($Step) { 'git.clone' { '下载代码：首次获取 GitHub 运行代码…' } 'git.fetch' { '下载代码：正在同步 GitHub 最新版本…' } 'git.archive' { '下载代码：正在准备 Git 运行文件…' } default { '下载代码：正在检查 Git 源…' } }
    Write-InstallStatus $GitStatus
    Write-UpdateLog 'installer.stage.started' $Step
    $PreviousPreference = $ErrorActionPreference
    $Output = @()
    $Code = 1
    try {
      $ErrorActionPreference = 'Continue'
      $LastGitProgress = ''
      $Output = @(& $GitCommand -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30 @GitArgs 2>&1 | ForEach-Object {
        $GitLine = [string]$_
        if ($GitLine -match '(Receiving objects|Resolving deltas):\s+(\d+)%') {
          $GitProgress = if ($Matches[1] -eq 'Receiving objects') { "GitHub 接收文件：$($Matches[2])%（当前步骤）" } else { "Git 整理文件：$($Matches[2])%（当前步骤）" }
          if ($GitProgress -ne $LastGitProgress) { Write-InstallStatus $GitProgress; $LastGitProgress = $GitProgress }
        }
        $_
      })
      $Code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $PreviousPreference }
    $OutputFile = Join-Path $TempDir 'git.output'
    [IO.File]::WriteAllText($OutputFile, ($Output -join "`n"), (New-Object Text.UTF8Encoding($false)))
    $Event = if ($Code -eq 0) { 'installer.stage.succeeded' } else { 'installer.stage.failed' }
    Write-UpdateLog $Event $Step ([string]$Code) ([string]$Started) $OutputFile
    if ($Code -ne 0) { throw "Git 步骤失败：$Step（退出码 $Code）：$($Output -join "`n")" }
    return ($Output -join "`n")
  }
  function Invoke-InstallCommand([string]$Step, [string]$Command, [string[]]$CommandArgs, [switch]$CaptureOutput, [int]$TimeoutMs = 600000) {
    $Started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Write-UpdateLog 'installer.stage.started' $Step
    $OutputFile = Join-Path $TempDir 'command.output'
    $ErrorFile = Join-Path $TempDir 'command.error'
    [IO.File]::WriteAllText($OutputFile, '')
    [IO.File]::WriteAllText($ErrorFile, '')
    # The launcher start intentionally creates a long-lived service. All other
    # downloaded-release stages must close their complete process tree first.
    $Supervisor = $null
    if ($Step -ne 'service.start') {
      $SupervisorCandidates = @()
      if ($null -ne $SourceDir) { $SupervisorCandidates += (Join-Path $SourceDir.FullName 'bin\installation-process.mjs') }
      if ($AppDir) { $SupervisorCandidates += (Join-Path $AppDir 'bin\installation-process.mjs') }
      foreach ($Candidate in $SupervisorCandidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) { $Supervisor = $Candidate; break }
      }
    }
    if ($Supervisor) {
      $CommandArgs = @($Supervisor, '--run', $Step, [string]$TimeoutMs, $Command) + $CommandArgs
      $Command = 'node'
    }
    $PreviousPreference = $ErrorActionPreference
    $Code = 1
    $InvocationError = ''
    # At a console these steps show only their progress, every few seconds; everything else is logged.
    $Quiet = $FriendlyOutput -and $Step -in @('source.files', 'dependencies.install', 'dependencies.relink', 'profile.install')
    $PackageLabel = if ($Step -eq 'profile.install') { '本地配置' } else { '安装依赖' }
    $ShownAt = [DateTime]::MinValue
    try {
      $ErrorActionPreference = 'Continue'
      & $Command @CommandArgs 2>&1 | ForEach-Object {
        $Line = [string]$_
        if ($_ -is [System.Management.Automation.ErrorRecord]) {
          [IO.File]::AppendAllText($ErrorFile, "$Line`n")
          if (-not $Quiet) { Write-Host $Line }
        } else {
          [IO.File]::AppendAllText($OutputFile, "$Line`n")
          if ($FriendlyOutput -and $Line -like 'DSH_STATUS *') { Write-InstallStatus $Line.Substring(11) }
          elseif ($Quiet) {
            # pnpm skips resolution with a lockfile, so resolved stays 0: no total to show.
            if ($Line -match '^Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)' -and ($Line -like '*, done*' -or ([DateTime]::Now - $ShownAt).TotalSeconds -ge 5)) {
              $ShownAt = [DateTime]::Now
              Write-InstallStatus ("$PackageLabel：已装 $($Matches[4]) 个包（本地复用 $($Matches[2])，新下载 $($Matches[3])）")
            }
          }
          elseif (-not $CaptureOutput) { Write-Host $Line }
        }
      }
      $Code = $LASTEXITCODE
    } catch { $InvocationError = $_.Exception.ToString() }
    finally { $ErrorActionPreference = $PreviousPreference }
    $Stdout = if (Test-Path $OutputFile) { [IO.File]::ReadAllText($OutputFile) } else { '' }
    $Stderr = if (Test-Path $ErrorFile) { [IO.File]::ReadAllText($ErrorFile) } else { '' }
    $Combined = "$Stdout`n$Stderr`n$InvocationError".Trim()
    [IO.File]::WriteAllText($OutputFile, $Combined, (New-Object Text.UTF8Encoding($false)))
    $Event = if ($Code -eq 0) { 'installer.stage.succeeded' } else { 'installer.stage.failed' }
    Write-UpdateLog $Event $Step ([string]$Code) ([string]$Started) $OutputFile
    if ($Code -ne 0) {
      # The output was shown as it ran and is in the diagnostics log: name the reason once.
      if ($CaptureOutput) { throw "步骤 $Step 失败（退出码 $Code）。`n$Combined" }
      $Reason = @($Combined -split "`r?`n" | Where-Object { $_.Trim() -and $_ -notmatch '^INSTALLATION_PROCESS_FAILED|^DSH_STATUS ' }) | Select-Object -Last 1
      throw ("步骤 $Step 失败（退出码 $Code）" + $(if ($Reason) { "：$($Reason.Trim())" } else { '。' }))
    }
    if ($CaptureOutput) { return $Stdout.Trim() }
  }
  Write-UpdateLog 'installer.started' 'bootstrap'
  if (-not $FriendlyOutput) { Write-Host "更新诊断日志：$UpdateLogRoot/update-diagnostics.jsonl" }
  $ArchivePath = Join-Path $TempDir 'app.zip'
  $ExtractDir = Join-Path $TempDir 'extract'
  $UsedGit = $false
  $UsedArchive = $false
  $UsedCdn = $false
  if ($null -ne $GitCommand) {
    try {
      Write-InstallStatus '下载代码：正在连接 GitHub，使用 Git 增量同步…'
      New-Item -ItemType Directory -Force -Path (Split-Path $SourceCache -Parent) | Out-Null
      if (-not (Test-Path (Join-Path $SourceCache 'HEAD'))) {
        Invoke-UpdateGit 'git.clone' @('clone', '--progress', '--bare', '--filter=blob:none', '--depth', '1', '--single-branch', '--branch', 'main', $RepositoryUrl, $SourceCache) | Write-Host
      }
      Invoke-UpdateGit 'git.remote' @("--git-dir=$SourceCache", 'remote', 'set-url', 'origin', $RepositoryUrl) | Write-Host
      Invoke-UpdateGit 'git.fetch' @("--git-dir=$SourceCache", 'fetch', '--progress', '--depth', '1', 'origin', 'main') | Write-Host
      $TargetCommit = (Invoke-UpdateGit 'git.revision' @("--git-dir=$SourceCache", 'rev-parse', 'FETCH_HEAD')).Trim()
      Invoke-UpdateGit 'git.archive' (@('-c', 'core.autocrlf=false', '-c', 'core.eol=lf', "--git-dir=$SourceCache", 'archive', '--format=zip', "--output=$ArchivePath", 'FETCH_HEAD', '--') + $RuntimePaths) | Write-Host
      $UsedGit = $true
    }
    catch {
      Write-InstallStatus 'GitHub 同步失败或连接过慢，正在切换 jsDelivr 备用源；详细原因见日志。'
      Write-Warning ("Git 增量更新失败，正在尝试 jsDelivr 备用源：" + $_.Exception.Message)
    }
  }
  if ($null -eq $GitCommand) { Write-UpdateLog 'installer.stage.failed' 'git.unavailable' '127'; if ($FriendlyOutput) { Write-InstallStatus '下载代码：未安装 Git，改用 jsDelivr 下载' } else { Write-Warning '未找到 Git，正在尝试备用源。' } }
  if (-not $UsedGit) {
    # GitHub 的整包下载优先于 jsDelivr：CDN 的 @main 会滞后十几小时。
    Write-InstallStatus '下载代码：正在连接 GitHub，下载精简运行压缩包…'
    $PreviousProgressPreference = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
      if ($TargetCommit -eq '') {
        try {
          $CommitPath = Join-Path $TempDir 'commit.json'
          Invoke-SourceDownload $CommitUrl $CommitPath 60
          $TargetCommit = ([IO.File]::ReadAllText($CommitPath) | ConvertFrom-Json).sha
        }
        catch { Write-Warning '无法记录当前提交号，不影响本次安装。' }
      }
      for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
        try {
          Invoke-SourceDownload $ArchiveUrl $ArchivePath 900
          break
        }
        catch {
          if ($Attempt -eq 3) { throw }
          Write-InstallStatus "压缩包下载失败，2 秒后重试（已尝试 $Attempt/3）；请检查网络或查看日志。"
          Start-Sleep -Seconds 2
        }
      }
      $UsedArchive = $true
    }
    catch {
      Write-InstallStatus 'GitHub 压缩包不可用，正在切换 jsDelivr 备用源；详细原因见日志。'
      Write-Warning ("GitHub 压缩包下载失败，将回退到 jsDelivr 备用源：" + $_.Exception.Message)
    }
    finally {
      $ProgressPreference = $PreviousProgressPreference
    }
  }
  if (-not $UsedGit -and -not $UsedArchive) {
    try {
      Write-InstallStatus '下载代码：GitHub 压缩包不可用，正在连接 jsDelivr 备用源…'
      Write-UpdateLog 'installer.stage.started' 'source.jsdelivr'
      $CdnSource = Join-Path $TempDir 'cdn-source'
      New-Item -ItemType Directory -Force -Path $CdnSource | Out-Null
      Invoke-InstallCommand 'source.files' 'node' @((Get-DownloadModule), 'runtime', $CdnMetadataUrl, $CdnRootUrl, $CdnSource, $AppDir, '--min-version', $InstallerVersion)
      $TargetCommit = [string]([IO.File]::ReadAllText((Join-Path $CdnSource 'dsh-tavern-runtime.json')) | ConvertFrom-Json).revision
      Write-UpdateLog 'installer.stage.succeeded' 'source.jsdelivr' '0'
      $UsedCdn = $true
    }
    catch {
      $CdnErrorFile = Join-Path $TempDir 'cdn.error'
      [IO.File]::WriteAllText($CdnErrorFile, $_.Exception.ToString(), (New-Object Text.UTF8Encoding($false)))
      Write-UpdateLog 'installer.stage.failed' 'source.jsdelivr' '1' '' $CdnErrorFile
      Write-InstallStatus 'jsDelivr 备用源也不可用；详细原因见日志。'
      Write-Warning ("jsDelivr 备用源不可用：" + $_.Exception.Message)
    }
  }
  if (-not $UsedGit -and -not $UsedArchive -and -not $UsedCdn) {
    throw 'Git、GitHub 压缩包与 jsDelivr 均未能取到源码，请检查网络后重试。'
  }
  if (-not $UsedCdn) {
    New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
    Write-InstallStatus '本地处理：下载完成，正在解压运行文件…'
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractDir -Force
    # Only the temporary download is pruned; never remove installed user files.
    @(Get-ChildItem -LiteralPath $ExtractDir -Directory -Recurse -Filter 'docs') |
      Sort-Object { $_.FullName.Length } -Descending |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
  }
  Write-InstallStatus '本地处理：正在校验安装文件…'
  $SourceDir = if ($UsedCdn) {
    Get-Item -LiteralPath $CdnSource
  } elseif ($UsedGit) {
    Get-Item -LiteralPath $ExtractDir
  } else {
    Get-ChildItem -LiteralPath $ExtractDir -Directory | Select-Object -First 1
  }
  if ($null -eq $SourceDir) { throw '下载内容不完整。' }
  if (-not (Test-Path (Join-Path $SourceDir.FullName 'package.json'))) {
    throw '下载内容不完整。'
  }
  Assert-InstallFiles $SourceDir.FullName

  # Read compatibility from the downloaded release before installing missing tools.
  $CompatibilityScript = Join-Path $SourceDir.FullName 'bin\dsh-compatibility.mjs'
  $AdaptedDshVersion = (& node $CompatibilityScript --version)
  Assert-LastCommand '读取 DSH 适配版本失败。'
  $AdaptedDshVersion = $AdaptedDshVersion.Trim()
  & node $CompatibilityScript --notice $InstallHost
  Assert-LastCommand '读取 DSH 兼容提示失败。'
  $MissingPackages = @()
  $PnpmCommand = Resolve-Command 'pnpm'
  $PnpmNeedsInstall = $false
  if ($InstallHost -eq 'cli') {
    if ($null -eq $PnpmCommand) {
      $PnpmNeedsInstall = $true
    }
    else {
      try { $PnpmNeedsInstall = ((Invoke-InstallCommand 'dependencies.version' $PnpmCommand @('--version') -CaptureOutput -TimeoutMs 30000).Trim() -ne $PnpmVersion) }
      catch { $PnpmNeedsInstall = $true }
    }
  }
  & node $InstallationStateModule check --home $DshRoot --attempt $InstallationOwner.attemptId
  Assert-LastCommand '安装任务已中止或子进程尚未安全结束。'
  if ($PnpmNeedsInstall) { $MissingPackages += "pnpm@$PnpmVersion" }
  if ($MissingPackages.Count -gt 0) {
    Write-Host ("正在安装缺失依赖：" + ($MissingPackages -join '、') + '……')
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Invoke-InstallCommand 'tooling.install' $NpmCommand (@('install', '--global', '--prefix', $RuntimeRoot) + $MissingPackages)
  }
  $PnpmCommand = Resolve-Command 'pnpm'
  if ($null -eq $PnpmCommand) { throw '未找到 pnpm。Desktop 版请先安装官方 DeepSeek Harness，再重新运行安装命令。' }
  $DshCommand = Resolve-Command 'dsh'
  if ($InstallHost -ne 'cli' -and $null -eq $DshCommand) { throw '未找到 DSH。Desktop 版请先安装官方 DeepSeek Harness，再重新运行安装命令。' }

  # Validate before replacing any installed application files.
  if ($InstallHost -ne 'cli') {
    $CurrentDshVersion = Invoke-InstallCommand 'host.version' $DshCommand @('--version') -CaptureOutput -TimeoutMs 30000
    & node $CompatibilityScript --check $InstallHost ($CurrentDshVersion -join "`n")
    Assert-LastCommand '宿主 DSH 版本不可用，尚未覆盖程序文件。'
  }

  $Stager = Join-Path $SourceDir.FullName 'bin\staged-app-install.mjs'
  $OldLauncher = Join-Path $AppDir 'bin\dsh-tavern.mjs'
  if ($InstallHost -eq 'cli' -and (Test-Path -LiteralPath $Stager -PathType Leaf)) {
    # Prepare beside the running app; only the final switch stops the service, and a
    # failure after it restores the previous directory (see bin/staged-app-install.mjs).
    $StagedInstall = $true
    Write-InstallStatus '本地处理：正在准备新版本，当前版本继续运行…'
    & node $Stager prepare --app $AppDir --source $SourceDir.FullName --commit $TargetCommit | Out-Null
    Assert-LastCommand '准备新版本失败，当前版本未改动。'
    Write-InstallStatus '安装依赖：正在连接软件包仓库，已有缓存将直接复用…'
    Invoke-InstallCommand 'dependencies.install' $PnpmCommand @('--dir', "$AppDir.staging", 'install', '--frozen-lockfile', '--config.minimum-release-age=0', '--reporter=append-only', '--fetch-timeout=30000', '--fetch-retries=2', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000')

    if (Test-Path $OldLauncher) {
      $PreviousApp = $true
      & node $OldLauncher stop *> $null
    }
    Write-InstallStatus '本地处理：正在切换到新版本，保留用户数据…'
    # Windows refuses to rename a directory that is any process's working directory.
    Set-Location -LiteralPath ([System.IO.Path]::GetTempPath())
    $AppSwapped = $true
    & node $Stager swap --app $AppDir
    Assert-LastCommand ('切换新版本失败，已恢复原版本。安装目录可能被占用：请关闭位于 ' + $AppDir + ' 中的终端、资源管理器窗口或编辑器后重试。')
    # Re-link in place: Windows junctions and pnpm metadata record absolute paths.
    Invoke-InstallCommand 'dependencies.relink' $PnpmCommand @('--dir', $AppDir, 'install', '--offline', '--frozen-lockfile', '--config.minimum-release-age=0', '--reporter=append-only', '--fetch-timeout=30000', '--fetch-retries=2', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000') -TimeoutMs 300000

    Write-InstallStatus '本地配置：正在注册 Tavern 并检查兼容性…'
    if (Close-DesktopForFirstInstall) { $ReopenDesktop = $true }
    Invoke-InstallCommand 'profile.install' 'node' @((Join-Path $AppDir 'bin\dsh-tavern.mjs'), 'install', '--host', $InstallHost) -TimeoutMs 1200000
    & node $Stager commit --app $AppDir
    $AppSwapped = $false
  }
  else {
    $OldLauncher = Join-Path $AppDir 'bin\dsh-tavern.mjs'
    if ($InstallHost -eq 'cli' -and (Test-Path $OldLauncher)) {
      & node $OldLauncher stop *> $null
    }

    Write-InstallStatus '本地处理：正在更新程序文件，保留用户数据…'
    New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
    # 覆盖程序文件但不删除旧目录，因此未被发布包跟踪的 data\ 用户数据会保留。
    # 新版本自带的清理脚本只删除上次安装放入、而新版本已不再包含的文件；失败不影响安装。
    $PruneScript = Join-Path $SourceDir.FullName 'bin\prune-installed-files.mjs'
    if (Test-Path -LiteralPath $PruneScript) {
      & node $PruneScript $SourceDir.FullName $AppDir
      if ($LASTEXITCODE -ne 0) { Write-Warning '旧版本遗留文件清理失败，继续安装。' }
    }
    Get-ChildItem -LiteralPath $SourceDir.FullName -Force | Copy-Item -Destination $AppDir -Recurse -Force
    Assert-InstallFiles $AppDir
    $PathsFile = Join-Path $TempDir 'install-paths.txt'
    [IO.File]::WriteAllText($PathsFile, "Host=$InstallHost`nDSH_HOME=$DshRoot`nAppDir=$AppDir`nSource=$($SourceDir.FullName)`nCommit=$TargetCommit`nNode=$((Get-Command node).Source)", (New-Object Text.UTF8Encoding($false)))
    Write-UpdateLog 'installer.paths' 'files.copy' '0' '' $PathsFile
    if ($UsedCdn -and (Test-Path (Join-Path $AppDir '.dsh-tavern-release.json'))) {
      Remove-Item -LiteralPath (Join-Path $AppDir '.dsh-tavern-release.json') -Force
    }
    if ($TargetCommit -match '^[0-9a-fA-F]{40}$') {
      $ReleaseJson = @{ commit = $TargetCommit; installedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
      [IO.File]::WriteAllText((Join-Path $AppDir '.dsh-tavern-release.json'), $ReleaseJson, (New-Object Text.UTF8Encoding($false)))
    }

    Write-InstallStatus '安装依赖：正在连接软件包仓库，已有缓存将直接复用…'
    Invoke-InstallCommand 'dependencies.install' $PnpmCommand @('--dir', $AppDir, 'install', '--frozen-lockfile', '--config.minimum-release-age=0', '--reporter=append-only', '--fetch-timeout=30000', '--fetch-retries=2', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000')

    Write-InstallStatus '本地配置：正在注册 Tavern 并检查兼容性…'
    if (Close-DesktopForFirstInstall) { $ReopenDesktop = $true }
    Invoke-InstallCommand 'profile.install' 'node' @((Join-Path $AppDir 'bin\dsh-tavern.mjs'), 'install', '--host', $InstallHost) -TimeoutMs 1200000
  }
  if ($InstallHost -eq 'desktop') {
    $Elapsed = (Get-Date) - $InstallStarted
    Write-Host ''
    Write-Host ('DSH Tavern 安装完成，用时 ' + [int][math]::Floor($Elapsed.TotalMinutes) + ' 分 ' + $Elapsed.Seconds + ' 秒。') -ForegroundColor Green
    Write-Host '酒馆装在独立的 tavern 配置里；原来的 desktop 配置已备份，可在设置 → Profile 切换中切回。'
    if (($FirstDesktopInstall -or $ReopenDesktop) -and -not @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -and $OfficialDesktopExecutable) {
      Write-Host '正在打开 DeepSeek Harness…'
      Start-Process -FilePath $OfficialDesktopExecutable
    } else { Write-Host '请重启官方 DeepSeek Harness 进入酒馆。' }
  }
  else {
    if ($env:DSH_TAVERN_DEFER_SERVICE_START -ne '1') {
      Invoke-InstallCommand 'service.start' 'node' @((Join-Path $AppDir 'bin\dsh-tavern.mjs'), 'start')
    }
    Write-Host 'DSH Tavern 安装完成。请使用上方完整访问地址，或运行 dsh-tavern open 打开网页。'
    Write-Host '以后可以使用：dsh-tavern start、open、stop、restart、status、update（新 PowerShell 生效）'
  }
  Write-UpdateLog 'installer.finished' 'bootstrap' '0'
  $InstallationCompleted = $true
}
catch {
  $InstallFailure = $_
  if ($StagedInstall) {
    try {
      if ($AppSwapped) {
        Write-Host '安装未完成，正在恢复原版本……'
        & node $Stager rollback --app $AppDir
        # UI updates restart the service from the updater after this job has ended.
        if ($LASTEXITCODE -eq 0 -and $PreviousApp -and $env:DSH_TAVERN_DEFER_SERVICE_START -ne '1') {
          & node (Join-Path $AppDir 'bin\dsh-tavern.mjs') start
          if ($LASTEXITCODE -ne 0) { Write-Warning '原版本已恢复，但服务启动失败，请运行 dsh-tavern start。' }
        }
      }
      else {
        # The running app was never touched; only drop the unused staging copy.
        & node $Stager discard --app $AppDir
      }
    } catch { Write-Warning ('恢复原版本失败：' + $_.Exception.Message) }
  }
  try {
    if (Test-Path $UpdateLogger) {
      $FailureFile = Join-Path $TempDir 'installer.error'
      [IO.File]::WriteAllText($FailureFile, $InstallFailure.Exception.ToString(), (New-Object Text.UTF8Encoding($false)))
      Write-UpdateLog 'installer.finished' 'bootstrap' '1' '' $FailureFile
    }
  } catch {}
  if ($UpdateLogRoot) { Write-Host "安装失败，请提供诊断日志：$UpdateLogRoot/update-diagnostics.jsonl" }
  throw ("安装失败：" + $InstallFailure.Exception.Message)
}
finally {
  if ($null -ne $InstallationOwner -and $InstallationOwner.created) {
    # A nested Profile retains this lock if descendant termination is uncertain.
    # Release verifies token, generation and the owning PowerShell PID.
    if (-not $InstallationCompleted -and ($null -eq $InstallFailure -or $InstallFailure.Exception -is [System.Management.Automation.PipelineStoppedException])) {
      & node $InstallationStateModule retain --home $DshRoot --attempt $InstallationOwner.attemptId --reason 'Bootstrap interrupted; descendant cleanup is unverified' --owner-done 1
    } else {
      & node $InstallationStateModule release --home $DshRoot --attempt $InstallationOwner.attemptId --generation $InstallationOwner.generation --pid $PID
    }
    if ($LASTEXITCODE -ne 0) { Write-Warning '安装任务尚未安全结束，已保留安装锁。' }
  }
  $env:DSH_TAVERN_INSTALL_ATTEMPT = $PreviousInstallationAttempt
  $env:DSH_TAVERN_INSTALL_LOCK = $PreviousInstallationLock
  [Console]::OutputEncoding = $PreviousConsoleOutputEncoding
  $OutputEncoding = $PreviousOutputEncoding
  $env:npm_config_registry = $PreviousNpmRegistry
  $env:pnpm_config_registry = $PreviousPnpmRegistry
  $env:pnpm_config_update_notifier = $PreviousPnpmUpdateNotifier
  $env:DSH_TAVERN_APP_DIR = $PreviousTavernAppDir
  $env:DSH_HOME = $PreviousDshHome
  $env:DSH_TAVERN_CLI_HOME = $PreviousCliHome
  $env:DSH_TAVERN_LEGACY_DSH_HOME = $PreviousLegacyHome
  $env:Path = $PreviousPath
  $env:DSH_TAVERN_UPDATE_ATTEMPT = $PreviousUpdateAttempt
  foreach ($ProxyName in $AddedProxyNames) { Remove-Item -Path "Env:$ProxyName" -ErrorAction SilentlyContinue }
  if (Test-Path $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
  }
}
