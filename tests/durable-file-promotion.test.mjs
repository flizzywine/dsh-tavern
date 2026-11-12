import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
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

test('写锁靠文件存在互斥；崩溃后缺少属主记录的旧锁按年龄回收', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'head.json'), lock = target + '.write-lock'
  // Stores whose live locks never expire by age (the conversation head) still recover an empty crash leftover.
  const promotion = createDurableFilePromotion({ writeLockStaleMs: Number.MAX_SAFE_INTEGER })

  await writeFile(lock, '')
  await assert.rejects(promotion.write(target, 'blocked'), { code: 'DSH_TAVERN_WRITE_CONFLICT' }, 'a lock being created right now is respected')
  const old = new Date(Date.now() - 120_000)
  await utimes(lock, old, old)
  const result = await promotion.write(target, 'saved')
  assert.equal(result.status, 'promoted')
  assert.equal(await readFile(target, 'utf8'), 'saved')
  assert.equal((await readdir(root)).includes('head.json.write-lock'), false)

  // A live writer's lock with its owner record still excludes others.
  let release
  const held = promotion.update(target, () => new Promise(resolve => { release = resolve }))
  while (!(await readdir(root)).includes('head.json.write-lock')) await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(createDurableFilePromotion({ writeLockStaleMs: Number.MAX_SAFE_INTEGER }).write(target, 'other'), { code: 'DSH_TAVERN_WRITE_CONFLICT' })
  release(undefined)
  await held
  assert.equal(await readFile(target, 'utf8'), 'saved')
})

test('a durable write fsyncs its data but not the write-lock owner record', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const probe = await open(path.join(root, 'probe'), 'w')
  const proto = Object.getPrototypeOf(probe)
  await probe.close()
  const original = proto.sync, callers = []
  proto.sync = async function () {
    callers.push(/at (?:async )?(\w+)/.exec(new Error().stack.split('\n').slice(2).join('\n'))?.[1])
    return await original.call(this)
  }
  t.after(function () { proto.sync = original })
  const promotion = createDurableFilePromotion({ writerId: 'writer-a' })
  for (let index = 0; index < 3; index++) await promotion.write(path.join(root, 'chat.json'), JSON.stringify({ index }))
  assert.equal(callers.filter(caller => caller === 'writeTarget').length, 3, 'each write fsyncs its data')
  assert.equal(callers.filter(caller => caller === 'withWriteLock').length, 0, 'the lock owner record is not fsynced')
})