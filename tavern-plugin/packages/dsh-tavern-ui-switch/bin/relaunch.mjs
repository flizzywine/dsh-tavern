#!/usr/bin/env node
/**
 * Detached relaunch helper.
 *
 * DSH exposes no restart API to plugins, and the desktop shell only reads the
 * profile at startup, so a switch needs one app restart. This helper runs as an
 * independent process: it waits for the HTTP response to flush, stops the old
 * app, then starts it again with the rewritten profile. If any step fails the
 * app is still startable by hand and no data is touched.
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) continue
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) continue
    result[name.slice(2)] = value
    index += 1
  }
  return result
}

const args = parseArgs(process.argv.slice(2))
const home = args.home || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
const logFile = path.join(home, 'logs', 'ui-switch.log')

function log(message) {
  try {
    mkdirSync(path.dirname(logFile), { recursive: true })
    appendFileSync(logFile, `[${new Date().toISOString()}] relaunch: ${message}\n`)
  } catch {}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function kill(pid, force) {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), ...(force ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true })
    } else {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
    }
  } catch {}
}

async function waitGone(pid, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await sleep(150)
  }
  return !alive(pid)
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (open) => {
      socket.destroy()
      resolve(open)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(600, () => done(false))
  })
}

async function waitPortClosed(port, timeout) {
  if (!Number.isInteger(port) || port <= 0) return true
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return true
    await sleep(250)
  }
  return !(await portOpen(port))
}

function launch(executable) {
  const env = { ...process.env }
  // This helper runs as Electron-in-Node-mode; the app itself must not inherit it.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  if (process.platform === 'darwin') {
    const marker = executable.indexOf('.app/Contents/MacOS/')
    if (marker >= 0) {
      const bundle = executable.slice(0, marker + 4)
      const child = spawn('open', [bundle], { detached: true, stdio: 'ignore', env })
      child.unref()
      return { command: 'open', args: [bundle] }
    }
  }
  const child = spawn(executable, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    cwd: path.dirname(executable),
    env,
  })
  child.unref()
  return { command: executable, args: [] }
}

async function main() {
  const hostPid = Number(args['host-pid'] || 0)
  const guiPid = Number(args['gui-pid'] || 0)
  const port = Number(args.port || 0)
  const executable = args.exe
  if (!executable) throw new Error('缺少 --exe')

  log(`start hostPid=${hostPid} guiPid=${guiPid} port=${port} exe=${executable}`)
  // Give the HTTP response time to reach the page before the shell starts closing.
  await sleep(1200)

  if (guiPid > 0 && guiPid !== hostPid) {
    log(`stopping desktop shell ${guiPid}`)
    kill(guiPid, false)
    if (!(await waitGone(guiPid, 5000))) {
      log(`shell ${guiPid} ignored the close request, forcing`)
      kill(guiPid, true)
      await waitGone(guiPid, 3000)
    }
  }

  if (alive(hostPid)) {
    log(`stopping host ${hostPid}`)
    kill(hostPid, true)
    await waitGone(hostPid, 5000)
  }

  // Best effort: the reported port is one of several the host may listen on, so a
  // slow release must not delay the relaunch for long.
  log(`port closed=${await waitPortClosed(port, 4000)}`)

  const launched = launch(executable)
  log(`launched ${launched.command} ${launched.args.join(' ')}`)
}

main().catch((error) => log(`failed: ${error && error.stack ? error.stack : String(error)}`))
