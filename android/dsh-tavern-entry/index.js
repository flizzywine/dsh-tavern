import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

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

async function ensureTavern(config) {
  try {
    if (await isPortOpen(config.port)) return
    const launcher = path.join(config.appDir, 'bin', 'dsh-tavern.mjs')
    if (!existsSync(launcher)) {
      console.error(`dsh-tavern-entry: 找不到启动器：${launcher}`)
      return
    }
    const child = spawn(process.execPath, [launcher, 'start'], {
      cwd: config.appDir,
      detached: true,
      env: {
        ...process.env,
        DSH_HOME: config.dshHome,
        DSH_TAVERN_PORT: String(config.port),
      },
      stdio: 'ignore',
    })
    child.once('error', (error) => {
      console.error('dsh-tavern-entry: 拉起 tavern 失败', error)
    })
    child.unref()
  } catch (error) {
    console.error('dsh-tavern-entry: 检查 tavern 失败', error)
  }
}

export function apply(ctx) {
  const config = resolveEntryConfig()
  const startup = setTimeout(() => void ensureTavern(config), START_DELAY_MS)
  const health = setInterval(() => void ensureTavern(config), HEALTH_INTERVAL_MS)
  if (typeof startup.unref === 'function') startup.unref()
  if (typeof health.unref === 'function') health.unref()
  ctx.effect(() => () => {
    clearTimeout(startup)
    clearInterval(health)
  }, 'dsh-tavern-entry: Android tavern watchdog')
}
