import { inspectRecordedProcess as inspectProcess, processStartToken } from './service-process-identity.mjs'
import { startupTimeoutMs, waitForServiceStartup, stopStartupChild } from './service-startup.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { resolveDesktopAsarCommand, resolveDshCliEntry } from './plugin-dependencies.mjs'
import path from 'node:path'
import { migrateSessionPrefixEvents } from './session-prefix-migration.mjs'
import { ensureSidebarDefaults } from './launcher-settings.mjs'
import { PROFILE_DIR, PID_FILE, PROFILE, SOURCE_ROOT, CLI_PORT, CLI_HOST, LOG_DIR, LOG_FILE, DSH_ROOT, FRONTEND_BOOTSTRAP_FILE, FRONTEND_BOOTSTRAP_VERSION, commandExists, runtimeEnvironment, RUNTIME_HOST, findDshCommand, resolveDshInvocation, sleep } from './launcher-environment.mjs'

// Own process identity, readiness, shutdown, and validated browser access.
export function webUrlFromLogChunk(source) {
  const matches = [...String(source || '').matchAll(/^dsh web: (https?:\/\/\S+)$/gm)]
  return matches.length > 0 ? matches[matches.length - 1][1] : ''
}

export async function resolveServiceWebUrl({ port, record = {}, log = Buffer.alloc(0), request = fetch }) {
  const origin = `http://127.0.0.1:${port}`
  const bytes = Buffer.isBuffer(log) ? log : Buffer.from(log)
  // New PID records delimit this process's output; old installations use the latest URL.
  const offset = Number.isSafeInteger(record.logOffset) && record.logOffset >= 0 ? record.logOffset : 0
  const candidate = webUrlFromLogChunk(bytes.subarray(offset).toString('utf8'))
  const candidates = []
  try {
    const url = new URL(candidate)
    if (url.origin === origin && !url.username && !url.password) candidates.push(url.href)
  } catch {}
  candidates.push(`${origin}/`)
  for (const url of new Set(candidates)) {
    try {
      const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) })
      await response.body?.cancel()
      if (response.status >= 200 && response.status < 400) return url
    } catch {}
  }
  return ''
}

export function restartBrowserTarget(port, runtimeGeneration, webUrl = `http://127.0.0.1:${port}/`) {
  const target = new URL(webUrl)
  target.searchParams.set('tavern-boot', String(runtimeGeneration))
  return target.toString()
}

export function browserOpenCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

async function openBrowserTarget(url) {
  const target = browserOpenCommand(url)
  await new Promise((resolve, reject) => {
    const child = spawn(target.command, target.args, { detached: true, stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => {
      child.unref()
      fail('等待系统响应超时，未能确认打开结果')
    }, 5000)
    const fail = detail => {
      clearTimeout(timer)
      reject(new Error(`无法自动打开浏览器（${detail}）。请复制上方完整地址，在浏览器中手动打开。`))
    }
    child.once('error', error => fail(error.code || '启动失败'))
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else fail(signal || `退出码 ${code}`)
    })
  })
}

export function needsFrontendBootstrap(record, requiredVersion = FRONTEND_BOOTSTRAP_VERSION) {
  return !record || Number(record.version) < requiredVersion
}

export async function bootstrapFrontendOnce(state) {
  if (!state?.webUrl) return false
  if (process.env.DSH_TAVERN_NO_OPEN === '1') return false
  let record = null
  try { record = JSON.parse(readFileSync(FRONTEND_BOOTSTRAP_FILE, 'utf8')) } catch {}
  if (!needsFrontendBootstrap(record)) return false
  const target = restartBrowserTarget(state.port, state.runtimeGeneration, state.webUrl)
  try {
    await openBrowserTarget(target)
  } catch (error) {
    console.warn(error.message)
    return false
  }
  mkdirSync(LOG_DIR, { recursive: true })
  writeFileSync(FRONTEND_BOOTSTRAP_FILE, `${JSON.stringify({ version: FRONTEND_BOOTSTRAP_VERSION, completedAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`已一次性打开新版前端：${target}`)
  return true
}

function verifyProfile() {
  if (!existsSync(path.join(PROFILE_DIR, 'package.json')) || !existsSync(path.join(PROFILE_DIR, 'cordis.patch.yml'))) {
    throw new Error(`DSH Tavern 尚未安装，请先在仓库目录运行：pnpm run install:tavern`)
  }
}

function readPidRecord() {
  if (!existsSync(PID_FILE)) return null
  try {
    const record = JSON.parse(readFileSync(PID_FILE, 'utf8'))
    return Number.isInteger(record.pid) && record.pid > 0 ? record : null
  } catch {
    return null
  }
}

function writePidRecord(pid, port, logOffset) {
  writeFileSync(PID_FILE, `${JSON.stringify({ pid, port, logOffset, profile: PROFILE, source: SOURCE_ROOT, ...(RUNTIME_HOST === 'android' && process.platform === 'linux' ? { startToken: processStartToken(pid) } : {}), startedAt: new Date().toISOString() }, null, 2)}\n`)
}

function removePidRecord() {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function isPortOpen(port, host = '127.0.0.1', timeout = 300) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host })
    const finish = (open) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function isServiceReady(port, request = fetch, host = process.env.DSH_TAVERN_RUNTIME_HOST || 'cli') {
  try {
    const response = await request(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
    return response.ok || response.status === 401 || (host === 'android' && response.status === 403)
  } catch {
    return false
  }
}

function inspectRecordedProcess(record) {
  return inspectProcess(record, { host: RUNTIME_HOST, home: DSH_ROOT })
}

async function serviceState() {
  const port = CLI_PORT
  const record = readPidRecord()
  const identity = record ? inspectRecordedProcess(record) : 'gone'
  const pidAlive = identity === 'owned'
  const portOpen = await isPortOpen(port)
  const ready = portOpen && await isServiceReady(port)
  if (record && !pidAlive && (identity !== 'unknown' || !portOpen)) {
    removePidRecord()
    console.log(`已清理陈旧或无法确认且端口未监听的服务记录：PID ${record.pid}`)
  }
  // Never adopt another Android process by port/profile alone.
  const legacyRecord = !pidAlive && portOpen && RUNTIME_HOST !== 'android' ? findLegacyService(port) : null
  return { port, record: pidAlive ? record : legacyRecord, portOpen, ready }
}

function findLegacyService(port) {
  if (process.platform === 'win32' || !commandExists('lsof')) return null
  const listeners = spawnSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' })
  if (listeners.status !== 0) return null
  const pids = listeners.stdout.split(/\s+/).map(Number).filter(Number.isInteger)
  for (const pid of pids) {
    const processInfo = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    if (processInfo.status === 0 && processInfo.stdout.includes(`dsh --profile ${PROFILE}`)) {
      return { pid, port, profile: PROFILE, source: SOURCE_ROOT, legacy: true }
    }
  }
  return null
}

export async function statusService() {
  verifyProfile()
  const state = await serviceState()
  if (state.record && state.ready) {
    console.log(`DSH Tavern 正在运行：PID ${state.record.pid}`)
    printServiceWebUrl(await currentServiceWebUrl(state))
    return
  }
  if (state.portOpen) {
    if (state.record) throw new Error(`DSH Tavern 进程存在，但 Web 页面尚未就绪：PID ${state.record.pid}。请稍后重试。`)
    throw new Error(`端口 ${state.port} 已被未识别的进程占用，DSH Tavern 不会操作该进程。`)
  }
  if (state.record) {
    console.log(`DSH Tavern 正在启动：PID ${state.record.pid}（端口 ${state.port} 尚未监听）。`)
    return
  }
  throw new Error(`DSH Tavern 未运行（端口 ${state.port}）。`)
}

async function currentServiceWebUrl(state) {
  let log = Buffer.alloc(0)
  try { log = readFileSync(LOG_FILE) } catch {}
  return resolveServiceWebUrl({ port: state.port, record: state.record || {}, log })
}

function printServiceWebUrl(url) {
  if (!url) {
    console.log('尚未取得有效的 Web 访问链接。请稍后运行 dsh-tavern status；仍无法获取时，请运行 dsh-tavern restart。')
    return
  }
  console.log(`打开网页（请复制完整地址）：${url}`)
  console.log('带 token 的地址包含访问凭证，请勿分享。关掉页面后可运行 dsh-tavern open 重新打开。')
}

export async function openService() {
  verifyProfile()
  const state = await serviceState()
  if (!state.record || !state.ready) throw new Error('DSH Tavern 尚未就绪，请先运行 dsh-tavern start。')
  const url = await currentServiceWebUrl(state)
  printServiceWebUrl(url)
  if (!url) { process.exitCode = 1; return }
  await openBrowserTarget(url)
}

export async function stopService() {
  verifyProfile()
  const state = await serviceState()
  if (!state.record) {
    if (state.portOpen) {
      throw new Error(`端口 ${state.port} 已被未识别的进程占用，拒绝停止。`)
    }
    console.log('DSH Tavern 已停止。')
    return
  }

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(state.record.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    if (result.status !== 0 && isProcessAlive(state.record.pid)) {
      throw new Error(`无法停止 DSH Tavern 进程：PID ${state.record.pid}。`)
    }
  } else {
    // Recheck immediately before signaling; the PID may have been reused.
    if (inspectRecordedProcess(state.record) === 'owned') {
      try {
        process.kill(state.record.pid, 'SIGTERM')
      } catch (error) {
        if (error?.code !== 'ESRCH') {
          if (error?.code !== 'EPERM' || RUNTIME_HOST !== 'android' || process.platform !== 'linux') throw error
          const identity = inspectRecordedProcess(state.record)
          if (identity === 'owned' || await isPortOpen(state.port)) {
            throw new Error(`无法停止 DSH Tavern：PID ${state.record.pid} 权限不足；请从 Android 宿主停止服务后重试。`)
          }
        }
      }
    }
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await isPortOpen(state.port)) && inspectRecordedProcess(state.record) !== 'owned') {
      removePidRecord()
      console.log('DSH Tavern 已停止。')
      return
    }
    await sleep(100)
  }
  throw new Error(`服务未能在 10 秒内停止；没有强制结束进程，请手动检查 PID ${state.record.pid}。`)
}

export async function startService() {
  verifyProfile()
  ensureSidebarDefaults()
  const timeoutMs = startupTimeoutMs(RUNTIME_HOST)
  const state = await serviceState()
  if (state.record && !state.ready) {
    console.log(`正在等待已有 DSH Tavern 进程就绪：PID ${state.record.pid}。`)
    // Join an existing start without taking ownership of its process or PID record.
    // Only the original starter may terminate it when startup fails.
    await waitForServiceStartup({
      timeoutMs,
      alive: () => inspectRecordedProcess(state.record) === 'owned',
      ready: async () => await isPortOpen(state.port) && await isServiceReady(state.port),
      stop: async () => {},
    })
    if (inspectRecordedProcess(state.record) !== 'owned') throw new Error('等待中的 DSH Tavern 进程已被替换，请重试。')
    state.ready = true
    state.portOpen = true
  }
  if (state.record && state.ready) {
    console.log(`DSH Tavern 已经在运行：PID ${state.record.pid}。`)
    const webUrl = await currentServiceWebUrl(state)
    printServiceWebUrl(webUrl)
    return { ...state, webUrl, runtimeGeneration: state.record.pid }
  }
  if (state.portOpen) {
    throw new Error(`端口 ${state.port} 已被其他进程占用，拒绝启动。`)
  }

  const prefixRepairs = await migrateSessionPrefixEvents({
    sessionsRoot: path.join(DSH_ROOT, 'profile-data', PROFILE, 'sessions'),
    backupRoot: path.join(DSH_ROOT, 'backups', 'tavern-stable-prefix-v1'),
  })
  if (prefixRepairs.length) console.log(`已兼容修复 ${prefixRepairs.length} 份旧会话的固定背景事件，原文件已备份。`)

  const runtimeHost = RUNTIME_HOST
  const dsh = findDshCommand(runtimeHost)
  const invocation = resolveDshInvocation(
    dsh,
    ['--profile', PROFILE, '--host', CLI_HOST, '--port', String(CLI_PORT), '--no-open'],
    runtimeHost,
  )
  if (process.platform === 'win32') {
    // 0.2.0-rc.2 适配：桌面 0.2.0 的 dsh 是「Electron 可执行文件 + app.asar 内 CLI」的 shim，
    // 纯 Node 既定位不到 @deepseek-ai/dsh npm 包（resolveDshCliEntry 会抛「无法定位当前 DSH CLI 包」），
    // 也读不了 asar 内文件；必须改用 Electron + ELECTRON_RUN_AS_NODE=1（即 shim 自身的形态）。
    // 非 asar 形态（0.1.5 桌面、真实 npm 包布局、host=cli）保持原有行为不变。
    const desktop = runtimeHost === 'desktop' ? resolveDesktopAsarCommand({ dsh }) : null
    if (desktop) {
      // resolveDshInvocation 已经为固定桌面入口补过 --expose-internals + bootstrap，别再补一次，
      // 否则 bin.js 会把多出来的 --expose-internals 当成参数，报 --profile <name> is required。
      const args = invocation.args[0] === '--expose-internals' ? invocation.args.slice(2) : invocation.args
      invocation.command = desktop.command
      invocation.args = ['--expose-internals', desktop.entry, ...args]
      invocation.env = { ...(invocation.env ?? {}), ...desktop.env }
    } else if (invocation.args[0] === '--expose-internals') {
      // 桌面 asar 入口（findDshCommand 已返回 bootstrap）时 resolveDshInvocation 补过入口，
      // 这里只换成当前 Electron 可执行文件，不要再补一遍 bin.js，否则参数错位。
      invocation.command = process.execPath
    } else {
      invocation.args = [resolveDshCliEntry({ dsh }), ...invocation.args]
      invocation.command = process.execPath
    }
  }
  mkdirSync(LOG_DIR, { recursive: true })
  const logOffset = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0
  const startupLog = (event, details = {}) => appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n')
  startupLog('service.starting', { node: process.version, executable: invocation.command, entry: invocation.args[0].startsWith('--') ? invocation.args[1] : invocation.args[0], cwd: SOURCE_ROOT, home: DSH_ROOT, port: state.port, timeoutMs })
  const logDescriptor = openSync(LOG_FILE, 'a')
  let child
  try {
    child = spawn(invocation.command, invocation.args, {
      cwd: SOURCE_ROOT,
      // Track the actual Node service, not a cmd shim that can exit separately.
      detached: true,
      env: { ...runtimeEnvironment({ installation: false }), ...(invocation.env ?? {}) },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', logDescriptor, logDescriptor],
    })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    startupLog('service.spawned', { pid: child.pid })
    child.once('exit', (code, signal) => {
      try { startupLog('service.exited', { pid: child.pid, code, signal }) } catch {}
    })
  } catch (error) {
    startupLog('service.spawn.failed', { code: error.code || null })
    throw error
  } finally {
    closeSync(logDescriptor)
  }
  child.unref()
  try { writePidRecord(child.pid, state.port, logOffset) }
  catch (error) { await stopStartupChild(child); throw error }

  let portOpen = false
  let serviceReady = false
  try {
    await waitForServiceStartup({
      timeoutMs,
      alive: () => isProcessAlive(child.pid),
      onSlow: () => console.log(`DSH Tavern 仍在初始化（首次启动较慢），最多等待 ${timeoutMs / 1000} 秒……`),
      ready: async () => {
        portOpen = await isPortOpen(state.port)
        serviceReady = portOpen && await isServiceReady(state.port)
        return serviceReady
      },
      stop: async () => {
        await stopStartupChild(child)
        if (readPidRecord()?.pid === child.pid) removePidRecord()
      }
    })
  } catch (error) {
    startupLog('service.start.failed', { pid: child.pid, portOpen, serviceReady, exitCode: child.exitCode, signal: child.signalCode })
    throw new Error(`${error.message}，日志：${LOG_FILE}`, { cause: error })
  }
  startupLog('service.ready', { pid: child.pid, port: state.port })
  let webUrl = ''
  for (let logAttempt = 0; logAttempt < 50 && webUrl === ''; logAttempt += 1) {
    const logChunk = readFileSync(LOG_FILE).subarray(logOffset).toString('utf8')
    webUrl = webUrlFromLogChunk(logChunk)
    if (webUrl === '') await sleep(100)
  }
  webUrl = await currentServiceWebUrl({ port: state.port, record: { logOffset } })
  console.log(`DSH Tavern 已启动：PID ${child.pid}`)
  printServiceWebUrl(webUrl)
  console.log(`日志：${LOG_FILE}`)
  return { port: state.port, runtimeGeneration: `${child.pid}-${Date.now()}`, webUrl }
}
