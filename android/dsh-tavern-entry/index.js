import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { createApplicationUpdater } from '../../tavern-plugin/lib/application-updater.js'

const DEFAULT_TAVERN_PORT = 3088
const START_DELAY_MS = 4000
const HEALTH_INTERVAL_MS = 60000

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function resolveEntryConfig(env = process.env, home = os.homedir()) {
  const dshHome = env.DSH_HOME || path.join(home, '.dsh')
  const requestedPort = env.DSH_TAVERN_ANDROID_PORT || DEFAULT_TAVERN_PORT
  const port = Number(requestedPort)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DSH_TAVERN_ANDROID_PORT 必须是有效端口，当前值：${requestedPort}`)
  }

  let appDir = env.DSH_TAVERN_ANDROID_APP_DIR || ''
  if (appDir === '') {
    const manifest = path.join(dshHome, 'profiles', 'tavern', 'package.json')
    try {
      const profile = record(JSON.parse(readFileSync(manifest, 'utf8')))
      appDir = String(record(profile.dshTavern).source || '')
    } catch {
      // Fresh DSHA installs use the conventional apps directory below.
    }
  }
  if (appDir === '') appDir = path.join(dshHome, 'apps', 'dsh-tavern')
  return { dshHome, appDir: path.resolve(appDir), port }
}

function isPortOpen(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const done = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

export function createEntryManager(options = {}) {
  const config = resolveEntryConfig(options.env || process.env, options.home || os.homedir())
  const launcher = path.join(config.appDir, 'bin', 'dsh-tavern.mjs')
  const portProbe = options.portProbe || isPortOpen
  const spawnProcess = options.spawnProcess || spawn
  const updater = createApplicationUpdater({
    dataRoot: path.join(config.dshHome, 'profile-data', 'tavern', 'data'),
    sourceRoot: config.appDir,
    dshHome: config.dshHome,
    execPath: options.execPath || process.execPath,
    runtimeHost: 'android',
    spawnProcess,
    now: options.now,
  })

  async function status() {
    return {
      installed: existsSync(launcher),
      online: await portProbe(config.port),
      update: await updater.status(),
    }
  }

  async function ensureStarted() {
    if (await portProbe(config.port)) return true
    if (!existsSync(launcher)) return false
    const child = spawnProcess(process.execPath, [launcher, 'start'], {
      cwd: config.appDir,
      detached: true,
      env: {
        ...process.env,
        DSH_HOME: config.dshHome,
        DSH_TAVERN_PORT: String(config.port),
        DSH_TAVERN_RUNTIME_HOST: 'android',
      },
      stdio: 'ignore',
    })
    child.once('error', (error) => console.error('dsh-tavern-entry: 拉起 tavern 失败', error))
    child.unref()
    return true
  }

  async function update() {
    if (!existsSync(launcher)) throw new Error('尚未安装 DSH Tavern，请先运行安卓一键安装')
    const update = await updater.start()
    return { installed: true, online: await portProbe(config.port), update }
  }

  return Object.freeze({ ensureStarted, status, update })
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function apply(ctx) {
  const manager = createEntryManager()
  function ensureStarted() {
    void manager.ensureStarted().catch((error) => console.error('dsh-tavern-entry: 检查 tavern 失败', error))
  }
  const startup = setTimeout(ensureStarted, START_DELAY_MS)
  const health = setInterval(ensureStarted, HEALTH_INTERVAL_MS)
  if (typeof startup.unref === 'function') startup.unref()
  if (typeof health.unref === 'function') health.unref()
  ctx.effect(() => () => {
    clearTimeout(startup)
    clearInterval(health)
  }, 'dsh-tavern-entry: Android tavern watchdog')

  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/dsh-tavern-android',
      handler: async (req, res) => {
        const origin = req.headers.origin
        if (typeof origin === 'string' && origin !== '' && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
          sendJson(res, 403, { error: 'forbidden' })
          return
        }
        try {
          const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)
          if (req.method === 'GET' && pathname === '/api/dsh-tavern-android/status') {
            sendJson(res, 200, await manager.status())
            return
          }
          if (req.method === 'POST' && pathname === '/api/dsh-tavern-android/update') {
            sendJson(res, 202, await manager.update())
            return
          }
          sendJson(res, 404, { error: 'not found' })
        } catch (error) {
          sendJson(res, 500, { error: String(error && error.message || error) })
        }
      },
    }), 'dsh-tavern-entry: Android tavern management')
  }
}
