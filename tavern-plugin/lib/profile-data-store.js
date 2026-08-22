import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

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

  return {
    async readJson(relativePath) {
      const target = resolveSafePath(dataRoot, relativePath)
      try {
        return JSON.parse(await readFile(target, 'utf8'))
      } catch (error) {
        if (error?.code === 'ENOENT') return undefined
        throw error
      }
    },

    async writeJson(relativePath, value) {
      const target = resolveSafePath(dataRoot, relativePath)
      await mkdir(path.dirname(target), { recursive: true })
      const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
      try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
        await rename(temporary, target)
      } catch (error) {
        await rm(temporary, { force: true }).catch(function () {})
        throw error
      }
    },

    async remove(relativePath) {
      const target = resolveSafePath(dataRoot, relativePath)
      await rm(target, { force: true })
    }
  }
}
