import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const worldbookFileDigest = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 20)
// Keep Unicode titles readable, but portable on Windows and safe in Markdown links.
export const worldbookFileLabel = value => String(value || '资料').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\[\]()#%`]/g, '-').replace(/\s+/g, '-').replace(/^[. -]+|[. -]+$/g, '').slice(0, 44) || '资料'
/** Derived files live outside global skill scan roots. Each scope owns exactly
 * one replaceable directory. A fresh staging tree prevents partial publication;
 * unchanged generations do no IO. Never remove a directory supplied by a card.
 */
export function createWorldbookFileStore(root) {
  root = path.resolve(root)
  const queues = new Map(), versions = new Map(), names = new Map()
  const directory = key => {
    if (!/^[a-f0-9]{20}$/.test(key)) throw Error('Invalid generated worldbook scope')
    return path.join(root, names.get(key) || key)
  }
  function serial(key, operation) {
    key = root // Allocation and publication share a lock: rename briefly removes the target.
    const job = (queues.get(key) || Promise.resolve()).catch(() => {}).then(operation)
    queues.set(key, job)
    job.finally(() => { if (queues.get(key) === job) queues.delete(key) }).catch(() => {})
    return job
  }
  async function ordinaryDirectory(dir) {
    await fs.mkdir(dir, { recursive: true })
    if ((await fs.lstat(dir)).isSymbolicLink()) throw Error('Generated worldbook directory must not be a symlink')
  }
  return {
    root, directory,
    assign(key, label, { legacyKey, versioned = false } = {}) {
      return serial(key, async () => {
        if (names.has(key)) return
        directory(key) // Validate the internal identity before any filesystem work.
        await ordinaryDirectory(root)
        for (const entry of await fs.readdir(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue
          try {
            const owner = await fs.readFile(path.join(root, entry.name, '.scope-id'), 'utf8')
            if (owner === key || owner === legacyKey) {
              if (owner !== key) await fs.writeFile(path.join(root, entry.name, '.scope-id'), key)
              names.set(key, entry.name); return
            }
          } catch (e) { if (e.code !== 'ENOENT') throw e }
        }
        const base = worldbookFileLabel(label)
        for (let number = 1; ; number++) {
          const name = number === 1 ? base : versioned ? `${base}（资料版本${number}）` : `${base}--${number}`
          try { await fs.mkdir(path.join(root, name)) }
          catch (e) { if (e.code === 'EEXIST') continue; throw e }
          await fs.writeFile(path.join(root, name, '.scope-id'), key, { flag: 'wx' })
          names.set(key, name)
          return
        }
      })
    },
    sync(key, files) {
      return serial(key, async () => {
        const version = worldbookFileDigest(JSON.stringify([...files]))
        const target = directory(key)
        if (versions.get(key) === version) {
          try { if ((await fs.lstat(target)).isDirectory()) return target } catch (e) { if (e.code !== 'ENOENT') throw e }
        }
        await ordinaryDirectory(root)
        const stage = path.join(root, `.staging-${key}-${randomUUID()}`)
        const old = path.join(root, `.retired-${key}-${randomUUID()}`)
        await fs.mkdir(stage)
        try {
          if (names.has(key)) await fs.writeFile(path.join(stage, '.scope-id'), key)
          for (const [relative, content] of files) {
            const file = path.resolve(stage, relative)
            if (!file.startsWith(stage + path.sep)) throw Error('Invalid generated worldbook filename')
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.writeFile(file, content, { encoding: 'utf8', flag: 'wx' })
          }
          let moved = false
          try { await fs.rename(target, old); moved = true } catch (e) { if (e.code !== 'ENOENT') throw e }
          try { await fs.rename(stage, target) }
          catch (e) { if (moved) await fs.rename(old, target); throw e }
          versions.set(key, version)
          if (moved) await fs.rm(old, { recursive: true, force: true })
          if (names.has(key)) await fs.rm(path.join(root, key), { recursive: true, force: true })
          return target
        } finally { await fs.rm(stage, { recursive: true, force: true }) }
      })
    },
    remove(key) {
      return serial(key, async () => {
        if (!names.has(key)) {
          for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue
            try { if (await fs.readFile(path.join(root, entry.name, '.scope-id'), 'utf8') === key) { names.set(key, entry.name); break } }
            catch (e) { if (e.code !== 'ENOENT') throw e }
          }
        }
        versions.delete(key); await fs.rm(directory(key), { recursive: true, force: true }); names.delete(key) })
    },
    async verify(file, expected) {
      // Refuse symlink aliases; repair edits to the derived copy from authority.
      const realRoot = await fs.realpath(root)
      await fs.mkdir(path.dirname(file), { recursive: true })
      const expectedParent = path.join(realRoot, path.relative(root, path.dirname(file)))
      if (await fs.realpath(path.dirname(file)) !== expectedParent) throw Error('Generated worldbook resource must not be a symlink')
      let actual
      try {
        if ((await fs.lstat(file)).isSymbolicLink()) throw Error('Generated worldbook resource must not be a symlink')
        actual = await fs.readFile(file, 'utf8')
      } catch (e) { if (e.code !== 'ENOENT') throw e }
      if (actual !== expected) {
        const temp = file + '.' + randomUUID() + '.tmp'
        try { await fs.writeFile(temp, expected); await fs.rename(temp, file) }
        finally { await fs.rm(temp, { force: true }) }
      }
    }
  }
}
