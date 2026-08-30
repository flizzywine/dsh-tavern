import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from '../tavern-plugin/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { ensureSessionStablePrefix, readSessionStablePrefix, projectSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

const text = '【故事设定 · 人物卡】\n名字: 测试人物\n\n设定: 固定背景\n\n【常驻世界书】\n固定世界'
let messageId = 0
const user = value => ({ id: 'message-' + (++messageId), role: 'user', content: [{ type: 'text', text: value }], source: { kind: 'user' } })
const plugin = value => ({ ...user(value), source: { kind: 'plugin', plugin: 'dsh-tavern' } })

test('真实 DSH Session 只保存一个背景事件，恢复与 Surface 压缩均不丢失', () => {
  let session = Session.create('prefix-test')
  const prefix = ensureSessionStablePrefix(session, text)
  const first = session.append('user/message', user('第一轮'), { surfaceOp: 'append' })
  const second = session.append('user/message', user('第二轮'), { surfaceOp: 'append' })
  assert.equal(ensureSessionStablePrefix(session, '后来改卡不重新注入'), prefix)
  session.append('user/message', plugin('剧情摘要'), { surfaceOp: { op: 'replace', start: first.seq, end: second.seq }, sourceEventSeqs: [first.seq, second.seq] })
  session = Session.create(session.id, session.events, session.header)
  assert.equal(ensureSessionStablePrefix(session, '重启不重新注入').text, text)
  assert.equal(session.events.filter(event => event.type === 'dsh-tavern/stable-prefix').length, 1)
  assert.equal(session.events[0].type, 'dsh-tavern/stable-prefix')
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
