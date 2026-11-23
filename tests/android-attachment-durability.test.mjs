import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const preload = fileURLToPath(new URL('../android/native/shims/android-preload.cjs', import.meta.url))

test('Android attachment storage syncs private directories and preserves their permission errors', () => {
  const parent = mkdtempSync(join(tmpdir(), 'android-attachment-'))
  const home = join(parent, 'home')
  const probe = `
    import assert from 'node:assert/strict'
    import { createHash } from 'node:crypto'
    import fs from 'node:fs'
    import { createRequire, syncBuiltinESMExports } from 'node:module'
    import { join } from 'node:path'
    import { pathToFileURL } from 'node:url'

    const [parent, home, mode] = process.argv.slice(1)
    const dshHome = join(mode === 'outside' ? home + '-other' : home, '.dsh-tavern')
    const root = join(dshHome, 'attachments', 'v1')
    const denied = mode === 'private' ? join(dshHome, 'attachments') : parent
    const synced = new Set()
    const { constants, promises } = fs
    const open = promises.open
    // Windows normally skips directory fsync. Simulate Android directory handles
    // on every host while leaving attachment file IO on the real filesystem.
    Object.defineProperty(process, 'platform', { value: 'android' })
    promises.open = async (file, flags, ...args) => {
      if (flags !== constants.O_RDONLY || !(await promises.stat(file)).isDirectory()) return open(file, flags, ...args)
      if (file === denied) throw Object.assign(new Error('Permission denied'), { code: 'EACCES', path: file })
      return { async sync() { synced.add(file) }, async close() {} }
    }
    syncBuiltinESMExports()

    const entry = createRequire(process.env.DSH_BOOT_MODULE).resolve('@deepseek-ai/dsh-attachment-local')
    const { commitPreparedImageFile } = await import(pathToFileURL(entry).href)
    const data = Buffer.from('prepared image bytes')
    const sha = createHash('sha256').update(data).digest('hex')
    const prepared = { data, ref: { attachmentId: 'sha256:' + sha, bytes: data.length } }
    if (mode !== 'fixed') {
      await assert.rejects(commitPreparedImageFile(root, prepared), { code: 'EACCES', path: denied })
    } else {
      const object = join(root, 'objects', sha.slice(0, 2), sha)
      assert.deepEqual(await commitPreparedImageFile(root, prepared), prepared.ref)
      // The store publishes a read-only file. Restore write permission for Windows cleanup.
      await promises.chmod(object, 0o600)
      assert.deepEqual(await promises.readFile(object), data)
      assert.ok(synced.has(home))
      assert.ok(synced.has(dshHome))
      assert.ok(synced.has(root))
      assert.ok(synced.has(join(root, 'objects', sha.slice(0, 2))))
    }
  `
  try {
    mkdirSync(home)
    for (const mode of ['baseline', 'fixed', 'private', 'outside']) {
      const args = mode === 'baseline' ? [] : ['--require', preload]
      const result = spawnSync(process.execPath, [...args, '--input-type=module', '-e', probe, parent, home, mode], {
        env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 10000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0, `${mode}: ${result.stderr}`)
    }
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
