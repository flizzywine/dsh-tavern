import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {homedir} from 'node:os'
import path from 'node:path'

// Preserve existing profile CSS skins in place. This store can only touch that
// directory; it has no access to Tavern's conversations or other profile files.
export function createSkinStore({home = process.env.DSH_HOME || path.join(homedir(), '.dsh')} = {}) {
  const root = path.resolve(home, 'profile-data/tavern/data/interface-skins')
  let pending = Promise.resolve()
  function file(name) {
    if (!/^interface-skins\/(?:index\.json|[0-9a-f]{12}\.css)$/.test(name)) throw new Error('皮肤数据路径不合法')
    return path.join(root, path.basename(name))
  }
  async function read(name) {
    try { return await readFile(file(name), 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  }
  async function write(name, data) {
    const target = file(name), temporary = target + '.' + randomUUID() + '.tmp'
    await mkdir(root, {recursive:true})
    try {
      await writeFile(temporary, data, {mode:0o600})
      await rename(temporary, target)
    } finally { await rm(temporary, {force:true}) }
  }
  const readJson = async name => {const text = await read(name);return text === undefined ? undefined : JSON.parse(text)}
  return {
    readText:read, readJson, writeBytes:write,
    remove:name => rm(file(name), {force:true}),
    updateJson(name, update) {
      const result = pending.then(async () => {
        const value = await update(await readJson(name))
        await write(name, JSON.stringify(value, null, 2) + '\n')
        return value
      })
      pending = result.catch(() => {})
      return result
    }
  }
}
