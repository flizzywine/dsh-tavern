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
