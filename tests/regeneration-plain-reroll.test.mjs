// 直接点「重新生成」、指导为空时，请求必须是一次干净的重采样：
// 不能把上一版正文塞进请求再要求模型「以它为准重写」。
// 宏渲染过的回合 projectionText 天然不等于 sourceText，那不是玩家编辑的证据；
// 只有 bodyEdit 标记（正文编辑/精修落盘时写入）才说明玩家手里是被改过的版本。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

function harness(rows) {
  let counter = 0
  const calls = [], revisions = new Map(), prepared = []
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + (++counter) })
  let chat = {
    id: 'chat', sessionId: 'session', mode: 'story', _storageRevision: 1,
    messages: rows, posture: '门外', scriptState: { cursor: 0 }, settleStatus: 'done'
  }
  revisions.set(1, structuredClone(chat))
  const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
  const events = [
    { seq: 0, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text: '开场' }] } } },
    { seq: 1, type: 'user/message', data: { turn: 2, role: 'user', content: [{ type: 'text', text: '原输入' }] } },
    { seq: 2, type: 'assistant/message', data: { turn: 2, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text: '旧正文' }] } } }
  ]
  const session = {
    id: 'session', events, surface: { nodes: [0, 1, 2] },
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
      session.append('assistant/message', { turn, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text: '新正文' }] } }, { surfaceOp: 'append' })
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
    prepareRegenerationFrame: async input => { prepared.push(input); return { userText: input.userText, frame: { kind: 'foreground', frameId: 'f', operationId: 'o', turn: input.turn, chatId: chat.id, contributions: [] } } },
    timeline,
    queueSettlement: async () => { calls.push('settlement') },
    present: async value => structuredClone(value)
  }
  return { create: () => createRoundHistory(options), options, calls, session, agent, prepared, get chat() { return chat } }
}

function rows(assistant) {
  return [
    { role: 'assistant', greeting: true, text: '开场', turn: 1 },
    { role: 'user', text: '原输入' },
    { role: 'assistant', turn: 2, text: '她笑了。', ...assistant }
  ]
}

test('宏渲染过的普通回合：指导为空重新生成不带旧正文，是干净的重采样', async () => {
  const h = harness(rows({ sourceText: '她笑了。{{setvar::mood::开心}}', projectionText: '她笑了。', swipes: ['她笑了。'], swipeId: 0 }))
  await h.create().regenerate('', '', 'session')
  assert.equal(h.prepared.length, 1)
  assert.equal(h.prepared[0].userText, '原输入', '没有指导、没有编辑时，请求里只该有玩家输入')
  assert.equal(h.prepared[0].userText.includes('current_body'), false, '请求里不该出现旧正文段落')
  assert.equal(h.prepared[0].userText.includes('rewrite_request'), false, '请求里不该出现「以它为准重写」')
  assert.equal(h.chat.messages[2].text, '新正文')
})

test('玩家编辑过的正文（bodyEdit 标记）：没有指导也要随请求带上，不能丢改动', async () => {
  const h = harness(rows({ sourceText: '她轻声笑了。', projectionText: '她轻声笑了。', text: '她轻声笑了。', swipes: ['她轻声笑了。'], swipeId: 0,
    bodyEdit: { formatVersion: 4, id: 'tavern-body-edit:fixture', seq: 2, turn: 2 } }))
  await h.create().regenerate('', '', 'session')
  assert.equal(h.prepared.length, 1)
  const sent = h.prepared[0].userText
  assert.ok(sent.startsWith('原输入'), '玩家输入仍在最前面')
  assert.ok(sent.includes('<current_body>\n她轻声笑了。\n</current_body>'), '编辑过的正文必须随请求送出')
  assert.ok(sent.includes('<rewrite_request>'), '编辑过的正文要带改写说明')
  assert.equal(h.chat.messages[2].text, '新正文')
})
