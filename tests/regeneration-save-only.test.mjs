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
  const projection = { kind: 'append-round', storyTurn: 8, data: { turn: 8, step: 1,
    message: message('tavern-regen:save-only', 'assistant', '新正文', { ...model, tavernStoryTurn: 8 }) } }
  const anchor = applyRegenerationProjection(session, projection)
  assert.ok(anchor?.nativeAnchor)
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
