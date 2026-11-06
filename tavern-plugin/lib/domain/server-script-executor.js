// EXPERIMENT: host side of the headless card-script executor (server-script-worker.js).
// Each game gets at most one disposable child process. The child may only reach
// the Tavern routes a script page needs; everything else is refused here.
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const worker = fileURLToPath(new URL('./server-script-worker.js', import.meta.url))

// What an open play page uses to run card scripts. Card code inside the
// sandbox can reach this channel, so nothing beyond it is exposed.
const ALLOWED_METHODS = new Set([
  'getSession', 'hydrateTavernHelperMessages', 'getTavernHelperContext',
  'claimTavernScriptWork', 'startTavernScriptWork', 'getTavernScriptWorkState', 'heartbeatTavernScriptRuntime',
  'completeTavernHelperEvent', 'releaseTavernHelperRuntime',
  'updateTavernHelperPrompts', 'updateTavernHelperVariables', 'updateTavernHelperMessages', 'createTavernHelperMessages',
  'getTavernHelperWorldbook', 'replaceTavernHelperWorldbook', 'patchTavernHelperWorldbook', 'loadTavernWorldInfo',
  'generateTavernHelper', 'generateTavernHelperRaw', 'stopTavernHelperGeneration', 'stopAllTavernHelperGeneration',
  'recordMvuRuntimeDiagnostic', 'recordTavernCompatibilityCalls', 'saveTavernExtensionSettings', 'saveTavernWorldInfo', 'saveTavernChatData',
  'getFullPromptTemplateState', 'releaseFullTemplateRuntime', 'heartbeatFullTemplateRuntime', 'claimFullTemplateWork', 'completeFullTemplateWork'
])
const ALLOWED_GET = /^\/api\/dsh-tavern\/(?:vendor\/|client-assets\/|remote-assets\/|static-assets|helper-history|session-resource|plugin-assets\/)/

// Like a page, only the game being played runs: a runtime lives while a page
// shows its game in the foreground or a settlement waits for it, and stops
// shortly after both end. Switching back starts it again.
export function createServerScriptExecutor({ handle, subscribeSignals, busy = () => false, lingerMs = 30 * 1000, maxSessions = 4, logger = console, now = Date.now }) {
  const records = new Map(), retryAfter = new Map()
  let failures = 0, disabled = false
  function failed(id) {
    retryAfter.set(id, now() + 5 * 60 * 1000)
    if (++failures >= 3 && !disabled) {
      disabled = true
      logger.warn('dsh-tavern: 服务端卡脚本运行时多次失败，本次运行改由页面执行卡脚本')
    }
  }
  function stop(sessionId) {
    const record = records.get(sessionId)
    if (!record) return
    records.delete(sessionId)
    record.stopSignals()
    record.child.kill('SIGKILL')
    logger.log('dsh-tavern: 服务端卡脚本运行时已停止', sessionId)
  }
  let reaping = false
  const reaper = setInterval(async () => {
    if (reaping) return
    reaping = true
    try {
      for (const record of [...records.values()]) {
        if (now() - record.demandedAt <= lingerMs) continue
        if (await Promise.resolve(busy(record.sessionId)).catch(() => true)) continue
        if (records.get(record.sessionId) === record && now() - record.demandedAt > lingerMs) stop(record.sessionId)
      }
    } finally { reaping = false }
  }, Math.max(1000, Math.floor(lingerMs / 3)))
  reaper.unref?.()
  async function answer(record, message) {
    const reply = data => { if (record.child.connected) record.child.send({ type: 'fetch-result', id: message.id, ...data }, () => {}) }
    try {
      const path = String(message.path || '')
      const pathname = new URL(path, 'http://x').pathname
      // SillyTavern feature probe served outside /api/dsh-tavern.
      if (pathname === '/version') { reply({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ pkgVersion: '1.12.14' })).toString('base64') }); return }
      const method = pathname.slice('/api/dsh-tavern/'.length)
      if (message.method === 'POST' ? !ALLOWED_METHODS.has(method) : !(message.method === 'GET' && ALLOWED_GET.test(pathname))) {
        logger.warn('dsh-tavern: 服务端卡脚本运行时请求被拒绝', message.method, pathname)
        reply({ status: 403, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ ok: false, error: 'server script runtime may not call ' + pathname })).toString('base64') })
        return
      }
      // The session is pinned: a card cannot address another game through this channel.
      let body = message.body
      if (message.method === 'POST') {
        const payload = body ? JSON.parse(body) : {}
        payload.sessionId = record.sessionId
        body = JSON.stringify(payload)
      }
      const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
      Object.assign(req, { url: path, method: message.method, headers: { host: 'tavern.invalid', 'content-type': 'application/json' } })
      const chunks = []
      let status = 200, headers = {}
      await new Promise((resolve, reject) => {
        const res = {
          headersSent: false,
          writeHead(code, values) { status = code; Object.assign(headers, values || {}); this.headersSent = true; return this },
          setHeader(name, value) { headers[name] = value },
          getHeader(name) { return headers[name] },
          write(chunk) { chunks.push(Buffer.from(chunk)); return true },
          end(chunk) { if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk)); resolve() },
          on() { return this }, once() { return this }
        }
        Promise.resolve(handle(req, res)).catch(reject)
      })
      const plain = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]))
      reply({ status, headers: plain, body: Buffer.concat(chunks).toString('base64') })
    } catch (error) {
      reply({ error: String(error?.message || error) })
    }
  }
  function demand(sessionId) {
    const id = String(sessionId || '')
    if (!id) return
    const existing = records.get(id)
    if (existing) { existing.demandedAt = now(); return }
    // A host that cannot run the headless runtime keeps the page path: after
    // repeated failures stop trying instead of respawning on every claim.
    if (disabled || now() < (retryAfter.get(id) || 0)) return
    // At capacity, leave this game to its page (or let it wait for a slot):
    // evicting would let retained pages of other games restart theirs in a loop.
    if (records.size >= maxSessions) return
    const modules = dirname(dirname(require.resolve('jsdom/package.json')))
    const plugin = fileURLToPath(new URL('../../', import.meta.url))
    const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission'
    const child = fork(worker, [], {
      env: { NODE_ENV: 'production', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      execArgv: ['--experimental-vm-modules', '--no-warnings', permissionFlag, '--allow-fs-read=' + plugin, '--allow-fs-read=' + modules, '--max-old-space-size=1024'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced', windowsHide: true
    })
    const record = { sessionId: id, child, demandedAt: now(), stderr: '', stopSignals: () => {} }
    records.set(id, record)
    record.stopSignals = subscribeSignals(id, signal => { if (child.connected) child.send({ type: 'signal', signal: { ...signal, snapshot: undefined } }, () => {}) })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { record.stderr = (record.stderr + chunk).slice(-8192) })
    child.on('message', message => {
      if (message.type === 'fetch') void answer(record, message)
      else if (message.type === 'log') logger[message.level === 'error' ? 'error' : message.level === 'warn' ? 'warn' : 'log']('dsh-tavern[server-scripts ' + id.slice(0, 8) + ']', message.message)
      else if (message.type === 'started') { failures = 0; logger.log('dsh-tavern: 服务端卡脚本运行时已启动', id) }
      else if (message.type === 'failed') { logger.error('dsh-tavern: 服务端卡脚本运行时启动失败', message.error); stop(id); failed(id) }
    })
    // A killed or crashed child must never take the Tavern service down with it.
    child.on('error', error => logger.warn('dsh-tavern: 服务端卡脚本运行时进程错误', id, String(error?.message || error)))
    child.on('exit', (code, signal) => {
      if (records.get(id) === record) {
        records.delete(id)
        record.stopSignals()
        logger.warn('dsh-tavern: 服务端卡脚本运行时退出', id, code, signal, record.stderr.slice(-2000))
        failed(id)
      }
    })
    child.send({ type: 'start', sessionId: id }, () => {})
  }
  return Object.freeze({
    demand, stop,
    has: sessionId => records.has(String(sessionId || '')),
    dispose() { clearInterval(reaper); for (const id of [...records.keys()]) stop(id) }
  })
}
