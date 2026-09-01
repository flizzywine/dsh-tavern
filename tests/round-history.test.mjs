import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

function harness({ checkpoint = false, mode = 'story' } = {}) {
  const calls = [], revisions = new Map()
  let counter = 0
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + (++counter) })
  let chat = { id: 'chat', sessionId: 'session', mode, _storageRevision: 1, messages: [{ role: 'assistant', greeting: true, text: '开场', turn: 1 }], posture: '门外', scriptState: { cursor: 0 }, settleStatus: 'done' }
  const pair = [{ role: 'user', text: '推门' }, { role: 'assistant', turn: 2, text: '旧正文', sourceText: '旧正文', swipes: ['旧正文'], swipeId: 0, variables: [{ hp: 8 }] }]
  if (checkpoint) {
    revisions.set(1, structuredClone(chat))
    const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 2, userText: '推门' } })
    chat = timeline.complete({ chat: begun.chat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success' }, apply(draft) { draft.messages.push(...pair); draft.posture = '门内' } }).chat
  } else chat.messages.push(...pair)
  const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
  const events = [
    { seq: 0, type: 'user/message', data: { turn: 2, role: 'user', content: [{ type: 'text', text: '推门' }] } },
    { seq: 1, type: 'assistant/message', data: { turn: 2, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text: '旧正文' }] } } }
  ]
  const session = { events, surface: { nodes: [0, 1] }, append(type, data, options = {}) {
    calls.push('surface:' + type)
    const seq = events.length
    events.push({ seq, type, data, ...options })
    const nodes = session.surface.nodes
    if (options.surfaceOp?.op === 'replace') {
      const start = nodes.indexOf(options.surfaceOp.start), end = nodes.indexOf(options.surfaceOp.end)
      assert.ok(start >= 0 && end >= start)
      nodes.splice(start, end - start + 1, seq)
    } else if (options.surfaceOp === 'append') nodes.push(seq)
    return seq
  } }
  let generation = 'success', beforeGenerate = () => {}
  const agent = { session, phase: { lastTurn: 2 }, followup(message) { calls.push('followup'); agent.input = message }, async whenIdle() {
    await beforeGenerate()
    if (generation === 'throw') throw new Error('fixture generation failed')
    const turn = ++agent.phase.lastTurn
    if (generation === 'missing') return
    const text = generation === 'empty' ? '' : '新正文' + turn
    const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn, userText: agent.input.content[0].text } })
    revisions.set(chat._storageRevision, structuredClone(chat))
    chat = timeline.complete({ chat: begun.chat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success' }, apply(draft) {
      draft.messages.push({ role: 'user', text: agent.input.content[0].text }, { role: 'assistant', turn, text, sourceText: text, variables: [{ hp: 7 }] })
    } }).chat
    session.append('user/message', { ...agent.input, turn }, { surfaceOp: 'append' })
    session.append('assistant/message', { turn, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text }] } }, { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  } }
  const chats = {
    read: async () => structuredClone(chat), forSession: async () => structuredClone(chat), readCard: async () => ({ name: '角色' }),
    readRevision: async (_id, revision) => { calls.push('readRevision'); return revisions.get(revision) },
    write: async (value, metadata) => { calls.push(metadata.source); chat = structuredClone(value); return structuredClone(chat) },
    update: async (_id, mutate, metadata) => { calls.push(metadata.source); chat = mutate(structuredClone(chat)); return structuredClone(chat) }
  }
  const options = { chats, sessions: { get: () => agent }, timeline, scripts: {
    read: async () => ({ chunks: ['一', '二'] }), continuity: { transition: () => { calls.push('script.restore'); return { state: { cursor: 0 } } } },
    dispatchEvent: async event => { calls.push(event.name) }
  }, queueSettlement: async () => { calls.push('settlement') }, present: async value => structuredClone(value) }
  return { create: () => createRoundHistory(options), calls, session, agent, timeline, get chat() { return chat },
    setGeneration(value) { generation = value }, beforeGenerate(fn) { beforeGenerate = fn }, revisions }
}

test('完整重生成保留玩家输入、旧 Swipe 与变量，提交后才排结算和替换原生消息', async () => {
  const h = harness({ checkpoint: true })
  const originalEvents = structuredClone(h.session.events)
  const result = await h.create().regenerate('', '写得短一些', 'session')
  assert.equal(result.messages[1].text, '推门')
  assert.equal(result.messages[2].turn, 2)
  assert.deepEqual(result.messages[2].swipes, ['旧正文', '新正文3'])
  assert.deepEqual(result.messages[2].variables, [{ hp: 8 }, { hp: 7 }])
  assert.deepEqual(result.suppressedDshTurns, [3])
  assert.equal(result.regenInProgress, undefined)
  assert.equal(result.settleStatus, 'pending')
  assert.match(h.agent.input.content[0].text, /原玩家输入：\n推门/)
  assert.match(h.agent.input.content[0].text, /写得短一些/)
  assert.ok(h.calls.indexOf('readRevision') < h.calls.indexOf('rollback.regen'))
  assert.ok(h.calls.indexOf('MESSAGE_SWIPED') < h.calls.indexOf('followup'))
  assert.ok(h.calls.indexOf('foreground.regen-commit') < h.calls.indexOf('settlement'))
  assert.ok(h.calls.lastIndexOf('surface:assistant/message') < h.calls.indexOf('settlement'))
  assert.ok(!h.calls.includes('MESSAGE_RECEIVED'), 'MVU stays owned by background settlement')
  assert.deepEqual(h.session.events.slice(0, 2), originalEvents, 'append-only event history')
  const replacement = h.session.events.at(-1)
  assert.equal(replacement.data.turn, 2)
  assert.equal(replacement.surfaceOp.op, 'replace')
  assert.equal(replacement.data.message.source.kind, 'model')
  assert.deepEqual(replacement.data.message.content, [{ type: 'text', text: '新正文3' }])
})

for (const mode of ['throw', 'missing', 'empty']) test('重生成 '+mode+' 恢复原剧情且不排后台结算', async () => {
  const h = harness()
  const original = structuredClone(h.chat.messages)
  h.setGeneration(mode)
  await assert.rejects(h.create().regenerate('chat', '', 'session'))
  assert.deepEqual(h.chat.messages, original)
  assert.equal(h.chat.regenInProgress, undefined)
  assert.ok(h.calls.includes('foreground.regen-abort'))
  assert.ok(!h.calls.includes('settlement'))
})

test('重新创建流程模块后连续重生成仍替换原轮次；回退恢复 checkpoint 并按顺序通知脚本', async () => {
  const h = harness({ checkpoint: true })
  await h.create().regenerate('chat', '', 'session')
  const result = await h.create().regenerate('chat', '', 'session')
  assert.deepEqual(result.messages[2].swipes, ['旧正文', '新正文3', '新正文4'])
  assert.equal(result.adopted.hiddenTurn, 2)
  const rolled = await h.create().rollback('session', 'chat')
  assert.deepEqual(rolled.messages.map(m => m.text), ['开场'])
  assert.equal(rolled.posture, '门外')
  assert.equal(rolled.rolledBack.removedUserText, '推门')
  assert.ok(h.calls.lastIndexOf('rollback') < h.calls.lastIndexOf('MESSAGE_DELETED'))
  assert.equal(h.session.events.at(-1).surfaceOp.op, 'replace')
})

test('旧剧本回退保留迁移恢复路径；非游玩模式拒绝回退', async () => {
  const h = harness({ mode: 'script' })
  await h.create().rollback('session', 'chat')
  assert.ok(h.calls.includes('script.restore'))
  assert.equal(h.chat.scriptState.cursor, 0)
  const card = harness({ mode: 'card' })
  await assert.rejects(card.create().rollback('session', 'chat'), /仅游玩模式/)
  assert.deepEqual(card.calls, [])
})
