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
