import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

import { roundAnchor } from "../tavern-plugin/lib/domain/round-anchor.js"

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

test('模板同步按锚点定位输入，原生文字与存档都对不上时也能找到', async () => {
  const session = Session.create('anchor-template')
  const first = round(session, 2, '原生里的输入')
  const chat = { messages: [{ role: 'user', text: '模板改写后的输入', templateInputSource: '玩家当时打的字' }, { role: 'assistant', text: 'out-2', turn: 2, nativeAnchor: first.anchor }] }
  await synchronizeTemplateHistory(session, chat, async () => {})
  const node = sessionEvents(session).find(event => event.seq === session.surface.nodes[0])
  assert.match(node.data.id, /^tavern-template-edit:/)
  assert.equal(node.data.content[0].text, '模板改写后的输入')
})
