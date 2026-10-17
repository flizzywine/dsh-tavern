
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'

import os from 'node:os'
import path from 'node:path'
import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix, sessionStablePrefixSections } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

const text = '【故事设定 · 人物卡】\n名字: 测试人物\n\n设定: 固定背景\n\n【常驻世界书】\n固定世界'
let messageId = 0
const user = value => ({ id: 'message-' + (++messageId), role: 'user', content: [{ type: 'text', text: value }], source: { kind: 'user' } })
const plugin = value => ({ ...user(value), source: { kind: 'plugin', plugin: 'dsh-tavern' } })

test('旧外部文件和旧 ignorable 事件只作为迁移来源，提升为标准 Session 消息', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-prefix-legacy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const storage = createSessionStablePrefixStorage(directory)
  await storage.write('stored', { version: 1, id: 'tavern-session-prefix:stored', text })
  const stored = Session.create('stored')
  await ensureSessionStablePrefix(stored, '不能覆盖', storage)
  assert.equal(readSessionStablePrefix(stored).text, text)

  const legacyEvent = { type: 'dsh-tavern/stable-prefix', seq: 0, time: 1, ignorable: true, data: { version: 1, id: 'tavern-session-prefix:legacy', text } }
  const legacy = Session.create('legacy', [legacyEvent])
  await ensureSessionStablePrefix(legacy, '不能覆盖')
  assert.equal(readSessionStablePrefix(legacy).text, text)
  assert.equal(sessionEvents(legacy).filter(event => event.type === 'user/message').length, 1)
})

test('并发确保固定背景只追加一次并采用首次内容', async () => {
  const session = Session.create('concurrent')
  const values = await Promise.all([ensureSessionStablePrefix(session, text), ensureSessionStablePrefix(session, '不能覆盖')])
  assert.equal(values[0].message, values[1].message)
  assert.equal(values[0].text, text)
  assert.equal(sessionEvents(session).filter(event => event.type === 'user/message').length, 1)
  assert.equal(readSessionStablePrefix(session).message, session.deriveMessages()[0])
})

test('旧背景迁入系统上下文，已压缩的原文也可恢复，迁移不改写事件且幂等', async () => {
  for (const compressed of [false, true]) {
    const session = Session.create('old-' + compressed)
    const original = session.append('user/message', { id: 'tavern-session-prefix:' + session.id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot' } }, { surfaceOp: 'append' })
    if (compressed) appendSessionEvent(session, 'user/message', plugin('旧摘要已经遗漏人物背景'), { surfaceOp: { op: 'replace', start: original.seq, end: original.seq }, sourceEventSeqs: [original.seq] })
    const before = sessionEvents(session).slice()
    await ensureSessionStablePrefix(session, '不可替换原始背景')
    const length = sessionEvents(session).length
    await ensureSessionStablePrefix(session, '仍不可替换')
    assert.equal(sessionEvents(session).length, length)
    assert.deepEqual(sessionEvents(session).slice(0, before.length), before)
    assert.equal(readSessionStablePrefix(session).text, text)
    assert.ok(session.deriveMessages().every(m => !JSON.stringify(m.content).includes('固定背景')))
    const restored = Session.create(session.id, sessionEvents(session), session.header)
    assert.deepEqual(sessionStablePrefixSections(restored), sessionStablePrefixSections(session))
  }
})
