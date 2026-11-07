import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
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

test('无 owner 的崩溃写锁有 60 秒兜底，有效活写锁不被长迁移误回收', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-lock-owner-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'chat.json'), lock = target + '.write-lock'
  await writeFile(target, '{}')
  await writeFile(lock, '')
  const old = (Date.now() - 120_000) / 1000
  await utimes(lock, old, old)
  await createDurableFilePromotion({ writeLockStaleMs: Number.MAX_SAFE_INTEGER }).write(target, '{"saved":true}')
  assert.equal((await readFile(target, 'utf8')), '{"saved":true}')

  await writeFile(lock, JSON.stringify({ pid: process.pid, writerId: 'live-slow-writer', createdAt: Date.now() - 120_000 }))
  await assert.rejects(createDurableFilePromotion({ writeLockStaleMs: Number.MAX_SAFE_INTEGER }).write(target, '{"lost":true}'), { code: 'DSH_TAVERN_WRITE_CONFLICT' })
  assert.equal((await readFile(target, 'utf8')), '{"saved":true}')
})
