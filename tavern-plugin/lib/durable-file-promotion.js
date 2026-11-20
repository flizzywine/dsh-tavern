import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RENAME_RETRY_DELAYS_MS = [25, 75, 150]
const WINDOWS_RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600, 2000]
const PENDING_MARKER = '.pending-'
const WRITE_LOCK_SUFFIX = '.write-lock'
const WRITE_LOCK_STALE_MS = 60_000

function bytes(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return Buffer.from(String(value), 'utf8')
}

/** Durable, crash-recoverable promotion for one absolute filesystem target. */
export function createDurableFilePromotion(options = {}) {
  const renameFile = options.rename ?? rename
  const removeFile = options.remove ?? rm
  const sleep = options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
  const platform = options.platform ?? process.platform
  const renameRetryDelays = platform === 'win32' ? WINDOWS_RENAME_RETRY_DELAYS_MS : RENAME_RETRY_DELAYS_MS
  const writerId = options.writerId ?? randomUUID()
  const writeLockStaleMs = Number.isFinite(options.writeLockStaleMs) ? Math.max(1, Number(options.writeLockStaleMs)) : WRITE_LOCK_STALE_MS
  const writeQueues = new Map()

  function processIsAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
  }

  async function removeWriteLock(lockPath) {
    for (let attempt = 0; ; attempt += 1) {
      try { await removeFile(lockPath, { force: true }); return } catch (error) {
        const delay = renameRetryDelays[attempt]
        if (!TRANSIENT_RENAME_ERRORS.has(error?.code) || delay === undefined) throw error
        await sleep(delay)
      }
    }
  }

  async function staleWriteLock(lockPath, owner) {
    const validOwner = owner !== null && typeof owner === 'object' && Number.isSafeInteger(Number(owner.pid)) && Number(owner.pid) > 0
    if (owner !== null && !validOwner) return true
    if (owner && owner.writerId === writerId) return true
    const pid = Number(owner && owner.pid)
    if (Number.isSafeInteger(pid) && pid > 0 && !processIsAlive(pid)) return true
    let createdAt = Number(owner && owner.createdAt)
    // The owner record is written right after the lock is created and is not fsynced:
    // a lock without one is either being created this moment or was left by a system
    // crash. Its age decides, even for stores whose live locks never go stale by age.
    if (!owner) {
      try { createdAt = Number((await stat(lockPath)).mtimeMs) } catch { return false }
      return Date.now() - createdAt > Math.min(writeLockStaleMs, WRITE_LOCK_STALE_MS)
    }
    if (!Number.isFinite(createdAt) || createdAt <= 0) {
      try { createdAt = Number((await stat(lockPath)).mtimeMs) } catch { return false }
    }
    return Date.now() - createdAt > writeLockStaleMs
  }

  async function withWriteLock(target, operation) {
    await mkdir(path.dirname(target), { recursive: true })
    const lockPath = target + WRITE_LOCK_SUFFIX
    let handle
    for (let attempt = 0; attempt < 2; attempt++) {
      try { handle = await open(lockPath, 'wx'); break } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        let owner = null
        try { owner = JSON.parse(await readFile(lockPath, 'utf8')) } catch {}
        const stale = await staleWriteLock(lockPath, owner)
        if (attempt === 0 && stale) { await removeWriteLock(lockPath); continue }
        const conflict = new Error(`另一个 Tavern 写入进程正在更新同一文件，拒绝并发覆盖：${target}`)
        conflict.code = 'DSH_TAVERN_WRITE_CONFLICT'
        conflict.owner = owner
        throw conflict
      }
    }
    if (!handle) throw new Error(`无法取得 Tavern 写入锁：${target}`)
    try {
      // Exclusion comes from the file existing; its owner record only helps recover a
      // dead writer's lock, so it is not fsynced (see staleWriteLock).
      await handle.writeFile(JSON.stringify({ pid: process.pid, writerId, createdAt: Date.now() }) + '\n', 'utf8')
      return await operation()
    } finally {
      await handle.close().catch(function () {})
      await removeWriteLock(lockPath)
    }
  }

  function pendingPrefix(target) { return path.basename(target) + PENDING_MARKER }
  function pendingRevision(target, name) {
    const prefix = pendingPrefix(target)
    if (!name.startsWith(prefix)) return null
    const match = /^(\d+)-([0-9a-f-]+)$/i.exec(name.slice(prefix.length))
    if (match === null) return null
    const revision = Number(match[1])
    return Number.isSafeInteger(revision) && revision > 0 ? revision : null
  }

  async function pendingSnapshots(target) {
    let names
    try { names = await readdir(path.dirname(target)) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    const snapshots = []
    for (const name of names) {
      const revision = pendingRevision(target, name)
      if (revision === null) continue
      snapshots.push({ path: path.join(path.dirname(target), name), revision })
    }
    snapshots.sort(function (left, right) { return left.revision - right.revision || left.path.localeCompare(right.path) })
    for (let index = 1; index < snapshots.length; index++) {
      if (snapshots[index - 1].revision === snapshots[index].revision) {
        const error = new Error(`检测到多个写入进程产生的分叉快照（revision ${snapshots[index].revision}），拒绝静默覆盖：${target}`)
        error.code = 'DSH_TAVERN_PENDING_CONFLICT'
        throw error
      }
    }
    return snapshots
  }

  // Read and version use the same authority, including pending writes from other
  // stores. Retry selection if the pending file moved during the read.
  async function inspectTarget(target, inspect) {
    for (let attempt = 0; ; attempt++) {
      const pending = (await pendingSnapshots(target)).at(-1)
      try { return await inspect(pending?.path ?? target, pending?.revision) } catch (error) {
        if (error?.code === 'ENOENT') {
          if (!pending) return undefined
          if (attempt < 2) continue
        }
        if (pending) error.message = `待恢复快照损坏，无法安全读取：${pending.path}。${error.message}`
        throw error
      }
    }
  }
  const readTarget = target => inspectTarget(target, file => readFile(file))

  async function replaceTarget(temporary, target) {
    for (let attempt = 0; ; attempt += 1) {
      try { await renameFile(temporary, target); return } catch (error) {
        const delay = renameRetryDelays[attempt]
        if (!TRANSIENT_RENAME_ERRORS.has(error?.code)) throw error
        if (delay === undefined) { error.dshTavernRenameRetriesExhausted = true; throw error }
        await sleep(delay)
      }
    }
  }

  async function cleanupPending(target, exceptPath) {
    let names
    try { names = await readdir(path.dirname(target)) } catch (error) { if (error?.code === 'ENOENT') return; throw error }
    await Promise.all(names.filter(function (name) {
      return name.startsWith(pendingPrefix(target)) && path.join(path.dirname(target), name) !== exceptPath
    }).map(function (name) { return rm(path.join(path.dirname(target), name), { force: true }) }))
  }

  async function syncDirectory(directory) {
    if (platform === 'win32') return
    let handle
    try { handle = await open(directory, 'r'); await handle.sync() } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error
    } finally { if (handle) await handle.close().catch(function () {}) }
  }

  async function writeTarget(target, value, beforeCommit) {
    await mkdir(path.dirname(target), { recursive: true })
    const snapshots = await pendingSnapshots(target)
    const revision = snapshots.length === 0 ? 1 : snapshots[snapshots.length - 1].revision + 1
    const pending = path.join(path.dirname(target), `${pendingPrefix(target)}${revision}-${randomUUID()}`)
    const staging = `${pending}.staging-${randomUUID()}`
    let handle, published = false
    try {
      handle = await open(staging, 'wx')
      await handle.writeFile(bytes(value))
      await handle.sync()
      await handle.close(); handle = null
      // Pending snapshots are visible to readers, so authority is fenced before publication.
      await beforeCommit?.()
      await rename(staging, pending)
      await syncDirectory(path.dirname(target))
      published = true
      // A reader always prefers pending files. Retire older snapshots while
      // the newest one still has its pending name.
      if (snapshots.length > 0) {
        await cleanupPending(target, pending)
        await syncDirectory(path.dirname(target))
      }
      await replaceTarget(pending, target)
      await syncDirectory(path.dirname(target))
      return { status: 'promoted', revision }
    } catch (error) {
      if (handle) await handle.close().catch(function () {})
      if (error?.dshTavernRenameRetriesExhausted) return { status: 'deferred', revision, recoveryPath: pending }
      await rm(staging, { force: true }).catch(function () {})
      if (!published) await rm(pending, { force: true }).catch(function () {})
      throw error
    }
  }

  function enqueue(target, operation) {
    const absolute = path.resolve(target)
    const previous = writeQueues.get(absolute) ?? Promise.resolve()
    const current = previous.catch(function () {}).then(operation)
    writeQueues.set(absolute, current)
    return current.finally(function () { if (writeQueues.get(absolute) === current) writeQueues.delete(absolute) })
  }

  return Object.freeze({
    async version(target) {
      return await inspectTarget(path.resolve(target), async (file, revision) => {
        const info = await stat(file, { bigint: true })
        const identity = [info.dev, info.ino, info.size, info.mtimeNs].join(':')
        return revision === undefined ? identity : `pending:${revision}:${identity}`
      }) ?? ''
    },
    async size(target) { return await inspectTarget(path.resolve(target), async file => (await stat(file)).size) ?? 0 },
    async read(target) { return readTarget(path.resolve(target)) },
    // Newline-framed diagnostic logs: ordinary commits append and fsync only
    // the new frame. Creation, rotation and torn-tail recovery use the same
    // durable promotion protocol as snapshots, under the same writer lock.
    async append(target, value, { maxBytes, compact } = {}) {
      const frame = bytes(value)
      if (!Number.isSafeInteger(maxBytes) || maxBytes < frame.length || typeof compact !== 'function'
        || frame.length === 0 || frame.at(-1) !== 10) throw new Error('追加日志参数无效')
      const absolute = path.resolve(target)
      return enqueue(absolute, () => withWriteLock(absolute, async function () {
        const pending = await pendingSnapshots(absolute)
        let info
        try { info = await stat(absolute) } catch (error) { if (error?.code !== 'ENOENT') throw error }
        async function rewrite(current) {
          const snapshot = bytes(await compact(current, frame))
          if (snapshot.length > maxBytes || snapshot.at(-1) !== 10) throw new Error('日志压缩结果超出限制或缺少行边界')
          return writeTarget(absolute, snapshot)
        }
        if (pending.length) return rewrite(await readFile(pending.at(-1).path))
        if (!info || info.size === 0 || info.size + frame.length > maxBytes) return rewrite(await readTarget(absolute))
        const handle = await open(absolute, 'a+')
        let incomplete = false
        try {
          const tail = Buffer.alloc(1)
          const { bytesRead } = await handle.read(tail, 0, 1, info.size - 1)
          incomplete = bytesRead !== 1 || tail[0] !== 10
          if (!incomplete) {
            await handle.writeFile(frame)
            await handle.sync()
          }
        } finally { await handle.close() }
        if (incomplete) return rewrite(await readTarget(absolute))
        return { status: 'appended', bytes: frame.length }
      }))
    },
    async write(target, value, { beforeCommit } = {}) {
      const absolute = path.resolve(target)
      return enqueue(absolute, () => withWriteLock(absolute, () => writeTarget(absolute, value, beforeCommit)))
    },
    async update(target, updater) {
      if (typeof updater !== 'function') throw new Error('Durable File Promotion 缺少 updater')
      const absolute = path.resolve(target)
      return enqueue(absolute, () => withWriteLock(absolute, async function () {
        const current = await readTarget(absolute)
        const next = await updater(current)
        if (next === undefined) return current
        await writeTarget(absolute, next)
        return bytes(next)
      }))
    },
    async remove(target) {
      const absolute = path.resolve(target)
      await enqueue(absolute, () => withWriteLock(absolute, async function () {
        await rm(absolute, { force: true })
        await cleanupPending(absolute)
        await syncDirectory(path.dirname(absolute))
      }))
    }
  })
}
