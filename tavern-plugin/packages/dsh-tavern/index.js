// Queue a directory switch for when Desktop exits, then ask it to quit and reopen it.
import { basename, join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { inspectInstallation, validateInstallationRequest } from './lib/installation.mjs'
import { captureOwnedProcesses } from './lib/processes.mjs'
import { requestDesktopQuit } from './lib/quit.mjs'
import { relaunchApp, scheduleSwitch } from './lib/helper.mjs'
import { createTavernShortcut } from './lib/shortcut.mjs'
import { canInstallTavern, detectAppExe, fail, isActiveTavern, isDesktopApp, isOfficialDesktopApp, isDesktopTavernWindow, readLinkTarget, resolvePaths, statusPayload, validateTarget } from './lib/state.mjs'
import { initializeDefaultProfile, setDefaultProfile, startupSwitchMode } from './lib/startup-profile.mjs'

/** Shared RPC channel owned by this plugin; the browser half calls it by name. */
const CHANNEL = '/profile-bridge'

/** Control requests are tiny; anything larger is refused instead of buffered. */
const BODY_LIMIT_BYTES = 64 * 1024

const updateActions = new Map([
  ['update-status', 'status'], ['check-update', 'check'],
  ['start-update', 'start'], ['cancel-update', 'cancel'],
])
let installedUpdater

async function runUpdate(method, paths) {
  const installation = inspectInstallation(paths)
  if (!(basename(paths.activeDir) === 'desktop' && isDesktopApp()) && !isDesktopTavernWindow(paths, installation)) {
    fail('not-desktop', '请在官方桌面或 DSH 酒馆独立窗口中管理更新。')
  }
  if (!installation.available) fail('update-unavailable', installation.reason)
  // The updater can refresh the inactive original profile while Tavern is running.
  // It cannot replace the original launcher's files while that profile is active.
  const canUpdate = isActiveTavern(paths, installation)
  if (['start', 'cancel'].includes(method) && !canUpdate) {
    fail('update-unavailable', '请先切换到 DSH 酒馆，再在启动器中更新。')
  }
  const sourceRoot = installation.appDir
  const dataRoot = join(installation.sharedHome, 'profile-data', 'tavern', 'data')
  const key = JSON.stringify([sourceRoot, dataRoot])
  if (installedUpdater?.key !== key) {
    // The launcher is distributed independently; use the updater in the verified
    // official Tavern installation rather than bundling a second installer.
    const runtime = join(sourceRoot, 'tavern-plugin', 'lib')
    const entry = pathToFileURL(join(runtime, 'application-updater.js'))
    const service = import(entry.href).then(({ createApplicationUpdater }) => createApplicationUpdater({
      dataRoot, sourceRoot, dshHome: installation.sharedHome, runtimeHost: 'desktop',
      hostDependencyAnchor: join(runtime, 'index.js'),
    }))
    installedUpdater = { key, service }
    service.catch(() => { if (installedUpdater?.service === service) installedUpdater = undefined })
  }
  const updater = await installedUpdater.service
  return { ...await updater[method](), canUpdate }
}

/** Host services this plugin needs. */
export const inject = ['connection', 'webServer']

/**
 * Prepare and launch one switch operation.
 * @param {'link' | 'unlink'} mode - operation to perform.
 * @param {ReturnType<typeof resolvePaths>} paths - resolved plugin paths.
 * @param {unknown} payload - browser request payload.
 * @returns {object} JSON-safe receipt for the UI.
 */
async function runSwitch(mode, paths, payload) {
  const request = typeof payload === 'object' && payload !== null ? payload : {}
  if (mode === 'install' && (request.confirmed !== true || !canInstallTavern(paths))) {
    fail('install-unavailable', '请在官方桌面的原版配置中确认首次安装。')
  }
  if (mode === 'link' && basename(paths.activeDir) !== 'desktop') {
    fail(
      'not-desktop',
      `This Harness is running profile "${paths.activeName}" (${paths.activeDir}), which you already chose by hand. `
      + 'The profile link exists only for the Desktop app, which hardcodes profiles/desktop; start the app, or run `dsh --profile <name>` instead.',
    )
  }
  const management = ['relocate', 'uninstall'].includes(mode)
    ? validateInstallationRequest(paths, mode, request) : undefined
  if (management && basename(paths.activeDir) !== 'desktop') fail('not-desktop', '请在官方桌面中管理安装。')
  const target = mode === 'link' ? validateTarget(paths, request.target) : undefined
  const relaunch = mode === 'install' ? process.execPath : detectAppExe()
  if (!process.versions.electron || !process.send || process.ppid <= 1) {
    fail('not-desktop', '请在官方桌面中执行切换')
  }
  // Snapshot before quitting: detached children lose a trustworthy parent once it exits.
  const ownership = await captureOwnedProcesses([process.pid, process.ppid])
  const result = scheduleSwitch({ ...management, mode, home: paths.home, profilesRoot: paths.profilesDir, liveDir: paths.activeDir,
    activeName: paths.activeName, targetDir: target?.dir, stateDir: paths.stateDir,
    stamp: new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid,
    pids: [process.pid, process.ppid], ownership, relaunch })
  if (mode === 'install') return { ...result, mode, warnings: [], reopensApp: true }
  const closesApp = await requestDesktopQuit({ pid: process.ppid, executable: relaunch }, {
    onError: error => {
      try { appendFileSync(result.logPath, new Date().toISOString() + ' 自动退出失败，可从托盘退出：' + error.message + '\n') } catch {}
    },
  })
  return { ...result, mode, target: target?.name, warnings: target?.warnings ?? [], closesApp, reopensApp: true }
}

/** From the standalone DSH 酒馆 window: bring up (or start) the Desktop app, which runs the original DSH. */
function openOriginal() {
  const exe = detectAppExe()
  if (!exe) fail('no-app', '找不到 DeepSeek Harness，请手动打开它。')
  relaunchApp(exe)
  return { opened: true }
}

/**
 * Route one decoded endpoint call.
 * @param {string} endpoint - endpoint name on this channel.
 * @param {unknown} payload - decoded request payload.
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, error: object }>} RPC result.
 */
async function handleCall(endpoint, payload) {
  try {
    if (endpoint === 'status') return { ok: true, value: statusPayload(resolvePaths()) }
    if (endpoint === 'set-default') {
      const paths = resolvePaths()
      if (!isOfficialDesktopApp() || basename(paths.activeDir) !== 'desktop') fail('not-desktop', '请在官方桌面中设置默认配置。')
      if (payload?.profile === 'tavern') validateTarget(paths, 'tavern')
      return { ok: true, value: setDefaultProfile(paths.home, payload?.profile) }
    }
    if (updateActions.has(endpoint)) return { ok: true, value: await runUpdate(updateActions.get(endpoint), resolvePaths()) }
    if (endpoint === 'link') return { ok: true, value: await runSwitch('link', resolvePaths(), payload) }
    if (endpoint === 'unlink') return { ok: true, value: await runSwitch('unlink', resolvePaths(), payload) }
    if (['install', 'relocate', 'uninstall'].includes(endpoint)) return { ok: true, value: await runSwitch(endpoint, resolvePaths(), payload) }
    if (endpoint === 'shortcut') return { ok: true, value: createTavernShortcut({ paths: resolvePaths() }) }
    if (endpoint === 'openOriginal') return { ok: true, value: openOriginal() }
    fail('not-found', `Unknown endpoint ${JSON.stringify(endpoint)}.`)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'bridge-error',
        message: error instanceof Error ? error.message : String(error),
        // The Connection client rejects a failure without a details record.
        details: {},
      },
    }
  }
}

/**
 * Decide whether one request may reach this channel.
 *
 * The Harness Connection service owns the browser-trust fence (loopback or a
 * configured trusted host, plus the signed session cookie). Where that service is
 * not reachable from this plugin's context, an equivalent loopback-only rule keeps
 * profile surgery a local operation.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {401 | 403 | undefined} rejection status, or undefined to proceed.
 */
function rejectRequest(ctx, req) {
  try {
    const rejection = ctx.connection?.requestRejection?.({ headers: req.headers })
    if (rejection !== undefined) return rejection
    if (typeof ctx.connection?.requestRejection === 'function') return undefined
  } catch {
    /* fall through to the local rule */
  }
  const host = String(req.headers.host ?? '').replace(/:\d+$/u, '').replace(/^\[|\]$/gu, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' ? undefined : 403
}

/**
 * Read a bounded JSON body.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<unknown>} parsed body.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT_BYTES) fail('payload-too-large', 'Request body is too large for this channel.')
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    fail('bad-request', 'Request body must be JSON.')
  }
}

/**
 * Answer one request with a `server-response` envelope.
 * @param {import('node:http').ServerResponse} res - response owner.
 * @param {number} status - HTTP status.
 * @param {object} body - envelope to send.
 */
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * Install the `/profile-bridge` channel for as long as this plugin is loaded.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context carrying `connection` and `webServer`.
 */
export function apply(ctx) {
  // The official GUI hardcodes profiles/desktop. On a fresh process launch the
  // Host applies the saved preference using the existing guarded transaction.
  // Explicit switches carry a process-only continuation marker, so they do not
  // immediately bounce back to the default. Never repeat this on plugin reload.
  const startupKey = Symbol.for('dsh-tavern.startup-profile')
  const paths = resolvePaths()
  if (isOfficialDesktopApp() && basename(paths.activeDir) === 'desktop' && !globalThis[startupKey]) {
    globalThis[startupKey] = true
    Promise.resolve().then(async () => {
      const link = readLinkTarget(paths.activeDir)
      const current = link ? basename(link) : 'desktop'
      const preferred = initializeDefaultProfile(paths.home, current)
      const mode = startupSwitchMode(current, preferred)
      if (mode) await runSwitch(mode, paths, { target: 'tavern' })
    }).catch(error => ctx.logger?.warn?.(`默认配置未能应用：${error.message}`))
  }
  // Preferred: the Connection service's own channel registry (it also applies the
  // browser-trust fence and session authentication).
  try {
    const disposer = ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => handleCall(endpoint, payload))
    ctx.effect(() => disposer, 'profile-bridge: shared rpc channel')
    return
  } catch (error) {
    ctx.logger?.debug?.(`profile-bridge: connection.rpc.handle unavailable (${String(error?.message ?? error)}); serving the channel directly`)
  }

  // Fallback: the same envelope on our own Web route, guarded by the same fence.
  const route = {
    kind: 'prefix',
    path: CHANNEL,
    handler: async (req, res) => {
      try {
        const rejection = rejectRequest(ctx, req)
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('method not allowed')
          return
        }
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        const endpoint = decodeURIComponent(pathname.slice(CHANNEL.length).replace(/^\/+/u, ''))
        const message = await readJsonBody(req)
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
        if (message?.type !== 'client-request' || typeof message.method !== 'string' || message.method !== endpoint) {
          sendJson(res, 400, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: 'the client-request envelope must name this endpoint' } },
          })
          return
        }
        sendJson(res, 200, { type: 'server-response', rpcId, result: await handleCall(endpoint, message.payload) })
      } catch (error) {
        ctx.logger?.warn?.(`profile-bridge: ${String(error?.message ?? error)}`)
        if (!res.headersSent) {
          sendJson(res, 500, {
            type: 'server-response',
            rpcId: 'invalid-request',
            result: { ok: false, error: { code: 'internal', message: String(error?.message ?? error) } },
          })
        } else {
          res.destroy()
        }
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'profile-bridge: rpc route')
}
