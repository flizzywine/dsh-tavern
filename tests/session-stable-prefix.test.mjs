import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Session } from '../tavern-plugin/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix, projectSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

const text = '【故事设定 · 人物卡】\n名字: 测试人物\n\n设定: 固定背景\n\n【常驻世界书】\n固定世界'
let messageId = 0
const user = value => ({ id: 'message-' + (++messageId), role: 'user', content: [{ type: 'text', text: value }], source: { kind: 'user' } })
const plugin = value => ({ ...user(value), source: { kind: 'plugin', plugin: 'dsh-tavern' } })

test('背景独立持久化，真实 Session 恢复与 Surface 压缩均不丢失，不写未知事件', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-prefix-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let storage = createSessionStablePrefixStorage(directory)
  let session = Session.create('prefix-test')
  const prefix = await ensureSessionStablePrefix(session, text, storage)
  const first = session.append('user/message', user('第一轮'), { surfaceOp: 'append' })
  const second = session.append('user/message', user('第二轮'), { surfaceOp: 'append' })
  assert.equal(await ensureSessionStablePrefix(session, '后来改卡不重新注入', storage), prefix)
  session.append('user/message', plugin('剧情摘要'), { surfaceOp: { op: 'replace', start: first.seq, end: second.seq }, sourceEventSeqs: [first.seq, second.seq] })
  session = Session.create(session.id, session.events, session.header)
  storage = createSessionStablePrefixStorage(directory)
  assert.equal((await ensureSessionStablePrefix(session, '重启不重新注入', storage)).text, text)
  assert.equal(session.events.filter(event => event.type === 'dsh-tavern/stable-prefix').length, 0)
  const request = { system: '当轮任务', messages: [plugin('剧情摘要'), user('第三轮')] }
  const projected = projectSessionStablePrefix(request, readSessionStablePrefix(session))
  assert.equal(projected.system, '当轮任务')
  assert.equal(projected.messages[0].content[0].text, text)
  assert.equal(projected.messages[1], request.messages[0])
  assert.deepEqual(projectSessionStablePrefix(projected, prefix), projected)
  assert.equal(projectSessionStablePrefix({ ...request, purpose: 'compaction' }, prefix).messages, request.messages)
})

test('旧候选历史仅移除人物卡基本信息，保留逐轮指令、状态与工具配对', () => {
  const legacy = plugin('【最近剧情与本次任务】\n任务类型：候选生成\n[用户]\n生成候选\n\n【DSH 后台任务协议（最终指令）】\n输出JSON\n\n【故事设定 · 人物卡】\n名字: 测试人物\n\n设定: 固定背景\n\n【文风示例】\n固定示例\n\n【附加要求】\n历史后指令\n\n【现场 · 主要人物状态（每轮结算更新，务必与之一致）】\n当前姿势')
  const quoted = user(legacy.content[0].text)
  const call = { role: 'assistant', content: [], tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'test', arguments: '{}' } }] }
  const tool = { role: 'tool', tool_call_id: 'call-1', content: [{ type: 'text', text: '结果' }] }
  const before = structuredClone(legacy)
  const request = { system: '候选规则', messages: [legacy, quoted, call, tool, plugin('本轮最新输入')] }
  const result = projectSessionStablePrefix(request, { id: 'prefix', text })
  assert.doesNotMatch(result.messages[1].content[0].text, /固定背景|固定示例|名字:/)
  assert.match(result.messages[1].content[0].text, /历史后指令/)
  assert.match(result.messages[1].content[0].text, /当前姿势/)
  assert.match(result.messages[1].content[0].text, /生成候选/)
  assert.deepEqual(legacy, before)
  assert.equal(result.messages[2], quoted)
  assert.equal(result.messages[3], call)
  assert.equal(result.messages[4], tool)
})

test('旧背景事件继续读取；存储失败不缓存；同 Session 并发只采用首次背景', async () => {
  const legacy = { id: 'legacy', events: [{ type: 'dsh-tavern/stable-prefix', data: { version: 1, id: 'tavern-session-prefix:legacy', text } }] }
  assert.equal((await ensureSessionStablePrefix(legacy, '不能覆盖')).text, text)
  const session = { id: 'concurrent', events: [] }
  const broken = { async read() { return null }, async write() { throw new Error('disk failed') } }
  await assert.rejects(ensureSessionStablePrefix(session, text, broken), /disk failed/)
  assert.equal(readSessionStablePrefix(session), null)
  let writes = 0
  const storage = { async read() { return null }, async write() { writes++ } }
  const values = await Promise.all([ensureSessionStablePrefix(session, text, storage), ensureSessionStablePrefix(session, '不能覆盖', storage)])
  assert.equal(writes, 1)
  assert.equal(values[0], values[1])
  assert.equal(values[0].text, text)
})

test('旧前台 Frame 依据结构化来源去重，不改玩家输入和其他字段', () => {
  const sections = [
    { text: '固定背景', source: { sectionKind: 'card' } },
    { text: '当轮系统指令', source: { sectionKind: 'card-instruction' } },
    { text: '动态世界书', source: { sectionKind: 'world-book' } }
  ]
  const frame = { ...plugin(sections.map(section => section.text).join('\n\n')), source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'foreground-frame', sections } }
  const result = projectSessionStablePrefix({ messages: [frame] }, { id: 'prefix', text })
  assert.equal(result.messages[1].content[0].text, '当轮系统指令\n\n动态世界书')
  assert.equal(frame.source.sections.length, 3)
})
