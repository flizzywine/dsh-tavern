import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RENAME_RETRY_DELAYS_MS = [25, 75, 150]
const WINDOWS_RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600, 2000]
const PENDING_MARKER = '.pending-'
const WRITE_LOCK_SUFFIX = '.write-lock'

function resolveSafePath(dataRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '' || path.isAbsolute(relativePath)) {
    throw new Error('Profile 数据路径不合法')
  }
  const target = path.resolve(dataRoot, relativePath)
  const relative = path.relative(dataRoot, target)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Profile 数据路径不合法')
  }
  return target
}

export function createProfileDataStore(options) {
  const dataRoot = path.resolve(options.dataRoot)
  const renameFile = options.rename ?? rename
  const sleep = options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
  const renameRetryDelays = (options.platform ?? process.platform) === 'win32' ? WINDOWS_RENAME_RETRY_DELAYS_MS : RENAME_RETRY_DELAYS_MS
  const writeQueues = new Map()

  function processIsAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error?.code === 'EPERM'
    }
  }

  async function withWriteLock(target, operation) {
    await mkdir(path.dirname(target), { recursive: true })
    const lockPath = target + WRITE_LOCK_SUFFIX
    let handle
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        handle = await open(lockPath, 'wx')
        break
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        let owner = null
        try { owner = JSON.parse(await readFile(lockPath, 'utf8')) } catch (_error) {}
        let stale = Number.isSafeInteger(Number(owner && owner.pid)) && !processIsAlive(Number(owner.pid))
        if (!owner) {
          try { stale = Date.now() - Number((await stat(lockPath)).mtimeMs) > 60_000 } catch (_error) {}
        }
        if (attempt === 0 && stale) {
          await rm(lockPath, { force: true })
          continue
        }
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

  function pendingPrefix(target) {
    return path.basename(target) + PENDING_MARKER
  }

  function pendingRevision(target, name) {
    const prefix = pendingPrefix(target)
    if (!name.startsWith(prefix)) return null
    const match = /^(\d+)-([0-9a-f-]+)$/i.exec(name.slice(prefix.length))
    if (match === null) return null
    const revision = Number(match[1])
    return Number.isSafeInteger(revision) && revision > 0 ? revision : null
  }

  function isPendingArtifact(target, name) {
    return name.startsWith(pendingPrefix(target))
  }

  async function pendingSnapshots(target, retryAfterPromotion = true) {
    let names
    try {
      names = await readdir(path.dirname(target))
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const snapshots = []
    for (const name of names) {
      const revision = pendingRevision(target, name)
      if (revision === null) continue
      const snapshotPath = path.join(path.dirname(target), name)
      let value
      try {
        value = JSON.parse(await readFile(snapshotPath, 'utf8'))
      } catch (error) {
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

  async function readCanonicalTarget(target) {
    try {
      return JSON.parse(await readFile(target, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  }

  async function readTarget(target) {
    const snapshots = await pendingSnapshots(target)
    if (snapshots.length > 0) return snapshots[snapshots.length - 1].value
    return readCanonicalTarget(target)
  }

  async function replaceTarget(temporary, target) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await renameFile(temporary, target)
        return
      } catch (error) {
        const transient = TRANSIENT_RENAME_ERRORS.has(error?.code)
        const delay = renameRetryDelays[attempt]
        if (!transient) throw error
        if (delay === undefined) {
          error.dshTavernRenameRetriesExhausted = true
          throw error
        }
        await sleep(delay)
      }
    }
  }

  async function cleanupPending(target, exceptPath) {
    let names
    try {
      names = await readdir(path.dirname(target))
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    await Promise.all(names.filter(function (name) {
      return isPendingArtifact(target, name) && path.join(path.dirname(target), name) !== exceptPath
    }).map(function (name) {
      return rm(path.join(path.dirname(target), name), { force: true })
    }))
  }

  async function writeTarget(target, value) {
    await mkdir(path.dirname(target), { recursive: true })
    const snapshots = await pendingSnapshots(target)
    const revision = snapshots.length === 0 ? 1 : snapshots[snapshots.length - 1].revision + 1
    const pending = path.join(path.dirname(target), `${pendingPrefix(target)}${revision}-${randomUUID()}`)
    const staging = `${pending}.staging-${randomUUID()}`
    try {
      await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await rename(staging, pending)
      await replaceTarget(pending, target)
      await cleanupPending(target)
      return { status: 'promoted', revision }
    } catch (error) {
      if (error?.dshTavernRenameRetriesExhausted) {
        return { status: 'deferred', revision, recoveryPath: pending }
      }
      await rm(staging, { force: true }).catch(function () {})
      await rm(pending, { force: true }).catch(function () {})
      throw error
    }
  }

  function enqueue(target, operation) {
    const previous = writeQueues.get(target) ?? Promise.resolve()
    const current = previous.catch(function () {}).then(operation)
    writeQueues.set(target, current)
    return current.finally(function () {
      if (writeQueues.get(target) === current) writeQueues.delete(target)
    })
  }

  return {
    async version(relativePath) {
      const target = resolveSafePath(dataRoot, relativePath)
      const snapshots = await pendingSnapshots(target)
      if (snapshots.length > 0) {
        const latest = snapshots[snapshots.length - 1]
        try {
          const info = await stat(latest.path, { bigint: true })
          return ['pending', latest.revision, info.dev, info.ino, info.size, info.mtimeNs].join(':')
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
      try {
        const info = await stat(target, { bigint: true })
        return [info.dev, info.ino, info.size, info.mtimeNs].join(':')
      } catch (error) {
        if (error?.code === 'ENOENT') return ''
        throw error
      }
    },

    async readJson(relativePath) {
      const target = resolveSafePath(dataRoot, relativePath)
      return readTarget(target)
    },

    async writeJson(relativePath, value) {
      const target = resolveSafePath(dataRoot, relativePath)
      return enqueue(target, () => withWriteLock(target, () => writeTarget(target, value)))
    },

    async updateJson(relativePath, updater) {
      const target = resolveSafePath(dataRoot, relativePath)
      return enqueue(target, () => withWriteLock(target, async () => {
        const current = await readTarget(target)
        const next = await updater(current)
        if (next === undefined) return current
        await writeTarget(target, next)
        return next
      }))
    },

    async remove(relativePath) {
      const target = resolveSafePath(dataRoot, relativePath)
      await enqueue(target, () => withWriteLock(target, async function () {
        await rm(target, { force: true })
        await cleanupPending(target)
      }))
    }
  }
}
