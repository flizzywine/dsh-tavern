import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { migrateSessionPrefixEvents } from '../bin/session-prefix-migration.mjs'

test('the startup scan reuses checked files and checks a changed or newly imported history', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-prefix-scan-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sessionsRoot = path.join(root, 'sessions'), backupRoot = path.join(root, 'backups')
  const scanFile = path.join(backupRoot, 'session-scan-v1.json')
  const scan = () => migrateSessionPrefixEvents({ sessionsRoot, backupRoot })
  async function writeSession(id, ignorable) {
    const dir = path.join(sessionsRoot, id)
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, 'session.jsonl')
    const events = [{ type: 'session', id }, {
      type: 'dsh-tavern/stable-prefix', seq: 1, ignorable,
      data: { version: 1, id: 'tavern-session-prefix:' + id, text: '旧背景' }
    }]
    await writeFile(file, events.map(event => JSON.stringify(event)).join('\n') + '\n')
    return file
  }
  const checked = await writeSession('checked', true)
  assert.deepEqual(await scan(), [])
  const firstScan = await stat(scanFile, { bigint: true })
  assert.deepEqual(await scan(), [])
  assert.equal((await stat(scanFile, { bigint: true })).ino, firstScan.ino, 'a warm scan leaves the cache file in place')
  assert.equal((await stat(scanFile, { bigint: true })).mtimeNs, firstScan.mtimeNs)

  await writeSession('checked', false)
  const imported = await writeSession('imported', false)
  const repairs = await scan()
  assert.deepEqual(repairs.map(repair => repair.file).sort(), [checked, imported].sort())
  for (const { file, backup } of repairs) {
    const marker = async target => JSON.parse((await readFile(target, 'utf8')).split('\n')[1])
    assert.equal((await marker(file)).ignorable, true)
    assert.equal((await marker(backup)).ignorable, false)
  }
  await writeFile(scanFile, '{')
  assert.deepEqual(await scan(), [])
  assert.equal(JSON.parse(await readFile(scanFile, 'utf8')).files.length, 2)
})
