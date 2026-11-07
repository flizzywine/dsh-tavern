// Tavern compatibility fork of 2NF/dsh-profile-bridge (MIT).
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, lstatSync, renameSync, symlinkSync, unlinkSync, readFileSync, readdirSync, realpathSync, statSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trustedHome, withinPath } from './trusted-home.mjs'
import { relaunchEnvironment } from './startup-profile.mjs'

/** A lock older than this without a live helper is safe to reclaim. */
const PENDING_STALE_MS = 3 * 60 * 1000
/** How many reclaimed lock directories to keep for diagnosis. */
const STALE_LIMIT = 5

function manifest(dir) {
  const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (!Array.isArray(doc?.dsh?.profile?.bundles)) throw new Error('目标 profile 缺少有效的 bundle 列表')
}
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
const present = path => { try { lstatSync(path); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }

// Only an explicitly registered Tavern profile may leave the profiles tree.
// Never generalize this exception to arbitrary external profiles or links.
export function registeredTavernTarget(profilesRoot, targetDir) {
  try {
    const trust = trustedHome(dirname(resolve(profilesRoot))), home = trust.home
    const recordFile = join(home, 'profile-bridge', 'installation.json')
    trust.ordinary(recordFile)
    const record = JSON.parse(readFileSync(recordFile, 'utf8'))
    const canonical = value => typeof value === 'string' && isAbsolute(value) && samePath(resolve(value), value) && !/[\0\r\n]/u.test(value)
    if (!canonical(record.appDir) || !canonical(record.destination)) return undefined
    record.appDir = trust.map(record.appDir); record.destination = trust.map(record.destination)
    if (Array.isArray(record.entries)) {
      if (record.entries.some(entry => !canonical(entry?.from) || !canonical(entry?.to))) return undefined
      record.entries = record.entries.map(entry => ({ ...entry, from: trust.map(entry.from), to: trust.map(entry.to) }))
    }
    if (record.schemaVersion !== 1 || record.phase !== 'completed' || !Array.isArray(record.entries) || record.entries.length !== 3) return undefined
    if (!samePath(trust.map(targetDir), join(home, 'profiles', 'tavern'))) return undefined
    if (typeof record.destination !== 'string' || resolve(record.destination) !== record.destination || !samePath(realpathSync(record.destination), record.destination)) return undefined
    if (lstatSync(recordFile).isSymbolicLink() || !samePath(realpathSync(dirname(recordFile)), dirname(recordFile))) return undefined
    const overlaps = (a, b) => withinPath(b, a)
    if (overlaps(home, record.destination) || overlaps(record.destination, home)) return undefined
    const expected = { app: record.appDir, profile: join(home, 'profiles', 'tavern'), data: join(home, 'profile-data', 'tavern') }
    for (const kind of ['app', 'profile', 'data']) {
      const entries = record.entries.filter(entry => entry.kind === kind)
      if (entries.length !== 1) return undefined
      const entry = entries[0]
      if (typeof entry.from !== 'string' || !isAbsolute(entry.from) || resolve(entry.from) !== entry.from || !samePath(entry.from, expected[kind]) || entry.to !== join(record.destination, kind)) return undefined
      if (overlaps(entry.from, record.destination) || overlaps(record.destination, entry.from)) return undefined
      if (!lstatSync(entry.from).isSymbolicLink() || !lstatSync(entry.to).isDirectory() || lstatSync(entry.to).isSymbolicLink()) return undefined
      if (!samePath(realpathSync(entry.to), entry.to) || !samePath(realpathSync(dirname(entry.from)), dirname(entry.from)) || !samePath(realpathSync(entry.from), realpathSync(entry.to))) return undefined
    }
    return realpathSync(join(record.destination, 'profile'))
  } catch { return undefined }
}

// The caller must own the operation lock and have waited for Desktop and its Host to exit.
export async function switchProfile({ mode, profilesRoot, liveDir, targetDir, stamp }, { rename = renameSync, link = symlinkSync, removeLink = unlinkSync, retry = {} } = {}) {
  const move = (from, to) => renameWithRetry(from, to, { rename, ...retry })
  const root = realpathSync(profilesRoot)
  if (resolve(liveDir) !== join(resolve(profilesRoot), 'desktop')) throw new Error('只允许切换 desktop 入口')
  const linked = present(liveDir) && lstatSync(liveDir).isSymbolicLink()
  let destination
  if (mode === 'link') {
    destination = realpathSync(targetDir)
    if ((dirname(destination) !== root && registeredTavernTarget(profilesRoot, targetDir) !== destination) || destination === join(root, 'desktop') || /\.fresh-|\.switch-/.test(destination.slice(root.length))) throw new Error('目标必须是 profiles 下的独立 profile')
    manifest(destination)
    if (present(liveDir) && realpathSync(liveDir) === destination) return { changed: false }
  } else if (mode === 'unlink') {
    if (!linked) throw new Error('desktop 不是链接，无需还原')
    destination = readdirSync(profilesRoot).filter(name => name.startsWith('desktop.fresh-')).sort().reverse()
      .map(name => join(profilesRoot, name)).find(dir => { try { return lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink() && (manifest(dir), true) } catch { return false } })
    if (!destination) throw new Error('找不到可用的原版 desktop 备份，未修改目录')
  } else throw new Error('未知切换操作')
  if (!present(liveDir)) throw new Error('desktop 入口不存在，未执行切换')
  const previous = join(profilesRoot, linked ? `desktop.switch-${stamp}` : `desktop.fresh-${stamp}`)
  const staged = join(profilesRoot, `desktop.switch-stage-${stamp}`)
  if (present(previous) || present(staged)) throw new Error('备份路径已存在')
  if (mode === 'link') link(registeredTavernTarget(profilesRoot, targetDir) === destination ? resolve(targetDir) : destination, staged, process.platform === 'win32' ? 'junction' : 'dir')
  let moved = false
  let failure
  try {
    await move(liveDir, previous)
    moved = true
    await move(mode === 'link' ? staged : destination, liveDir)
  } catch (error) {
    failure = error
    if (moved) {
      try { await move(previous, liveDir) } catch (rollback) {
        failure = Object.assign(new Error(`切换失败且自动恢复失败；请勿启动桌面或重新切换。原入口保存在 ${previous}，目标为 ${destination}：${rollback.message}`, { cause: error }), { code: 'recovery-required', recoveryRequired: true, previous, destination })
        throw failure
      }
    }
    throw error
  } finally {
    try {
      if (present(staged) && lstatSync(staged).isSymbolicLink()) removeLink(staged)
    } catch (cleanupError) {
      // Never mask recoveryRequired: restarting with a missing desktop can create
      // a new profile over the transaction we need to recover.
      if (failure) failure.message += `；临时链接未能清理 ${staged}：${cleanupError.message}`
      else throw cleanupError
    }
  }
  if (linked) unlinkSync(previous) // remove only the saved link, never its target
  return { changed: true, target: realpathSync(liveDir), backup: linked ? undefined : previous }
}

/** Retry only Windows sharing/access errors, for a bounded period per move.
 * Rollback gets its own budget: a busy publish must not consume recovery time.
 */
export async function renameWithRetry(from, to, {
  rename = renameSync, platform = process.platform, timeout = 10000,
  interval = 250, now = Date.now, delay = ms => new Promise(r => setTimeout(r, ms)),
  onRetry = () => {},
} = {}) {
  const deadline = now() + timeout
  let attempt = 0
  for (;;) {
    try { return await rename(from, to) } catch (error) {
      if (platform !== 'win32' || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error
      if (now() >= deadline) {
        error.message = `目录仍被占用，未能移动 ${from} → ${to}（${error.code}）；请关闭使用该目录的终端/程序后重试。${error.message}`
        throw error
      }
      await onRetry({ from, to, code: error.code, attempt: ++attempt })
      await delay(Math.min(interval, Math.max(0, deadline - now())))
    }
  }
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' }
}
export async function waitForExit(pids, { timeout = 120000, alive = processAlive, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeout
  while (pids.some(alive)) {
    if (Date.now() >= deadline) throw new Error('等待桌面退出超时，未修改 profile；请正常退出后重试')
    await delay(250)
  }
}

/**
 * Command that reopens Desktop once it has exited.
 * @param {string} exe - the running application binary.
 * @param {string} platform - process.platform.
 * @returns {[string, string[]]} command and arguments.
 */
export function relaunchCommand(exe, platform = process.platform) {
  // On macOS the binary sits inside the .app bundle; open the bundle so Launch Services owns it.
  const bundle = platform === 'darwin' ? /^(.*?\.app)(?:\/|$)/u.exec(exe)?.[1] : undefined
  return bundle === undefined ? [exe, []] : ['open', [bundle]]
}

/**
 * Reopen Desktop detached from the helper.
 * @param {string} exe - the running application binary.
 */
export function relaunchApp(exe, { continueProfile = false } = {}) {
  // Explicit restarts need to pass the session environment to the app itself,
  // rather than handing the launch to macOS Launch Services.
  const [command, args] = continueProfile && process.platform === 'darwin' && !exe.endsWith('.app')
    ? [exe, []] : relaunchCommand(exe)
  // The helper itself runs the app binary as node; the reopened app must not.
  const env = relaunchEnvironment(process.env, continueProfile)
  spawn(command, args, { detached: true, stdio: 'ignore', env }).unref()
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined }
}

/** Read the durable outcome, not log text (which may contain earlier failures). */
export function readLastResult(stateDir, { alive = processAlive, now = Date.now } = {}) {
  try {
    const result = JSON.parse(readFileSync(join(stateDir, 'last-result.json'), 'utf8'))
    if (!result || !['pending', 'succeeded', 'failed'].includes(result.status)) return undefined
    if (result.status === 'pending') {
      let worker
      try { worker = JSON.parse(readFileSync(join(stateDir, result.mode === 'install' ? 'install-pending' : 'pending', 'worker.json'), 'utf8')) } catch {}
      const hasWorker = Number.isInteger(worker?.pid) && worker.pid > 1
      const abandoned = hasWorker ? !alive(worker.pid)
        : now() - statSync(join(stateDir, 'last-result.json')).mtimeMs > 3 * 60 * 1000
      if (abandoned) {
        // A helper may have died between moves: never claim the old entry is
        // intact or silently offer another transaction before manual inspection.
        result.status = 'failed'
        result.code = 'helper-exited'
        result.message = '切换助手已退出或未能启动，结果不确定；请检查日志、当前入口和备份目录。'
        result.recoveryRequired = true
      }
    }
    return {
      status: result.status,
      mode: result.mode,
      stamp: result.stamp,
      finishedAt: result.finishedAt,
      message: typeof result.message === 'string' ? result.message : '',
      code: typeof result.code === 'string' ? result.code : undefined,
      recoveryRequired: result.recoveryRequired === true,
      logPath: join(stateDir, 'last-run.log'),
    }
  } catch {
    return undefined
  }
}

function pendingIsStale(lock, alive, now) {
  const worker = readJson(join(lock, 'worker.json'))
  const pid = worker?.pid
  if (Number.isInteger(pid) && pid > 1) return !alive(pid)
  // Locks written by older versions carry no worker pid. Keep them while the
  // app they were waiting for is still running; otherwise only age can tell.
  const request = readJson(join(lock, 'request.json'))
  if (Array.isArray(request?.pids) && request.pids.some(candidate => alive(candidate))) return false
  const startedAt = Number.isFinite(worker?.startedAt) ? worker.startedAt : (() => {
    try { return statSync(lock).mtimeMs } catch { return 0 }
  })()
  return now() - startedAt > PENDING_STALE_MS
}

function pruneStale(staleRoot, keep) {
  try {
    const entries = readdirSync(staleRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('pending-'))
      .map(entry => {
        try { return { name: entry.name, at: statSync(join(staleRoot, entry.name)).mtimeMs } } catch { return undefined }
      })
      .filter(Boolean)
      .sort((left, right) => right.at - left.at)
    for (const entry of entries.slice(keep)) {
      try { rmSync(join(staleRoot, entry.name), { recursive: true, force: true }) } catch {}
    }
  } catch {}
}

function archiveStale(lock, stateDir, now, keep) {
  const staleRoot = join(stateDir, 'stale')
  mkdirSync(staleRoot, { recursive: true })
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
  const target = join(staleRoot, `pending-${stamp}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
  renameSync(lock, target)
  pruneStale(staleRoot, keep)
  return target
}

function busyError(lock, detail = '') {
  const suffix = detail === '' ? '' : `；${detail}`
  return Object.assign(new Error(`已有一个切换在等待桌面退出（最长两分钟），请稍后再试${suffix}；若桌面已退出且超过三分钟，重试时系统会自动清理陈旧记录（${lock}）。`), { code: 'busy' })
}

/**
 * Claim the single pending slot, archiving a lock whose helper is gone.
 * @param {string} stateDir - profile-bridge state directory.
 * @param {{ alive?: Function, now?: Function, keep?: number }} [options] - test seams.
 * @returns {{ lock: string, reclaimed: boolean }} claimed lock and whether an old one was archived.
 */
export function acquirePendingLock(stateDir, { alive = processAlive, now = Date.now, keep = STALE_LIMIT, installing = false } = {}) {
  trustedHome(dirname(resolve(stateDir))).ordinary(stateDir)
  assertBridgeUpdateComplete(stateDir)
  mkdirSync(stateDir, { recursive: true })
  // The standalone installer rejects pending profile switches. Its own
  // installation lease still protects the files while the launcher waits.
  const lock = join(stateDir, installing ? 'install-pending' : 'pending')
  const other = join(stateDir, installing ? 'pending' : 'install-pending')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (present(other)) throw busyError(other)
      mkdirSync(lock)
      if (present(other)) {
        rmSync(lock, { recursive: true })
        throw busyError(other)
      }
      return { lock, reclaimed: attempt > 0 }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (attempt === 0 && pendingIsStale(lock, alive, now)) {
        try {
          archiveStale(lock, stateDir, now, keep)
        } catch (archiveError) {
          if (archiveError.code === 'ENOENT') continue
          throw busyError(lock, `陈旧记录无法自动归档：${archiveError.message}`)
        }
        continue
      }
      throw busyError(lock)
    }
  }
  throw busyError(lock)
}

function assertBridgeUpdateComplete(stateDir) {
  const file = join(stateDir, 'bridge-update.json')
  if (!present(file)) return
  try {
    trustedHome(dirname(resolve(stateDir))).ordinary(file)
    const record = JSON.parse(readFileSync(file, 'utf8'))
    if (record.schemaVersion === 1 && ['completed', 'rolled-back'].includes(record.phase)) return
  } catch {}
  throw Object.assign(new Error(`原版切换组件更新尚未安全结束；请先检查备份与 ${file}，未安排切换。`), { code: 'recovery-required', recoveryRequired: true })
}

function assertManagementJournalComplete(stateDir) {
  const file = join(stateDir, 'installation-operation.json')
  if (!present(file)) return
  try {
    trustedHome(dirname(resolve(stateDir))).ordinary(file)
    const record = JSON.parse(readFileSync(file, 'utf8'))
    if (record.schemaVersion === 1 && ['completed', 'rolled-back'].includes(record.phase)) return
  } catch {}
  throw Object.assign(new Error(`安装管理记录尚未安全结束；请先检查备份与 ${file}，未安排切换。`), { code: 'recovery-required', recoveryRequired: true })
}

// Lock is acquired before responding, so repeated clicks cannot schedule competing switches.
export function scheduleSwitch(request, options = {}) {
  assertManagementJournalComplete(request.stateDir)
  const last = readLastResult(request.stateDir, options)
  if (last?.recoveryRequired) {
    throw Object.assign(new Error(`上次切换需要检查入口与备份，未安排新切换：${last.message} 日志：${last.logPath}`), { code: 'recovery-required' })
  }
  const { lock, reclaimed } = acquirePendingLock(request.stateDir, { ...options, installing: request.mode === 'install' })
  const job = join(lock, 'request.json')
  let worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
  try {
    if (['install', 'relocate', 'uninstall'].includes(request.mode)) {
      // Run from state storage: the transaction may quarantine the source that
      // originally loaded this plugin. All imports must survive that operation.
      const runtime = join(lock, 'runtime')
      mkdirSync(runtime)
      const library = dirname(fileURLToPath(import.meta.url))
      for (const name of readdirSync(library).filter(name => /\.(mjs|ps1)$/.test(name))) {
        copyFileSync(join(library, name), join(runtime, name))
      }
      if (request.mode !== 'install') copyFileSync(join(request.installation.appDir, 'bin', 'installation-state.cjs'), join(runtime, 'installation-state.cjs'))
      worker = join(runtime, 'worker.mjs')
    }
    writeFileSync(job, JSON.stringify(request), { flag: 'wx', mode: 0o600 })
    writeFileSync(join(request.stateDir, 'last-result.json'), JSON.stringify({ status: 'pending', mode: request.mode, stamp: request.stamp }), { mode: 0o600 })
    const child = spawn(process.execPath, [worker, job], { detached: true, stdio: 'ignore', cwd: request.stateDir, env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } })
    if (Number.isInteger(child.pid) && child.pid > 1) {
      try { writeFileSync(join(lock, 'worker.json'), JSON.stringify({ pid: child.pid, startedAt: Date.now() }), { flag: 'wx', mode: 0o600 }) } catch {}
    }
    child.on('error', () => { /* request stays on disk for diagnosis; no profile was changed */ })
    child.unref()
    return { pid: child.pid, logPath: join(request.stateDir, 'last-run.log'), reclaimed, stamp: request.stamp }
  } catch (error) {
    throw new Error(`无法启动切换助手，待处理记录位于 ${lock}：${error.message}`)
  }
}
