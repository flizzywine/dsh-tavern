// Based on 2NF/dsh-profile-bridge (MIT); Tavern compatibility fork.
// Queue a directory switch after the user exits Desktop normally.
import { basename } from 'node:path'
import { scheduleSwitch } from './lib/helper.mjs'
import { fail, resolvePaths, statusPayload, validateTarget } from './lib/state.mjs'

/** Shared RPC channel owned by this plugin; the browser half calls it by name. */
const CHANNEL = '/profile-bridge'

/** Control requests are tiny; anything larger is refused instead of buffered. */
const BODY_LIMIT_BYTES = 64 * 1024

/** Host services this plugin needs. */
export const inject = ['connection', 'webServer']

/**
 * Prepare and launch one switch operation.
 * @param {'link' | 'unlink'} mode - operation to perform.
 * @param {ReturnType<typeof resolvePaths>} paths - resolved plugin paths.
 * @param {unknown} payload - browser request payload.
 * @returns {object} JSON-safe receipt for the UI.
 */
function runSwitch(mode, paths, payload) {
  const request = typeof payload === 'object' && payload !== null ? payload : {}
  if (mode === 'link' && basename(paths.activeDir) !== 'desktop') {
    fail(
      'not-desktop',
      `This Harness is running profile "${paths.activeName}" (${paths.activeDir}), which you already chose by hand. `
      + 'The profile link exists only for the Desktop app, which hardcodes profiles/desktop; start the app, or run `dsh --profile <name>` instead.',
    )
  }
  const target = mode === 'link' ? validateTarget(paths, request.target) : undefined
  if (!process.versions.electron || !process.send || process.ppid <= 1) {
    fail('not-desktop', '请在官方桌面中执行切换')
  }
  const result = scheduleSwitch({ mode, profilesRoot: paths.profilesDir, liveDir: paths.activeDir,
    activeName: paths.activeName, targetDir: target?.dir, stateDir: paths.stateDir,
    stamp: new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid,
    pids: [process.pid, process.ppid] })
  return { ...result, mode, target: target?.name, warnings: target?.warnings ?? [], closesApp: false, reopensApp: false,
    outcome: '请在两分钟内正常退出官方桌面，等待切换完成后重新打开。' }
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
    if (endpoint === 'link') return { ok: true, value: runSwitch('link', resolvePaths(), payload) }
    if (endpoint === 'unlink') return { ok: true, value: runSwitch('unlink', resolvePaths(), payload) }
    fail('not-found', `Unknown endpoint ${JSON.stringify(endpoint)}.`)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'bridge-error',
        message: error instanceof Error ? error.message : String(error),
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
