import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

const text = '【故事设定 · 人物卡】\n名字: 测试人物\n\n设定: 固定背景\n\n【常驻世界书】\n固定世界'
let messageId = 0
const user = value => ({ id: 'message-' + (++messageId), role: 'user', content: [{ type: 'text', text: value }], source: { kind: 'user' } })
const plugin = value => ({ ...user(value), source: { kind: 'plugin', plugin: 'dsh-tavern' } })

test('固定背景作为标准 DSH 消息进入 Session、轨迹与后续请求且只写一次', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-prefix-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let storage = createSessionStablePrefixStorage(directory)
  let session = Session.create('prefix-test')
  const prefix = await ensureSessionStablePrefix(session, text, storage)
  assert.equal(prefix.message.source.form, 'snapshot')
  assert.deepEqual(prefix.message.source.sections.map(section => section.name), ['tavern:character-card', 'tavern:constant-worldbook'])
  assert.equal(sessionEvents(session)[0].type, 'user/message')
  assert.equal(sessionEvents(session)[0].surfaceOp, 'append')
  assert.equal(session.deriveMessages()[0].content[0].text, text)
  const first = session.append('user/message', user('第一轮'), { surfaceOp: 'append' })
  const second = session.append('user/message', user('第二轮'), { surfaceOp: 'append' })
  assert.equal((await ensureSessionStablePrefix(session, '后来改卡不重新注入', storage)).message, prefix.message)
  session.append('user/message', plugin('剧情摘要'), { surfaceOp: { op: 'replace', start: first.seq, end: second.seq }, sourceEventSeqs: [first.seq, second.seq] })
  session = Session.create(session.id, sessionEvents(session), session.header)
  storage = createSessionStablePrefixStorage(directory)
  assert.equal((await ensureSessionStablePrefix(session, '重启不重新注入', storage)).text, text)
  assert.equal(sessionEvents(session).filter(event => event.type === 'dsh-tavern/stable-prefix').length, 0)
  assert.equal(sessionEvents(session).filter(event => event.type === 'user/message' && event.data.id === prefix.id).length, 1)
  assert.equal(session.deriveMessages()[0].content[0].text, text)
})

test('旧外部文件和旧 ignorable 事件只作为迁移来源，提升为标准 Session 消息', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-prefix-legacy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const storage = createSessionStablePrefixStorage(directory)
  await storage.write('stored', { version: 1, id: 'tavern-session-prefix:stored', text })
  const stored = Session.create('stored')
  await ensureSessionStablePrefix(stored, '不能覆盖', storage)
  assert.equal(stored.deriveMessages()[0].content[0].text, text)

  const legacyEvent = { type: 'dsh-tavern/stable-prefix', seq: 0, time: 1, ignorable: true, data: { version: 1, id: 'tavern-session-prefix:legacy', text } }
  const legacy = Session.create('legacy', [legacyEvent])
  await ensureSessionStablePrefix(legacy, '不能覆盖')
  assert.equal(legacy.deriveMessages()[0].content[0].text, text)
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
