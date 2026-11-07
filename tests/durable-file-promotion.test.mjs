import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDurableFilePromotion } from '../tavern-plugin/lib/durable-file-promotion.js'

test('超过安全期限的写锁即使 PID 存活也会被回收', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'card.json')
  await writeFile(target, '{}')
  await writeFile(target + '.write-lock', JSON.stringify({ pid: process.pid, writerId: 'old-writer', createdAt: Date.now() - 120_000 }) + '\n')

  await createDurableFilePromotion({ writerId: 'writer-b' }).write(target, '{"saved":true}')

  assert.equal((await readFile(target, 'utf8')), '{"saved":true}')
})
