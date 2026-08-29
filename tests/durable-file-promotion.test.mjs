import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDurableFilePromotion } from '../tavern-plugin/lib/durable-file-promotion.js'

test('文本与二进制文件共用同一 durable promotion interface', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const files = createDurableFilePromotion()
  const textPath = path.join(root, 'state.json')
  const binaryPath = path.join(root, 'original.png')

  await files.write(textPath, '{"ready":true}\n')
  await files.write(binaryPath, Buffer.from([0, 1, 2, 255]))

  assert.equal((await files.read(textPath)).toString('utf8'), '{"ready":true}\n')
  assert.deepEqual(await files.read(binaryPath), Buffer.from([0, 1, 2, 255]))
})

test('任意文件在 Windows promotion 失败后都从 pending 恢复最新内容', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'bindings.json')
  await createDurableFilePromotion().write(target, 'old')
  const locked = createDurableFilePromotion({
    platform: 'win32',
    rename: async function () { const error = new Error('locked'); error.code = 'EPERM'; throw error },
    sleep: async function () {}
  })

  const result = await locked.write(target, 'new')

  assert.equal(result.status, 'deferred')
  assert.equal((await readFile(target, 'utf8')), 'old')
  assert.equal((await createDurableFilePromotion().read(target)).toString('utf8'), 'new')
  assert.equal((await readdir(root)).some(function (name) { return name.startsWith('bindings.json.pending-') }), true)
})

test('短暂的 Windows 占用在同一 implementation 内重试', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'skill.md')
  let calls = 0
  const files = createDurableFilePromotion({
    platform: 'win32',
    rename: async function (source, destination) {
      calls += 1
      if (calls === 1) { const error = new Error('busy'); error.code = 'EBUSY'; throw error }
      await rename(source, destination)
    },
    sleep: async function () {}
  })

  await files.write(target, '# Skill\n')
  assert.equal(calls, 2)
  assert.equal((await files.read(target)).toString('utf8'), '# Skill\n')
})

test('结构损坏的写入锁不会永久阻断资源', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'card.json')
  await writeFile(target + '.write-lock', JSON.stringify({ kind: 'mistaken-card-workspace', raw: { pid: process.pid } }))

  await createDurableFilePromotion().write(target, 'recovered')

  assert.equal(await readFile(target, 'utf8'), 'recovered')
  assert.equal((await readdir(root)).includes('card.json.write-lock'), false)
})

test('同一 writer 遗留的写锁会在下一次写入时自愈', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'card.json')
  const files = createDurableFilePromotion({ writerId: 'writer-a' })
  await writeFile(target, '{}')
  await writeFile(target + '.write-lock', JSON.stringify({ pid: process.pid, writerId: 'writer-a', createdAt: Date.now() }) + '\n')

  await files.write(target, '{"saved":true}')

  assert.equal((await readFile(target, 'utf8')), '{"saved":true}')
})

test('超过安全期限的写锁即使 PID 存活也会被回收', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'card.json')
  await writeFile(target, '{}')
  await writeFile(target + '.write-lock', JSON.stringify({ pid: process.pid, writerId: 'old-writer', createdAt: Date.now() - 120_000 }) + '\n')

  await createDurableFilePromotion({ writerId: 'writer-b' }).write(target, '{"saved":true}')

  assert.equal((await readFile(target, 'utf8')), '{"saved":true}')
})

test('Windows 短暂拒绝删除写锁时会重试清理', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-file-promotion-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const target = path.join(root, 'card.json')
  let lockRemovalAttempts = 0
  const files = createDurableFilePromotion({
    platform: 'win32',
    sleep: async function () {},
    remove: async function (file, options) {
      if (file.endsWith('.write-lock')) {
        lockRemovalAttempts += 1
        if (lockRemovalAttempts === 1) { const error = new Error('busy'); error.code = 'EPERM'; throw error }
      }
      await rm(file, options)
    }
  })

  await files.write(target, '{"saved":true}')

  assert.equal(lockRemovalAttempts, 2)
  assert.equal((await readFile(target, 'utf8')), '{"saved":true}')
})
