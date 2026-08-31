import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { migrateSessionPrefixEvents, decodeZstdFrames } from '../bin/session-prefix-migration.mjs'

test('旧压缩历史兼容修复保留全部帧、头、序号和正文，原文件备份，重复执行不改写', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-prefix-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sessionsRoot = path.join(root, 'sessions'), backupRoot = path.join(root, 'backups')
  const folder = path.join(sessionsRoot, 'workspace', 'session-test')
  await mkdir(folder, { recursive: true })
  const header = JSON.stringify({ type: 'session', id: 'session-test', version: 0 }) + '\n'
  const prefix = { type: 'dsh-tavern/stable-prefix', seq: 0, time: 1, data: { version: 1, id: 'tavern-session-prefix:session-test', text: '固定背景' } }
  const body = { type: 'user/message', seq: 1, time: 2, data: { content: [{ type: 'text', text: '保留正文' }] } }
  const original = Buffer.concat([zstdCompressSync(header), zstdCompressSync(JSON.stringify(prefix) + '\n'), zstdCompressSync(JSON.stringify(body) + '\n')])
  const file = path.join(folder, 'session.jsonl.zstd')
  await writeFile(file, original)
  const result = await migrateSessionPrefixEvents({ sessionsRoot, backupRoot })
  assert.equal(result.length, 1)
  assert.equal(result[0].events, 1)
  assert.deepEqual(await readFile(result[0].backup), original)
  const saved = await readFile(file)
  const rows = decodeZstdFrames(saved).toString().trim().split('\n').map(JSON.parse)
  assert.deepEqual(rows, [JSON.parse(header), { ...prefix, ignorable: true }, body])
  assert.deepEqual(await migrateSessionPrefixEvents({ sessionsRoot, backupRoot }), [])
  assert.deepEqual(await readFile(file), saved)
})

test('只修复识别出的 Tavern 背景事件，其他未知事件和不完整文件不被改动', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-prefix-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'session.jsonl')
  const text = JSON.stringify({ type: 'session', id: 'test' }) + '\n' + JSON.stringify({ type: 'other/unknown', seq: 0, data: {} }) + '\n'
  await writeFile(file, text)
  assert.deepEqual(await migrateSessionPrefixEvents({ sessionsRoot: root, backupRoot: root + '-unused' }), [])
  assert.equal(await readFile(file, 'utf8'), text)
  await writeFile(file, text + '{"type":"dsh-tavern/stable-prefix"')
  await assert.rejects(migrateSessionPrefixEvents({ sessionsRoot: root, backupRoot: root + '-unused' }))
  assert.equal(await readFile(file, 'utf8'), text + '{"type":"dsh-tavern/stable-prefix"')
})
