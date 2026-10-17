/**
 * dsh-tavern-ui-switch server side.
 *
 * Exposes three small endpoints on the DSH web server. The switch itself is a
 * bundle-list edit on the profile manifest; DSH reloads the profile when that
 * file changes, and the page then reloads itself.
 * No other plugin config is read or written, so Tavern and the original UI keep
 * behaving exactly as before.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyMode, hasTavern, log, readManifest, resolvePaths, status } from './profile.js'

export const name = 'dsh-tavern-ui-switch'

// The web server service may appear after this bundle is loaded, so wait for it
// instead of probing once. Without the service there is no button endpoint.
export const inject = ['webServer']

const ROUTE = '/api/dsh-tavern-ui-switch'
const VERSION = '0.1.0'

function json(res, code, value) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function loopbackOnly(req) {
  const address = req.socket?.remoteAddress || ''
  return address === '' || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** Whether the host can restart itself after a switch. */
function restartSupport() {
  // The desktop host is a child of the Electron shell; without that parent there
  // is nothing to relaunch, and killing the host would only strand the window.
  const parented = Number.isInteger(process.ppid) && process.ppid > 0 && process.ppid !== process.pid
  if (process.versions.electron && typeof process.send === 'function' && parented) {
    return { supported: true, host: 'desktop', hint: '切换后会自动重启 DeepSeek Harness。' }
  }
  if (process.versions.electron) {
    return { supported: false, host: 'electron-other', hint: '切换后请退出并重新打开 DeepSeek Harness。' }
  }
  return { supported: false, host: 'cli', hint: '切换后请重启 dsh web（Ctrl+C 后重新运行），或在酒馆命令行执行 dsh-tavern restart。' }
}

function spawnRelaunch(port) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const helper = path.join(here, '..', 'bin', 'relaunch.mjs')
  const args = [
    helper,
    '--host-pid', String(process.pid),
    '--gui-pid', String(process.ppid || 0),
    '--exe', process.execPath,
    '--port', String(port || 0),
    '--home', resolvePaths().home,
  ]
  const env = { ...process.env }
  let finalArgs = args
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
    finalArgs = ['--expose-internals', ...args]
  }
  log(`relaunch requested: hostPid=${process.pid} guiPid=${process.ppid} port=${port}`)
  const child = spawn(process.execPath, finalArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: path.dirname(here),
    env,
  })
  child.unref()
}

function statePayload(port, anchor) {
  const support = restartSupport()
  const installed = status()
  return {
    ok: true,
    version: VERSION,
    mode: installed.mode,
    tavernInstalled: installed.tavernInstalled,
    switchInstalled: installed.switchInstalled,
    profile: installed.profile,
    anchor,
    error: installed.error,
    restart: { supported: support.supported, host: support.host, hint: support.hint, port: port || 0 },
  }
}

export function apply(ctx, config = {}) {
  // Never let a switch failure break the host: a thrown apply can stop a profile from booting.
  try {
    start(ctx, config)
  } catch (error) {
    log(`plugin init failed: ${error && error.stack ? error.stack : String(error)}`)
  }
}

function start(ctx, config = {}) {
  // Where the floating button sits; the client reads it from /state.
  const anchor = typeof config.anchor === 'string' && config.anchor ? config.anchor : 'bottom-right'
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    log('web server unavailable, switch endpoints are disabled')
    return
  }

  const address = webServer.server?.address?.()
  const port = address && typeof address === 'object' ? address.port : 0

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const route = url.pathname.slice(ROUTE.length) || '/'

    if (!loopbackOnly(req)) return json(res, 403, { ok: false, error: '仅允许本机访问' })
    // Custom header makes cross-site writes impossible without a CORS preflight.
    if (req.method === 'POST' && req.headers['x-dsh-tavern-ui-switch'] !== '1') {
      return json(res, 403, { ok: false, error: '缺少请求标记' })
    }

    if (route === '/state' && (req.method === 'GET' || req.method === 'HEAD')) {
      return json(res, 200, statePayload(port, anchor))
    }

    if (route === '/switch' && req.method === 'POST') {
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message })
      }
      const mode = body?.mode
      if (mode !== 'official' && mode !== 'tavern') {
        return json(res, 400, { ok: false, error: 'mode 只能是 official 或 tavern' })
      }
      try {
        const manifest = readManifest(resolvePaths())
        if (mode === 'tavern' && !hasTavern(manifest)) {
          return json(res, 409, { ok: false, error: '当前 profile 没有安装酒馆，无法切换到酒馆界面' })
        }
        const result = applyMode(mode)
        log(`switched to ${mode} (changed=${result.changed})`)
        return json(res, 200, { ok: true, mode, changed: result.changed, restart: { ...restartSupport(), port } })
      } catch (error) {
        log(`switch failed: ${error.message}`)
        return json(res, 500, { ok: false, error: error.message })
      }
    }

    if (route === '/restart' && req.method === 'POST') {
      const support = restartSupport()
      if (!support.supported) return json(res, 409, { ok: false, error: support.hint, restart: support })
      try {
        spawnRelaunch(port)
        return json(res, 200, { ok: true })
      } catch (error) {
        log(`relaunch failed: ${error.message}`)
        return json(res, 500, { ok: false, error: error.message })
      }
    }

    if (route === '/client-ready' && req.method === 'POST') {
      // Diagnostics only: proves the in-page overlay actually mounted.
      log('client mounted')
      return json(res, 200, { ok: true })
    }

    return json(res, 404, { ok: false, error: 'not found' })
  }

  /** Unhandled rejections in an async request listener would take down the host. */
  async function handler(req, res) {
    try {
      await handle(req, res)
    } catch (error) {
      log(`request failed: ${error && error.stack ? error.stack : String(error)}`)
      try {
        if (!res.headersSent) json(res, 500, { ok: false, error: '切换服务内部错误' })
        else res.end()
      } catch {}
    }
  }

  // Register with the documented route API when present; otherwise fall back to
  // the raw http server so a DSH version that lacks `register` still gets a button.
  const registerRoutes = () => {
    if (typeof webServer.register === 'function') {
      return webServer.register({ kind: 'prefix', path: ROUTE, handler })
    }
    const server = webServer.server
    if (!server || typeof server.on !== 'function') return undefined
    const listener = (req, res) => {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname
      if (pathname === ROUTE || pathname.startsWith(`${ROUTE}/`)) handler(req, res)
    }
    server.on('request', listener)
    return () => server.off('request', listener)
  }

  ctx.effect(registerRoutes, 'dsh-tavern-ui-switch: routes')
  log(`plugin loaded (profile=${resolvePaths().profile}, port=${port})`)
}
