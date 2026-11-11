import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {copyBackupFiles} from '../tavern-plugin/lib/metadata-backup.js'

test('only specifically declared destructive media writes preserve bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'destructive-backup-'))
  t.after(() => fs.rm(root, {recursive:true, force:true}))
  await fs.writeFile(path.join(root, 'cover.png'), 'old cover')
  await fs.writeFile(path.join(root, 'immutable.png'), 'immutable')
  const destination = path.join(root, 'backup')
  assert.deepEqual(await copyBackupFiles(root, destination, ['cover.png','immutable.png'], {destructiveFiles:['cover.png']}), {files:1,bytes:9})
  assert.deepEqual(await fs.readdir(destination), ['cover.png'])
  await assert.rejects(copyBackupFiles(root, destination, ['../outside.json']), /Unsafe backup path/)
})
