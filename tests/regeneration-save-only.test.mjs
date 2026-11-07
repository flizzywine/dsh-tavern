// 消息面上没有这一轮的正文时，重新生成不再拒绝：认轮只看存档，落位改成补写。
// 典型来源：一次被截断的重新生成，正文进了存档但没能落到模型视野，随后被清理摘掉。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { applyRegenerationProjection, locateRegenerationSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { selectRegenerationTarget } from '../tavern-plugin/lib/domain/round-history.js'

after(() => { for (const session of Session.list ?? []) session.close?.() })

const model = { kind: 'model', provider: 'test', model: 'test' }
const message = (id, role, text, source = model) => ({ id, role, content: [{ type: 'text', text }], source })

function lostBody() {
  const session = Session.create('save-only')
  const put = (type, data, op = { surfaceOp: 'append' }) => appendSessionEvent(session, type, data, op || undefined)
  put('turn/start', { turn: 1 }, null)
  put('user/message', message('input-1', 'user', '推门', { kind: 'user' }))
  put('turn/end', { turn: 1, reason: { kind: 'completed' } }, null)
  // 存档里第 8 轮有正文（截断那次写进来的），消息面上这一轮没有 assistant。
  const chat = { messages: [
    { role: 'assistant', greeting: true, turn: 1, text: '开场' },
    { role: 'user', text: '继续' },
    { role: 'assistant', turn: 8, text: '被截断的正文' }
  ] }
  return { session, put, chat }
}

test('面上没有正文时按补写选目标，不再抛 NATIVE_TARGET_MISSING', () => {
  const { session } = lostBody()
  let evidence
  const selection = selectRegenerationTarget({ messages: lostBody().chat.messages }, session, value => { evidence = value })
  assert.equal(selection.saveOnly, true)
  assert.equal(selection.oldSeq, null)
  assert.equal(selection.oldTurn, 8)
  assert.equal(evidence.reason, 'save-only')
  // 补写用的来源自己给一份，旧正文不存在时也拿得到。
  assert.equal(selection.oldSource.kind, 'model')
})

test('补写只往面上加一条正文，重复补写不再复制', () => {
  const { session, put } = lostBody()
  const nodes = session.surface.nodes.length
  const projection = { kind: 'append-round', storyTurn: 8, inputSeq: 1, data: { turn: 8, step: 1,
    message: message('tavern-regen:save-only', 'assistant', '新正文', { ...model, tavernStoryTurn: 8 }) } }
  const anchor = applyRegenerationProjection(session, projection)
  assert.ok(anchor?.nativeAnchor)
  assert.equal(anchor.nativeAnchor.input, 1)
  assert.notEqual(anchor.nativeAnchor.input, anchor.nativeAnchor.reply)
  const inputEvent = sessionEvents(session).find(event => event.seq === anchor.nativeAnchor.input)
  const replyEvent = sessionEvents(session).find(event => event.seq === anchor.nativeAnchor.reply)
  assert.equal(inputEvent?.type, 'user/message')
  assert.equal(replyEvent?.type, 'assistant/message')
  assert.equal(session.surface.nodes.length, nodes + 1)
  const bodies = (() => { const events = sessionEvents(session); return session.surface.nodes.map(seq => events.find(event => event.seq === seq)).filter(event => event?.type === 'assistant/message') })()
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].data.message.content[0].text, '新正文')
  // 同上：这条正文现在能被当作第 8 轮找到，锚点指的就是它。
  const located = locateRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes, seq: anchor.nativeAnchor.reply, turn: 8 })
  assert.equal(located?.assistantSeq, anchor.nativeAnchor.reply)
  assert.equal(located?.turn, 8)
  // 重试（崩溃后再跑一次）不会再加一条。
  put('turn/end', { turn: 8, reason: { kind: 'completed' } }, null)
  applyRegenerationProjection(session, projection)
  assert.equal(session.surface.nodes.length, nodes + 1)
})

test('没有输入证据时只记 reply 锚，不把正文伪装成玩家输入', () => {
  const { session } = lostBody()
  const projection = { kind: 'append-round', storyTurn: 8, data: { turn: 8, step: 1,
    message: message('tavern-regen:reply-only', 'assistant', '新正文', { ...model, tavernStoryTurn: 8 }) } }
  const result = applyRegenerationProjection(session, projection)
  const anchor = result?.nativeAnchor
  assert.ok(anchor)
  assert.equal(anchor.input, undefined)
  const reply = sessionEvents(session).find(event => event.seq === anchor.reply)
  assert.equal(reply?.type, 'assistant/message')
  assert.equal(locateRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes,
    seq: anchor.reply, turn: 8 })?.assistantSeq, anchor.reply)
})

test('原生面上有未认领正文时报告冲突，不进入补写', () => {
  const session = Session.create('save-only-conflict')
  appendSessionEvent(session, 'assistant/message', { turn: 9, step: 1,
    message: message('other-body', 'assistant', '原生面的另一段正文') }, { surfaceOp: 'append' })
  const chat = { messages: [{ role: 'user', text: '输入' }, { role: 'assistant', turn: 4, text: '存档正文' }] }
  assert.throws(() => selectRegenerationTarget(chat, session), error => error?.code === 'NATIVE_TARGET_CONFLICT')
})

test('先前正文已被其他存档行认领时，目标正文缺失仍可补写', () => {
  const session = Session.create('save-only-previous-claimed')
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1,
    message: message('previous-body', 'assistant', '上一轮正文') }, { surfaceOp: 'append' })
  const chat = { messages: [
    { role: 'user', text: '上一轮输入' }, { role: 'assistant', turn: 2, text: '上一轮正文' },
    { role: 'user', text: '这一轮输入' }, { role: 'assistant', turn: 8, text: '缺失正文' }
  ] }
  const selection = selectRegenerationTarget(chat, session)
  assert.equal(selection.saveOnly, true)
  assert.equal(selection.oldTurn, 8)
})

test('0 号事件是合法的原生正文锚点', () => {
  const event = { seq: 0, type: 'assistant/message', data: { turn: 15, step: 1,
    message: message('zero-body', 'assistant', '正文') } }
  const found = locateRegenerationSurface({ seq: 0, turn: 8, events: [event], nodes: [0], texts: [] })
  assert.equal(found?.assistantSeq, 0)
  assert.equal(found?.turn, 8)
  const selection = selectRegenerationTarget({ messages: [{ role: 'assistant', turn: 8, text: '正文',
    nativeAnchor: { formatVersion: 4, turn: 15, input: 0, reply: 0 } }] }, { events: [event], surface: { nodes: [0] } })
  assert.equal(selection.saveOnly, false)
  assert.equal(selection.oldSeq, 0)
})
