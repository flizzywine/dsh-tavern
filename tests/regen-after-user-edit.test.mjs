// 先改最后一条玩家输入（正文编辑的用户行分支会替换原生 user 消息），再重新生成。
// 这是最容易让「原生 seq 变了」和「存档行没变」错位的动作：重新生成必须仍然只替换
// 那一轮的正文，玩家改过的输入原样留着，且不能多出一条合成输入。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

function harness() {
  let counter = 0
  const calls = [], revisions = new Map()
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + (++counter) })
  let chat = {
    id: 'chat', sessionId: 'session', mode: 'story', _storageRevision: 1,
    messages: [{ role: 'assistant', greeting: true, text: '开场', turn: 1 }, { role: 'user', text: '原输入' }, { role: 'assistant', turn: 2, text: '旧正文', sourceText: '旧正文', swipes: ['旧正文'], swipeId: 0 }],
    posture: '门外', scriptState: { cursor: 0 }, settleStatus: 'done'
  }
  revisions.set(1, structuredClone(chat))
  const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
  const events = [
    { seq: 0, type: 'user/message', data: { turn: 2, role: 'user', content: [{ type: 'text', text: '原输入' }] } },
    { seq: 1, type: 'assistant/message', data: { turn: 2, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text: '旧正文' }] } } }
  ]
  const session = {
    id: 'session', events, surface: { nodes: [0, 1] },
    append(type, data, options = {}) {
      const seq = events.length
      events.push({ seq, type, data, ...options })
      const nodes = session.surface.nodes
      if (options.surfaceOp?.op === 'replace') {
        const start = nodes.indexOf(options.surfaceOp.start), end = nodes.indexOf(options.surfaceOp.end)
        assert.ok(start >= 0 && end >= start, 'replace 的范围必须在表面上')
        nodes.splice(start, end - start + 1, seq)
      } else if (options.surfaceOp === 'append') nodes.push(seq)
      return seq
    }
  }
  const agent = {
    session, phase: { lastTurn: 2 },
    followup(message) { agent.input = message },
    async whenIdle() {
      const turn = ++agent.phase.lastTurn
      agent.input = agent.input || { content: [{ type: 'text', text: '' }] }
      session.append('turn/start', { turn })
      session.append('user/message', { ...agent.input, turn }, { surfaceOp: 'append' })
      const text = '新正文'
      session.append('assistant/message', { turn, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text }] } }, { surfaceOp: 'append' })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
  }
  const chats = {
    read: async () => structuredClone(chat), forSession: async () => structuredClone(chat),
    readCard: async () => ({ name: '角色' }),
    readRevision: async (_id, revision) => revisions.get(revision),
    write: async (value, metadata) => { calls.push(metadata.source); chat = structuredClone(value); return structuredClone(chat) },
    update: async (_id, mutate, metadata) => { calls.push(metadata.source); revisions.set(chat._storageRevision, structuredClone(chat)); chat = await mutate(structuredClone(chat)) ?? chat; chat._storageRevision += 1; return structuredClone(chat) }
  }
  const options = {
    chats,
    sessions: { get: () => agent },
    scripts: { read: async () => ({ chunks: ['一', '二'] }), continuity: { transition: () => ({ state: { cursor: 0 } }) }, dispatchEvent: async () => {} },
    prepareRegenerationFrame: async input => ({ userText: input.userText, frame: { kind: 'foreground', frameId: 'f', operationId: 'o', turn: input.turn, chatId: chat.id, contributions: [] } }),
    timeline,
    queueSettlement: async () => { calls.push('settlement') },
    present: async value => structuredClone(value)
  }
  return { create: () => createRoundHistory(options), options, calls, session, agent, get chat() { return chat } }
}

function editLastUserInput(h, text) {
  // body-editor 保存输入的做法：原位替换表面上的那条 user 消息（位置不变，seq 变新），并改存档行。
  const original = h.session.events.find(event => event.seq === 0)
  h.session.append('user/message', { ...original.data, content: [{ type: 'text', text }] },
    { surfaceOp: { op: 'replace', start: 0, end: 0 } })
  h.chat.messages[1] = { ...h.chat.messages[1], text }
}

test('改过最后一条输入后重新生成：只换正文，输入原样留着', async () => {
  const h = harness()
  editLastUserInput(h, '改过的输入')
  const result = await h.create().regenerate('', '', 'session')
  assert.equal(h.chat.messages.length, 3, '不能多出合成输入行')
  assert.equal(h.chat.messages[1].role, 'user')
  assert.equal(h.chat.messages[1].text, '改过的输入', '玩家改过的输入必须原样保留')
  assert.equal(h.chat.messages[2].text, '新正文')
  assert.equal(result.messages.length, 3)
  assert.equal(result.messages[1].text, '改过的输入')
})
