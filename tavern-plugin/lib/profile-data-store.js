import path from 'node:path'
import { createDurableFilePromotion } from './durable-file-promotion.js'

function resolveSafePath(dataRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '' || path.isAbsolute(relativePath)) throw new Error('Profile 数据路径不合法')
  const target = path.resolve(dataRoot, relativePath)
  const relative = path.relative(dataRoot, target)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Profile 数据路径不合法')
  return target
}

function decodeJson(value) {
  return value === undefined ? undefined : JSON.parse(value.toString('utf8'))
}

function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Safe relative-path JSON adapter over durable absolute-file promotion. */
export function createProfileDataStore(options) {
  const dataRoot = path.resolve(options.dataRoot)
  const files = createDurableFilePromotion(options)
  return Object.freeze({
    async version(relativePath) { return files.version(resolveSafePath(dataRoot, relativePath)) },
    async readJson(relativePath) { return decodeJson(await files.read(resolveSafePath(dataRoot, relativePath))) },
    async writeJson(relativePath, value) { return files.write(resolveSafePath(dataRoot, relativePath), encodeJson(value)) },
    async updateJson(relativePath, updater) {
      const result = await files.update(resolveSafePath(dataRoot, relativePath), async function (current) {
        const next = await updater(decodeJson(current))
        return next === undefined ? undefined : encodeJson(next)
      })
      return decodeJson(result)
    },
    async remove(relativePath) { await files.remove(resolveSafePath(dataRoot, relativePath)) }
  })
}
