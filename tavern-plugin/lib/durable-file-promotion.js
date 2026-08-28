import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RENAME_RETRY_DELAYS_MS = [25, 75, 150]
const WINDOWS_RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600, 2000]
const PENDING_MARKER = '.pending-'
const WRITE_LOCK_SUFFIX = '.write-lock'

function bytes(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return Buffer.from(String(value), 'utf8')
}

/** Durable, crash-recoverable promotion for one absolute filesystem target. */
export function createDurableFilePromotion(options = {}) {
  const renameFile = options.rename ?? rename
  const sleep = options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
  const platform = options.platform ?? process.platform
  const renameRetryDelays = platform === 'win32' ? WINDOWS_RENAME_RETRY_DELAYS_MS : RENAME_RETRY_DELAYS_MS
  const writeQueues = new Map()

  function processIsAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
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
        const validOwner = owner !== null && typeof owner === 'object' && Number.isSafeInteger(Number(owner.pid)) && Number(owner.pid) > 0
        let stale = validOwner ? !processIsAlive(Number(owner.pid)) : owner !== null
        if (owner === null) {
          try { stale = Date.now() - Number((await stat(lockPath)).mtimeMs) > 60_000 } catch {}
        }
        if (attempt === 0 && stale) { await rm(lockPath, { force: true }); continue }
        const conflict = new Error(`另一个 Tavern 写入进程正在更新同一文件，拒绝并发覆盖：${target}`)
        conflict.code = 'DSH_TAVERN_WRITE_CONFLICT'
        conflict.owner = owner
        throw conflict
      }
    }
    if (!handle) throw new Error(`无法取得 Tavern 写入锁：${target}`)
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }) + '\n', 'utf8')
      await handle.sync()
      return await operation()
    } finally {
      await handle.close().catch(function () {})
      await rm(lockPath, { force: true }).catch(function () {})
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

  async function pendingSnapshots(target, retryAfterPromotion = true) {
    let names
    try { names = await readdir(path.dirname(target)) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    const snapshots = []
    for (const name of names) {
      const revision = pendingRevision(target, name)
      if (revision === null) continue
      const snapshotPath = path.join(path.dirname(target), name)
      let value
      try { value = await readFile(snapshotPath) } catch (error) {
        if (error?.code === 'ENOENT' && retryAfterPromotion) return pendingSnapshots(target, false)
        error.message = `待恢复快照损坏，无法安全读取：${snapshotPath}。${error.message}`
        throw error
      }
      snapshots.push({ path: snapshotPath, revision, value })
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

  async function readTarget(target) {
    const snapshots = await pendingSnapshots(target)
    if (snapshots.length > 0) return snapshots[snapshots.length - 1].value
    try { return await readFile(target) } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
  }

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

  async function writeTarget(target, value) {
    await mkdir(path.dirname(target), { recursive: true })
    const snapshots = await pendingSnapshots(target)
    const revision = snapshots.length === 0 ? 1 : snapshots[snapshots.length - 1].revision + 1
    const pending = path.join(path.dirname(target), `${pendingPrefix(target)}${revision}-${randomUUID()}`)
    const staging = `${pending}.staging-${randomUUID()}`
    let handle
    try {
      handle = await open(staging, 'wx')
      await handle.writeFile(bytes(value))
      await handle.sync()
      await handle.close(); handle = null
      await rename(staging, pending)
      await syncDirectory(path.dirname(target))
      await replaceTarget(pending, target)
      await syncDirectory(path.dirname(target))
      await cleanupPending(target)
      return { status: 'promoted', revision }
    } catch (error) {
      if (handle) await handle.close().catch(function () {})
      if (error?.dshTavernRenameRetriesExhausted) return { status: 'deferred', revision, recoveryPath: pending }
      await rm(staging, { force: true }).catch(function () {})
      await rm(pending, { force: true }).catch(function () {})
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
      const absolute = path.resolve(target)
      const snapshots = await pendingSnapshots(absolute)
      if (snapshots.length > 0) {
        const latest = snapshots[snapshots.length - 1]
        try {
          const info = await stat(latest.path, { bigint: true })
          return ['pending', latest.revision, info.dev, info.ino, info.size, info.mtimeNs].join(':')
        } catch (error) { if (error?.code !== 'ENOENT') throw error }
      }
      try {
        const info = await stat(absolute, { bigint: true })
        return [info.dev, info.ino, info.size, info.mtimeNs].join(':')
      } catch (error) { if (error?.code === 'ENOENT') return ''; throw error }
    },
    async read(target) { return readTarget(path.resolve(target)) },
    async write(target, value) {
      const absolute = path.resolve(target)
      return enqueue(absolute, () => withWriteLock(absolute, () => writeTarget(absolute, value)))
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
