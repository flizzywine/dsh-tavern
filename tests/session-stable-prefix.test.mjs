import assert from 'node:assert/strict'
import test from 'node:test'

import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { ensureSessionStablePrefix, readSessionStablePrefix, sessionStablePrefixSections } from "../tavern-plugin/lib/domain/session-stable-prefix.js"

const text = '【故事设定 · 人物卡】\n名字: 测试人物\n\n设定: 固定背景\n\n【常驻世界书】\n固定世界'
let messageId = 0
const user = value => ({ id: 'message-' + (++messageId), role: 'user', content: [{ type: 'text', text: value }], source: { kind: 'user' } })
const plugin = value => ({ ...user(value), source: { kind: 'plugin', plugin: 'dsh-tavern' } })

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
