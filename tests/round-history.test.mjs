import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

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
    const settlement = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
    chat = timeline.complete({ chat: settlement.chat, operationId: settlement.value.operationId, basedOn: settlement.value.basedOn, outcome: { status: 'success' } }).chat
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
  let generation = 'success', settlementOutcome = 'success', beforeGenerate = () => {}
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
  }, queueSettlement: async () => {
    calls.push('settlement')
    const settlement = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
    chat = timeline.complete({
      chat: settlement.chat,
      operationId: settlement.value.operationId,
      basedOn: settlement.value.basedOn,
      outcome: { status: settlementOutcome === 'failure' ? 'failure' : 'success' },
      apply(draft) { draft.settleStatus = 'done' }
    }).chat
  }, present: async value => structuredClone(value) }
  return { create: () => createRoundHistory(options), options, calls, session, agent, timeline, get chat() { return chat },
    setGeneration(value) { generation = value }, setSettlement(value) { settlementOutcome = value }, beforeGenerate(fn) { beforeGenerate = fn }, revisions }
}

test('rc.1 snapshot-only history supports regeneration and rollback without rewriting native events', async () => {
  for (const operation of ['regenerate', 'rollback']) {
    const h = harness({ checkpoint: true })
    const events = h.session.events
    const before = structuredClone(events)
    delete h.session.events
    h.session.snapshotEvents = () => Object.freeze(events.slice())
    const history = h.create()
    const result = operation === 'regenerate'
      ? await history.regenerate('chat', '', 'session')
      : await history.rollback('session', 'chat')
    if (operation === 'regenerate') assert.match(result.messages.at(-1).text, /新正文/)
    else assert.deepEqual(result.messages.map(item => item.text), ['开场'])
    assert.deepEqual(events.slice(0, before.length), before)
    assert.ok(events.length > before.length)
  }
})

test('配对失败的证据写入现有诊断包，原错误与聊天、原生历史保持不变', async () => {
  const h = harness()
  h.chat.messages.splice(1, 1)
  const records = new Map()
  const store = createMvuDiagnosticStore({ updateJson: async (path, fn) => {records.set(path, fn(records.get(path)))}, readJson: async path => records.get(path) })
  h.options.diagnostics = store
  const before = structuredClone(h.chat), session = structuredClone(h.session.events)
  await assert.rejects(h.create().regenerate('chat', 'PRIVATE guidance', 'session'), /没有可重新生成的玩家输入与正文组合/)
  const logged = (await store.read('session')).records
  assert.equal(logged.length, 1)
  assert.equal(logged[0].stage, 'regeneration-target')
  assert.equal(logged[0].reason, 'previous-message-not-user')
  assert.equal(logged[0].binding.overridden, false)
  assert.equal(logged[0].selection.assistantIndex, 1)
  assert.doesNotMatch(JSON.stringify(logged), /PRIVATE guidance|旧正文|推门|开场/)
  assert.deepEqual(h.chat, before)
  assert.deepEqual(h.session.events, session)
  assert.deepEqual(h.calls, [])
  const exported = await createMvuDiagnosticExport({sessionId:'session', store})
  assert.ok(exported.buffer.includes(Buffer.from('regeneration-target')))
  assert.ok(exported.buffer.includes(Buffer.from('previous-message-not-user')))
})

test('诊断持久化失败不替换原配对错误，也不阻止正常重新生成', async () => {
  const failed = harness()
  failed.options.diagnostics = {record:async()=>{throw new Error('disk failure')}}
  failed.chat.messages.splice(1,1)
  await assert.rejects(failed.create().regenerate('chat','','session'), /没有可重新生成的玩家输入与正文组合/)
  assert.deepEqual(failed.calls, [])
  const ok = harness({checkpoint:true})
  ok.options.diagnostics = failed.options.diagnostics
  const result = await ok.create().regenerate('chat','','session')
  assert.ok(result.messages.at(-1).text.startsWith('新正文'))
})

test('生成中误点回退不写入，完成后再次点击能正常回退', async () => {
  const h = harness({ checkpoint: true }), history = h.create()
  const before = structuredClone(h.chat), surface = [...h.session.surface.nodes]
  h.agent.phase.kind = 'running'
  await assert.rejects(history.rollback('session', 'chat'), /生成|未完成/)
  assert.deepEqual(h.chat, before)
  assert.deepEqual(h.session.surface.nodes, surface)
  assert.deepEqual(h.calls, [])
  h.agent.phase.kind = 'idle'
  const result = await history.rollback('session', 'chat')
  assert.deepEqual(result.messages.map(item => item.text), ['开场'])
})

test('模型消息面拒绝回退时恢复原剧情，重试仍能回退', async () => {
  const h = harness({ checkpoint: true }), history = h.create()
  const before = structuredClone(h.chat), surface = [...h.session.surface.nodes]
  const append = h.session.append
  h.session.append = () => { throw new Error('本次回复未完成') }
  await assert.rejects(history.rollback('session', 'chat'), /本次回复未完成/)
  assert.deepEqual(h.chat.messages, before.messages)
  assert.equal(h.chat.posture, before.posture)
  assert.deepEqual(h.chat.suppressedDshTurns, before.suppressedDshTurns)
  assert.deepEqual(h.session.surface.nodes, surface)
  assert.ok(!h.calls.includes('MESSAGE_DELETED'))
  assert.ok(h.chat.timeline.revision > before.timeline.revision)
  h.session.append = append
  assert.deepEqual((await history.rollback('session', 'chat')).messages.map(item => item.text), ['开场'])
})

test('回退提交后脚本通知失败不会伪装成回退失败', async () => {
  const h = harness({ checkpoint: true })
  h.options.scripts.dispatchEvent = async () => { throw new Error('脚本处理失败') }
  const result = await h.create().rollback('session', 'chat')
  assert.deepEqual(result.messages.map(item => item.text), ['开场'])
  assert.match(result.rollbackWarning, /脚本处理失败/)
  assert.equal(h.session.events.at(-1).surfaceOp.op, 'replace')
})

test('读取 checkpoint 期间重新开始生成时，提交前再次拒绝回退', async () => {
  const h = harness({ checkpoint: true }), before = structuredClone(h.chat)
  const read = h.options.chats.readRevision
  h.options.chats.readRevision = async (...args) => { const result = await read(...args); h.agent.phase.kind = 'running'; return result }
  await assert.rejects(h.create().rollback('session', 'chat'), /生成|未完成/)
  assert.deepEqual(h.chat, before)
  assert.ok(!h.calls.includes('rollback'))
})

for (const kind of ['body', 'settlement', 'candidate']) test(kind + ' 时间线任务未完成时不依赖前台运行标记也能拦截', async () => {
  const h = harness({ checkpoint: true })
  await h.options.chats.update('chat', current => h.timeline.apply({ chat: current, intent: kind === 'body'
    ? { kind: 'body.begin', turn: 3, userText: '继续' } : { kind: 'agent.begin', role: kind } }).chat, { source: 'fixture' })
  const before = structuredClone(h.chat)
  await assert.rejects(h.create().rollback('session', 'chat'), /未完成/)
  assert.deepEqual(h.chat, before)
  assert.deepEqual(h.session.surface.nodes, [0, 1])
})

test('读取 checkpoint 时聊天变化不会被旧回退覆盖', async () => {
  const h = harness({ checkpoint: true })
  const read = h.options.chats.readRevision
  h.options.chats.readRevision = async (...args) => {
    const result = await read(...args)
    await h.options.chats.update('chat', current => ({ ...current, posture: '新的状态' }), { source: 'fixture' })
    return result
  }
  await assert.rejects(h.create().rollback('session', 'chat'), /其他操作修改/)
  assert.equal(h.chat.posture, '新的状态')
  assert.equal(h.chat.messages.length, 3)
  assert.deepEqual(h.session.surface.nodes, [0, 1])
})

test('存储拒绝回退时不修改消息面，并释放回退锁', async () => {
  const h = harness({ checkpoint: true }), before = structuredClone(h.chat)
  const update = h.options.chats.update
  let fail = true
  h.options.chats.update = async (...args) => { if (fail) throw new Error('存储失败'); return update(...args) }
  const history = h.create()
  await assert.rejects(history.rollback('session', 'chat'), /存储失败/)
  assert.deepEqual(h.chat, before)
  assert.deepEqual(h.session.surface.nodes, [0, 1])
  fail = false
  assert.equal((await history.rollback('session', 'chat')).messages.length, 1)
})

test('重复回退请求只执行一次', async () => {
  const h = harness({ checkpoint: true })
  let release, entered
  const blocked = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  h.options.chats.readCard = async () => { entered(); await blocked; return {} }
  const history = h.create(), first = history.rollback('session', 'chat')
  await started
  await assert.rejects(history.rollback('session', 'chat'), /正在回退/)
  release()
  await first
  assert.equal(h.calls.filter(call => call === 'rollback').length, 1)
  assert.equal(h.calls.filter(call => call === 'surface:assistant/message').length, 1)
})

test('补偿期间出现并发修改时拒绝覆盖，并明确报告恢复失败', async () => {
  const h = harness({ checkpoint: true })
  const update = h.options.chats.update
  h.options.chats.update = async (id, mutate, metadata) => {
    if (metadata.source === 'rollback.abort') await update(id, current => ({ ...current, posture: '并发变更' }), { source: 'fixture' })
    return update(id, mutate, metadata)
  }
  h.session.append = () => { throw new Error('消息面拒绝') }
  await assert.rejects(h.create().rollback('session', 'chat'), /回退失败且剧情恢复未完成.*消息面拒绝.*其他操作修改/)
  assert.equal(h.chat.posture, '并发变更')
  assert.ok(!h.calls.includes('MESSAGE_DELETED'))
})

test('真实 journal 持久化：消息面失败后 checkpoint 可恢复、重建服务后可重试', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-rollback-regression-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const h = harness({ checkpoint: true })
  await persistence.write({ ...h.revisions.get(1), _storageRevision: 0 }, { source: 'fixture.before' })
  const original = await persistence.write(structuredClone(h.chat), { source: 'fixture.after' })
  Object.assign(h.options.chats, {
    read: persistence.read, forSession: () => persistence.read('chat'), readRevision: persistence.readRevision,
    write: persistence.write, update: persistence.update
  })
  const append = h.session.append
  h.session.append = () => { throw new Error('本次回复未完成') }
  await assert.rejects(h.create().rollback('session', 'chat'), /本次回复未完成/)
  const restored = await persistence.read('chat')
  assert.deepEqual(restored.messages, original.messages)
  assert.deepEqual(restored.timeline.checkpoints, original.timeline.checkpoints)
  assert.ok(restored._storageRevision > original._storageRevision)
  assert.ok(restored.timeline.revision > original.timeline.revision)
  h.session.append = append
  const reopened = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  Object.assign(h.options.chats, { read: reopened.read, readRevision: reopened.readRevision, write: reopened.write, update: reopened.update })
  assert.equal((await h.create().rollback('session', 'chat')).messages.length, 1)
  assert.equal((await reopened.read('chat')).messages.length, 1)
})

test('完整重生成保留玩家输入，只在结算成功后原子替换唯一正文', async () => {
  const h = harness({ checkpoint: true })
  const originalEvents = structuredClone(h.session.events)
  const result = await h.create().regenerate('', '写得短一些', 'session')
  assert.equal(result.messages[1].text, '推门')
  assert.equal(result.messages[2].turn, 2)
  assert.deepEqual(result.messages[2].swipes, ['新正文3'])
  assert.deepEqual(result.messages[2].variables, [{ hp: 7 }])
  assert.deepEqual(result.suppressedDshTurns, [3])
  assert.equal(result.regenInProgress, undefined)
  assert.equal(result.settleStatus, 'done')
  assert.match(h.agent.input.content[0].text, /原玩家输入：\n推门/)
  assert.match(h.agent.input.content[0].text, /写得短一些/)
  assert.ok(h.calls.indexOf('readRevision') < h.calls.indexOf('rollback.regen'))
  assert.ok(!h.calls.includes('MESSAGE_SWIPED'))
  assert.ok(h.calls.indexOf('foreground.regen-commit') < h.calls.indexOf('settlement'))
  assert.ok(h.calls.lastIndexOf('surface:assistant/message') > h.calls.indexOf('settlement'))
  assert.ok(!h.calls.includes('MESSAGE_RECEIVED'), 'MVU stays owned by background settlement')
  assert.deepEqual(h.session.events.slice(0, 2), originalEvents, 'append-only event history')
  const replacement = h.session.events.at(-1)
  assert.equal(replacement.data.turn, 2)
  assert.equal(replacement.surfaceOp.op, 'replace')
  assert.equal(replacement.data.message.source.kind, 'model')
  assert.deepEqual(replacement.data.message.content, [{ type: 'text', text: '新正文3' }])
})

test('当前正文尚在后台结算时，重新生成先取消旧结算再替换正文', async () => {
  const h = harness({ checkpoint: true })
  const body = Object.values(h.chat.timeline.operations).find(operation => operation.kind === 'body')
  body.status = 'foreground-completed'
  body.background = { phase: 'pending', role: 'settlement', updatedAt: 1 }
  h.chat.settleStatus = 'pending'
  const running = h.timeline.apply({ chat: h.chat, intent: { kind: 'agent.begin', role: 'settlement' } })
  Object.assign(h.chat, running.chat)
  h.options.cancelSettlement = async chatId => { h.calls.push('cancel-settlement:' + chatId) }

  const result = await h.create().regenerate('chat', '', 'session')

  assert.ok(result.messages.at(-1).text.startsWith('新正文'))
  assert.ok(h.calls.indexOf('rollback.regen') < h.calls.indexOf('cancel-settlement:chat'))
  assert.ok(h.calls.indexOf('cancel-settlement:chat') < h.calls.indexOf('followup'))
})

test('重生成的后台结算失败时恢复旧整轮，并清理临时模型消息', async () => {
  const h = harness({ checkpoint: true })
  const original = structuredClone(h.chat.messages)
  h.setSettlement('failure')
  await assert.rejects(h.create().regenerate('chat', '', 'session'), /已恢复原正文和状态.*后台结算尚未完成/)
  assert.deepEqual(h.chat.messages, original)
  assert.equal(h.chat.regenInProgress, undefined)
  assert.ok(h.calls.includes('foreground.regen-abort'))
  assert.deepEqual(h.session.surface.nodes, [0, 1, h.session.events.length - 1])
  const cleanup = h.session.events.at(-1)
  assert.equal(cleanup.data.source.plugin, 'dsh-tavern-regeneration-abort')
  assert.deepEqual(cleanup.data.content, [])
  assert.deepEqual(cleanup.sourceEventSeqs, [2, 3])
})

for (const thrown of [false, true]) test('重生成保留真实结算错误并明确恢复旧整轮：throw=' + thrown, async () => {
  const h = harness({ checkpoint: true })
  const original = structuredClone(h.chat.messages)
  const cause = new Error('Tavern Chat 已被另一项操作修改，拒绝覆盖冲突字段：messages')
  cause.code = 'DSH_TAVERN_CHAT_CONFLICT'
  h.options.queueSettlement = async () => {
    if (thrown) throw cause
    h.chat.settleStatus = 'failed'
    h.chat.settleError = cause.message
  }
  await assert.rejects(h.create().regenerate('chat', '', 'session'), error => {
    assert.match(error.message, /已恢复原正文和状态/)
    assert.match(error.message, /冲突字段：messages/)
    assert.doesNotMatch(error.message, /请先重试结算/)
    if (thrown) { assert.equal(error.cause, cause); assert.equal(error.code, cause.code) }
    return true
  })
  assert.deepEqual(h.chat.messages, original)
  assert.equal(h.chat.settleStatus, 'done')
  assert.ok(h.calls.includes('foreground.regen-abort'))
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
  assert.deepEqual(result.messages[2].swipes, ['新正文4'])
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
