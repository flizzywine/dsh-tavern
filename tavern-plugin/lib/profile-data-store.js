import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RENAME_RETRY_DELAYS_MS = [25, 75, 150]

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
  const writeQueues = new Map()

  async function readTarget(target) {
    try {
      return JSON.parse(await readFile(target, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  }

  async function replaceTarget(temporary, target) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await renameFile(temporary, target)
        return
      } catch (error) {
        const delay = RENAME_RETRY_DELAYS_MS[attempt]
        if (!TRANSIENT_RENAME_ERRORS.has(error?.code) || delay === undefined) throw error
        await sleep(delay)
      }
    }
  }

  async function writeTarget(target, value) {
    await mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await replaceTarget(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true }).catch(function () {})
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
      return enqueue(target, () => writeTarget(target, value))
    },

    async updateJson(relativePath, updater) {
      const target = resolveSafePath(dataRoot, relativePath)
      return enqueue(target, async () => {
        const current = await readTarget(target)
        const next = await updater(current)
        if (next === undefined) return current
        await writeTarget(target, next)
        return next
      })
    },

    async remove(relativePath) {
      const target = resolveSafePath(dataRoot, relativePath)
      await rm(target, { force: true })
    }
  }
}
