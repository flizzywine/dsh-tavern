import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { roundAnchor, resolveSessionRoundAnchor } from '../tavern-plugin/lib/domain/round-anchor.js'
import { locateRollbackSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { synchronizeTemplateHistory } from '../tavern-plugin/lib/domain/template-history.js'

const input = (id, text, rpcId = id) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId } })
const reply = (id, turn, text = id) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'test', model: 'test' } } })
function round(session, turn, text) {
  appendSessionEvent(session, 'turn/start', { turn })
  const user = appendSessionEvent(session, 'user/message', input('in-' + turn, text), { surfaceOp: 'append' })
  const out = appendSessionEvent(session, 'assistant/message', reply('out-' + turn, turn), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  return { user, out, anchor: roundAnchor(turn, user, out) }
}

test('锚点不随改写变化：重新生成、编辑正文、回退之后都能找到这一轮现在的位置', () => {
  const session = Session.create('anchor')
  const first = round(session, 2, '第一轮')
  // Regenerate: the projection replaces the old reply and the attempt.
  appendSessionEvent(session, 'turn/start', { turn: 3 })
  const attempt = appendSessionEvent(session, 'user/message', { id: 'regen', role: 'user', content: [{ type: 'text', text: '第一轮' }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }, { surfaceOp: 'append' })
  const fresh = appendSessionEvent(session, 'assistant/message', reply('fresh', 3), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 3, reason: { kind: 'completed' } })
  const projection = replaceSessionSurface(session, 'assistant/message', reply('tavern-regen:x', 2, '新正文'), { start: first.out.seq, end: fresh.seq, sourceEventSeqs: [first.out.seq, attempt.seq, fresh.seq] })
  assert.deepEqual(resolveSessionRoundAnchor(session, first.anchor), { input: first.user.seq, reply: projection.seq })
  // Body edit replaces the reply again.
  const edited = replaceSessionSurface(session, 'assistant/message', reply('tavern-body-edit:x', 2, '手改'), { start: projection.seq, end: projection.seq, sourceEventSeqs: [projection.seq] })
  assert.equal(resolveSessionRoundAnchor(session, first.anchor).reply, edited.seq)
  // Rollback shadows the whole round with one empty node.
  const shadow = replaceSessionSurface(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'tomb', role: 'assistant', content: [], source: { kind: 'model', provider: 'test', model: 'test' } } }, { start: first.user.seq, end: edited.seq, sourceEventSeqs: [first.user.seq, edited.seq] })
  assert.deepEqual(resolveSessionRoundAnchor(session, first.anchor), { input: shadow.seq, reply: shadow.seq })
})

test('有锚点时回退直接从这一轮的输入开始，不受之后残留的用户消息干扰', () => {
  const session = Session.create('anchor-rollback')
  const first = round(session, 2, '第一轮')
  // A stray player-kind message that some interrupted step left on the surface.
  appendSessionEvent(session, 'user/message', input('stray', '残留'), { surfaceOp: 'append' })
  const evidence = { events: sessionEvents(session), nodes: session.surface.nodes }
  assert.equal(locateRollbackSurface(evidence), null, 'without the anchor the stray message is taken for the input')
  const target = locateRollbackSurface({ ...evidence, anchor: first.anchor })
  assert.equal(target.userSeq, first.user.seq)
  assert.equal(target.assistantSeq, first.out.seq)
})

test('模板同步按锚点定位输入，原生文字与存档都对不上时也能找到', async () => {
  const session = Session.create('anchor-template')
  const first = round(session, 2, '原生里的输入')
  const chat = { messages: [{ role: 'user', text: '模板改写后的输入', templateInputSource: '玩家当时打的字' }, { role: 'assistant', text: 'out-2', turn: 2, nativeAnchor: first.anchor }] }
  await synchronizeTemplateHistory(session, chat, async () => {})
  const node = sessionEvents(session).find(event => event.seq === session.surface.nodes[0])
  assert.match(node.data.id, /^tavern-template-edit:/)
  assert.equal(node.data.content[0].text, '模板改写后的输入')
})
