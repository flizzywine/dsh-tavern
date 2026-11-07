import { readFile, writeFile } from 'node:fs/promises'
import { clearFailedTurnSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'
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
import { readZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

function harness({ checkpoint = false, mode = 'story', journal = false } = {}) {
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
    if (journal) chat._storageRevision = 2
  } else chat.messages.push(...pair)
  const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
  const events = [
    { seq: 0, type: 'user/message', data: { turn: 2, role: 'user', content: [{ type: 'text', text: '推门' }] } },
    { seq: 1, type: 'assistant/message', data: { turn: 2, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text: '旧正文' }] } } }
  ]
  const session = { id: 'session', events, surface: { nodes: [0, 1] }, append(type, data, options = {}) {
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
    const requestId = String(agent.input.source?.rpcId || '')
    const savedUserIndex = requestId ? chat.messages.findLastIndex(message => message?.role === 'user' && message.source?.rpcId === requestId) : -1
    revisions.set(chat._storageRevision, structuredClone(chat))
    chat = timeline.complete({ chat: begun.chat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success' }, apply(draft) {
      const user = { role: 'user', text: agent.input.content[0].text, native: true, ...(requestId ? { source: { kind: 'user', rpcId: requestId } } : {}) }
      const assistant = { role: 'assistant', turn, text, sourceText: text, variables: [{ hp: 7 }] }
      if (savedUserIndex >= 0) {
        draft.messages[savedUserIndex] = { ...draft.messages[savedUserIndex], ...user }
        delete draft.messages[savedUserIndex].placeholder
        draft.messages.push(assistant)
      } else draft.messages.push(user, assistant)
    } }).chat
    session.append('user/message', { ...agent.input, turn }, { surfaceOp: 'append' })
    session.append('assistant/message', { turn, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text }] } }, { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  } }
  const chats = {
    read: async () => structuredClone(chat), forSession: async () => structuredClone(chat), readCard: async () => ({ name: '角色' }),
    readRevision: async (_id, revision) => { calls.push('readRevision'); return revisions.get(revision) },
    write: async (value, metadata) => { calls.push(metadata.source); chat = structuredClone(value); return structuredClone(chat) },
    update: async (_id, mutate, metadata) => { calls.push(metadata.source); const revision = chat._storageRevision; if (journal) revisions.set(revision, structuredClone(chat)); chat = await mutate(structuredClone(chat)) ?? chat; if (journal) chat._storageRevision = revision + 1; return structuredClone(chat) }
  }
  const options = { chats, sessions: { get: () => agent }, scripts: {
    read: async () => ({ chunks: ['一', '二'] }), continuity: { transition: () => { calls.push('script.restore'); return { state: { cursor: 0 } } } },
    dispatchEvent: async event => { calls.push(event.name) }
  }, prepareRegenerationFrame: async (input) => {
    calls.push('prepare-regeneration')
    const current = structuredClone(chat)
    return {
      userText: input.userText,
      frame: {
        kind: 'foreground', frameId: 'preview', operationId: 'preview', turn: input.turn, branchId: current.timeline?.branchId || null,
        chatId: chat.id, source: { postureAtPrepare: current.posture },
        userInput: { sourceText: input.userText, projectedText: input.userText },
        contributions: [{ slot: 'writingRules', text: '当前状态:' + current.posture, source: { stage: 'context-plan' } }]
      }
    }
  }, timeline, queueSettlement: async () => {
    calls.push('settlement')
    const settlement = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
    chat = timeline.complete({
      chat: settlement.chat,
      operationId: settlement.value.operationId,
      basedOn: settlement.value.basedOn,
      outcome: { status: settlementOutcome === 'failure' ? 'failure' : 'success' },
      apply(draft) { draft.settleStatus = 'done' }
    }).chat
    if (settlementOutcome === 'failure') {
      chat.settleStatus = 'failed'
      chat.settleError = '后台结算尚未完成'
    }
  }, present: async value => structuredClone(value) }
  return { create: () => createRoundHistory(options), options, calls, session, agent, timeline, get chat() { return chat },
    setGeneration(value) { generation = value }, setSettlement(value) { settlementOutcome = value }, beforeGenerate(fn) { beforeGenerate = fn }, revisions }
}

for (const stored of [true, false]) test('rollback after foreground Agent release, stored Session=' + stored, async () => {
  const h = harness({checkpoint:true,journal:true})
  h.chat._storageRevision=9
  h.revisions.set(9,structuredClone(h.chat))
  let resumed=0,disposed=0
  h.options.sessions.get=()=>undefined
  h.options.sessions.getSession=()=>stored?h.session:undefined
  h.options.sessions.resume=async()=>{resumed++;return {agent:h.agent,dispose:async()=>{disposed++}}}
  await h.create().rollback('session','chat',2)
  assert.equal(h.chat.messages.length,1)
  assert.equal(resumed,stored?0:1)
  assert.equal(disposed,resumed)
  assert.equal(h.calls.includes('followup'),false)
  await h.create().undoRollback('session','chat')
  assert.equal(h.chat.messages.length,3)
  assert.equal(resumed,stored?0:2)
  assert.equal(disposed,resumed)
})

test('failed foreground resume leaves rollback data intact and permits retry', async () => {
  const h=harness({checkpoint:true})
  const before=structuredClone(h.chat)
  h.options.sessions.get=()=>undefined
  h.options.sessions.resume=async()=>{throw Error('resume unavailable')}
  const history=h.create()
  await assert.rejects(history.rollback('session','chat',2),/resume unavailable/)
  assert.deepEqual(h.chat,before)
  h.options.sessions.getSession=()=>h.session
  await history.rollback('session','chat',2)
  assert.equal(h.chat.messages.length,1)
})

test('前面回合只剩 AI 正文时，重新生成后面的回合仍保留前面正文', async () => {
  for (const checkpoint of [false, true]) {
    const h = harness({ checkpoint })
    h.chat.messages.splice(1, 0, { role: 'assistant', turn: 90, text: '前面独立正文', sourceText: '前面独立正文' })
    await h.create().regenerate('chat', '', 'session')
    assert.ok(h.chat.messages.some(message => message.role === 'assistant' && message.text === '前面独立正文'), 'checkpoint=' + checkpoint)
    assert.match(h.chat.messages.at(-1).text, /新正文/)
  }
})

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

test('rollback refuses a checkpoint whose round has left the native Surface instead of removing a different round', async () => {
  const h=harness({checkpoint:true})
  h.session.events[1].data.turn=1
  const before=structuredClone(h.chat)
  await assert.rejects(h.create().rollback('session','chat'),/当前轮次已不在可回退的消息流中/)
  assert.deepEqual(h.chat,before)
  assert.equal(h.calls.length,0)
})

test('原生上下文丢了这一轮时回退被拒绝：不重写模型上下文，存档保持原样', async () => {
  const h=harness({checkpoint:true})
  h.session.events[1].data.turn=1 // The native surface shows another round.
  const before=structuredClone(h.chat)
  await assert.rejects(h.create().rollback('session','chat'), /不在可回退的消息流中|不在当前模型上下文中/)
  assert.equal(h.chat.messages.length,before.messages.length)
  assert.deepEqual(h.chat.messages,before.messages)
})

test('消息面上没有这一轮正文时改为补写，不再拒绝重新生成', async () => {
  const h=harness()
  // 这一轮正文的原生节点已经没了（截断后没落位、被清理）：没有旧正文可替换。
  h.session.surface.nodes=[0]
  const result=await h.create().regenerate('chat','','session')
  assert.equal(result.adopted.text,'新正文3')
  // 存档换了正文，玩家输入原样保留。
  const tail=h.chat.messages.at(-1)
  assert.equal(h.chat.messages.at(-2).role,'user')
  assert.equal(h.chat.messages.at(-2).text,'推门')
  assert.equal(lastAssistant().text,'新正文3')
  // 模型视野里补出一条正文，模型上下文不再缺这一轮。
  const appended=h.session.events.filter(event=>event.surfaceOp==='append' && event.type==='assistant/message').at(-1)
  assert.ok(appended)
  assert.equal(appended.data.message.content[0].text,'新正文3')
  assert.ok(h.session.surface.nodes.includes(appended.seq))
  function lastAssistant(){ return h.chat.messages.filter(message=>message?.role==='assistant' && message.greeting!==true).at(-1) }
  assert.ok(tail)
})

test('缺少玩家输入时按空输入重新生成，诊断记录 input-missing', async () => {
  const h = harness()
  h.chat.messages.splice(1, 1)
  const records = new Map()
  const store = createMvuDiagnosticStore({ updateJson: async (path, fn) => {records.set(path, fn(records.get(path)))}, readJson: async path => records.get(path) })
  h.options.diagnostics = store
  const result = await h.create().regenerate('chat', 'PRIVATE guidance', 'session')
  const logged = (await store.read('session')).records
  assert.equal(logged.length, 1)
  assert.equal(logged[0].stage, 'regeneration-target')
  assert.equal(logged[0].reason, 'selected')
  assert.equal(logged[0].selection.inputIndex, -1)
  assert.equal(logged[0].selection.assistantIndex, 1)
  assert.equal(logged[0].binding.overridden, false)
  assert.ok(result.messages.at(-1).text.startsWith('新正文'))
  // No player row to quote: the evidence must not carry story text.
  assert.doesNotMatch(JSON.stringify(logged), /PRIVATE guidance|正文|玩家/)
})

test('诊断持久化失败不阻止重新生成', async () => {
  const failed = harness()
  failed.options.diagnostics = {record:async()=>{throw new Error('disk failure')}}
  failed.chat.messages.splice(1,1)
  const partial = await failed.create().regenerate('chat','','session')
  assert.ok(partial.messages.at(-1).text.startsWith('新正文'))
  const ok = harness({checkpoint:true})
  ok.options.diagnostics = failed.options.diagnostics
  const result = await ok.create().regenerate('chat','','session')
  assert.ok(result.messages.at(-1).text.startsWith('新正文'))
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

for (const kind of ['body', 'settlement', 'candidate']) test(kind + ' 未完成任务不阻塞回退，旧结果失效', async () => {
  const h = harness({ checkpoint: true })
  await h.options.chats.update('chat', current => h.timeline.apply({ chat: current, intent: kind === 'body'
    ? { kind: 'body.begin', turn: 3, userText: '继续' } : { kind: 'agent.begin', role: kind } }).chat, { source: 'fixture' })
  const before = structuredClone(h.chat)
  const operation = Object.values(h.timeline.inspect({ chat: before }).operations).find(op => op.status === 'running')
  assert.equal((await h.create().rollback('session', 'chat')).messages.length, 1)
  const late = h.timeline.complete({ chat: h.chat, operationId: operation.id, basedOn: operation.basedOn, outcome: { status: 'success' }, apply() { throw new Error('迟到结果不应执行') } })
  assert.notEqual(late.value?.status, 'applied')
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
  const undoStore = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  Object.assign(h.options.chats, { read: undoStore.read, readRevision: undoStore.readRevision, write: undoStore.write, update: undoStore.update })
  await h.create().undoRollback('session', 'chat')
  assert.deepEqual((await undoStore.read('chat')).messages, original.messages)
})

test('完整重生成先独立替换唯一正文，再执行后台结算', async () => {
  const h = harness({ checkpoint: true })
  const originalEvents = structuredClone(h.session.events)
  const saves = {}
  const update = h.options.chats.update
  h.options.chats.update = async (id, mutate, metadata) => (saves[metadata.source] = await update(id, mutate, metadata))
  const before = structuredClone(h.chat)
  h.beforeGenerate(() => {
    assert.deepEqual(h.chat.messages, before.messages, '生成期间旧正文与全部后续消息保持原样')
    assert.deepEqual(h.chat.timeline, before.timeline, '生成期间不预先回滚 checkpoint')
    assert.equal(h.chat.regenInProgress, true)
    assert.equal(h.chat.regenRecovery.phase, 'prepared')
    // 页面靠这个标记在生成期间先撤掉被替换的旧正文，不需要回滚存档。
    assert.equal(h.chat.regenRecovery.temporaryReplacingTurn, 2)
  })
  const result = await h.create().regenerate('', '写得短一些', 'session')
  assert.deepEqual(saves['foreground.regen-begin'].messages, before.messages)
  assert.equal(saves['foreground.regen-commit'].messages[2].text, '新正文3')
  assert.equal(saves['foreground.regen-projected'].regenInProgress, undefined)
  assert.equal(result.messages[1].text, '推门')
  assert.equal(result.messages[2].turn, 2)
  assert.deepEqual(result.messages[2].swipes, ['新正文3'])
  assert.deepEqual(result.messages[2].variables, [{ hp: 7 }])
  assert.deepEqual(result.suppressedDshTurns, [3])
  assert.deepEqual(result.regeneratedDshTurns, { '2': 3 })
  assert.equal(result.regenInProgress, undefined)
  assert.equal(result.settleStatus, 'done')
  // 有意见时带上当前正文作为改写底稿。
  assert.match(h.agent.input.content[0].text, /^推门\n\n【当前正文】\n[\s\S]+\n\n【改写要求】/)
  assert.match(h.agent.input.content[0].text, /写得短一些/)
  assert.doesNotMatch(h.agent.input.content[0].text, /重新生成|原玩家输入/)
  assert.ok(!h.calls.includes('rollback.regen'))
  assert.ok(h.calls.indexOf('readRevision') < h.calls.indexOf('foreground.regen-begin'))
  assert.ok(!h.calls.includes('MESSAGE_SWIPED'))
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

test('已有正文候选提交只替换目标正文并保留全部后续消息', async () => {
  const h = harness({ checkpoint: true, journal: true })
  const later = { role: 'user', text: '后续输入', native: false, source: { kind: 'import' } }
  h.chat.messages[2].messageUid = 'body-2'
  h.chat.messages.push(later)
  const before = structuredClone(h.chat)
  h.beforeGenerate(() => {
    assert.deepEqual(h.chat.messages, before.messages)
    assert.deepEqual(h.chat.timeline, before.timeline)
  })
  const result = await h.create().regenerate('chat', '', 'session')
  assert.deepEqual(result.messages.map(message => message.text), ['开场', '推门', '新正文3', '后续输入'])
  assert.deepEqual(result.messages[3], later)
  assert.equal(result.messages[2].turn, 2)
  assert.equal(result.messages[2].messageUid, before.messages[2].messageUid)
  assert.ok(!h.calls.includes('rollback.regen'))
})

test('重生成的后台结算失败时保留新正文并允许继续', async () => {
  const h = harness({ checkpoint: true })
  h.setSettlement('failure')
  const result = await h.create().regenerate('chat', '', 'session')
  assert.equal(h.chat.messages.at(-1).text, '新正文3')
  assert.equal(result.messages.at(-1).text, '新正文3')
  assert.equal(h.chat.regenInProgress, undefined)
  assert.deepEqual(h.chat.suppressedDshTurns, [3])
  assert.equal(h.chat.settleStatus, 'failed')
  assert.equal(h.chat.settleError, '后台结算尚未完成')
  assert.ok(!h.calls.includes('foreground.regen-abort'))
  assert.equal(h.session.events.at(-1).surfaceOp.op, 'replace')
  assert.doesNotThrow(() => h.timeline.apply({ chat: h.chat, intent: { kind: 'body.begin', turn: 4, userText: '继续' } }))
})

for (const thrown of [false, true]) test('重生成保留真实结算错误但不恢复旧正文：throw=' + thrown, async () => {
  const h = harness({ checkpoint: true })
  const cause = new Error('Tavern Chat 已被另一项操作修改，拒绝覆盖冲突字段：messages')
  cause.code = 'DSH_TAVERN_CHAT_CONFLICT'
  h.options.queueSettlement = async () => {
    if (thrown) throw cause
    h.chat.settleStatus = 'failed'
    h.chat.settleError = cause.message
  }
  const result = await h.create().regenerate('chat', '', 'session')
  assert.equal(result.messages.at(-1).text, '新正文3')
  assert.equal(h.chat.messages.at(-1).text, '新正文3')
  assert.equal(h.chat.settleStatus, 'failed')
  assert.match(h.chat.settleError, /冲突字段：messages/)
  assert.ok(!h.calls.includes('foreground.regen-abort'))
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
  // Revision-backed checkpoints require the same monotonic revisions as the real journal.
  const h = harness({ checkpoint: true, journal: true })
  await h.create().regenerate('chat', '', 'session')
  const result = await h.create().regenerate('chat', '', 'session')
  assert.deepEqual(result.messages[2].swipes, ['新正文4'])
  assert.deepEqual(result.suppressedDshTurns, [3, 4])
  assert.deepEqual(result.regeneratedDshTurns, { '2': 4 })
  assert.equal(result.adopted.hiddenTurn, 2)
  const rolled = await h.create().rollback('session', 'chat')
  assert.deepEqual(rolled.messages.map(m => m.text), ['开场'])
  assert.equal(rolled.posture, '门外')
  assert.equal(rolled.rolledBack.removedUserText, '推门')
  assert.deepEqual(rolled.suppressedDshTurns, [2, 3, 4])
  assert.deepEqual(rolled.regeneratedDshTurns, {})
  assert.ok(h.calls.lastIndexOf('rollback') < h.calls.lastIndexOf('MESSAGE_DELETED'))
  // The rollback's empty replacement is the last surface edit, and the turn it
  // opened for itself is closed again so the log stays loadable.
  const lastEdit = h.session.events.filter(event => event.surfaceOp?.op === 'replace').at(-1)
  assert.deepEqual(lastEdit.data.message.content, [])
  assert.deepEqual(h.session.events.slice(-2).map(event => event.type), ['step/end', 'turn/end'])
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

test('回退提交后立即保存模型消息面，早于后台回拨和脚本通知', async () => {
  const h = harness({ checkpoint: true })
  h.options.sessions.flush = async session => h.calls.push(session === h.session ? 'foreground.flush' : 'other.flush')
  await h.create().rollback('session')
  const surface = h.calls.indexOf('surface:assistant/message'), flush = h.calls.indexOf('foreground.flush')
  // A rollback runs between turns, so the replacement opens a turn for itself:
  // the flush still follows the edit immediately, only the closing events sit in
  // between. Nothing else may be persisted before it.
  assert.ok(surface >= 0 && surface < flush, h.calls.join(','))
  assert.ok(h.calls.slice(surface + 1, flush).every(call => call === 'surface:step/end' || call === 'surface:turn/end'), h.calls.join(','))
  assert.ok(flush < h.calls.indexOf('MESSAGE_DELETED'))
})

test('rollback immediately rewinds and flushes background surface, failure only warns', async () => {
  for (const [fail, unloaded] of [[false, false], [true, false], [false, true]]) {
    const h = harness({ checkpoint: true })
    const participant = { role: 'background', lifetime: 'chat', sessionId: 'bg', boundary: 0, status: 'current', branchId: h.chat.timeline.branchId }
    h.chat.timeline.checkpoints[0].participants = { background: participant }
    h.chat.timeline.participants.background = participant
    const source = { kind: 'model', provider: 'fixture', model: 'fixture' }
    const bg = { events: [{ seq: 0, type: 'turn/end' }, { seq: 1, type: 'assistant/message', data: { turn: 2, message: { source, content: [] } } }], surface: { nodes: [1] }, append(type, data, options) {
      if (fail) throw new Error('background unavailable')
      const seq = this.events.length
      this.events.push({ seq, type, data, ...(options || {}) })
      // The rewind opens a turn for its replacement; only the replacement itself
      // is the background history edit this test cares about.
      if (options?.surfaceOp?.op !== 'replace') return seq
      h.calls.push('background.rewind')
      assert.equal(options.surfaceOp.start, 1)
      this.surface.nodes = []
      return seq
    } }
    const worker = { session: bg, cancel() {}, async whenIdle() {} }
    h.options.sessions = { get: id => id === 'bg' ? (unloaded ? undefined : worker) : h.agent,
      resume: async id => { assert.equal(id, 'bg'); h.calls.push('background.resume'); return { agent: worker, dispose: async () => h.calls.push('background.dispose') } },
      flush: async () => h.calls.push('background.flush') }
    const result = await h.create().rollback('session')
    assert.equal(result.messages.length, 1)
    if (fail) assert.match(result.rollbackWarning, /background unavailable/)
    else {
      assert.ok(h.calls.includes('background.rewind'))
      assert.ok(h.calls.includes('background.flush'))
      if (unloaded) {
        assert.ok(h.calls.includes('background.resume'))
        assert.ok(h.calls.indexOf('background.dispose') > h.calls.indexOf('background.flush'))
      }
      assert.ok(h.calls.indexOf('surface:assistant/message') < h.calls.indexOf('background.rewind'))
    }
  }
})

for (const count of [1, 3]) test(`回退先清除 ${count} 次中断，保留已完成剧情和后台状态`, async () => {
  const h = harness({ checkpoint: true })
  const before = structuredClone(h.chat)
  for (let turn = 3; turn < 3 + count; turn++) {
    h.session.append('turn/start', { turn })
    h.session.append('user/message', { role: 'user', content: [{ type: 'text', text: '新的输入' }] }, { surfaceOp: 'append' })
    h.session.append('assistant/message', { turn, step: 1, interrupted: true, message: { role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: '半截正文' }] } }, { surfaceOp: 'append' })
    h.session.append('turn/end', { turn, reason: { kind: 'aborted' } })
    clearFailedTurnSurface({ session: h.session, turn })
  }
  const surfaceBefore = [...h.session.surface.nodes]
  await h.create().rollback('session', 'chat')
  assert.deepEqual(h.chat.messages, before.messages)
  assert.deepEqual(h.chat.timeline, before.timeline)
  assert.deepEqual(h.chat.posture, before.posture)
  assert.deepEqual(h.session.surface.nodes, surfaceBefore)
  assert.deepEqual(h.chat.suppressedDshTurns, Array.from({ length: count }, (_, i) => i + 3))
  // A new workflow instance reads persisted suppression and can roll back the
  // previous completed turn on the user's next explicit action.
  await h.create().rollback('session', 'chat')
  assert.equal(h.chat.messages.length, 1)
})

for (const first of [true, false]) test(`请求 HTTP 500 且没有正文时仅清除失败轮次（首次=${first}）`, async () => {
  const h = harness()
  if (first) {
    h.chat.messages.splice(1)
    h.session.events.length = 0
    h.session.surface.nodes.length = 0
  }
  const before = structuredClone(h.chat)
  const turn = first ? 2 : 3
  h.session.append('turn/start', { turn })
  h.session.append('user/message', { role: 'user', content: [{ type: 'text', text: '输入' }] }, { surfaceOp: 'append' })
  h.session.append('turn/end', { turn, reason: { kind: 'error', message: 'HTTP 500' } })
  clearFailedTurnSurface({ session: h.session, turn })
  const result = await h.create().rollback('session', 'chat')
  assert.deepEqual(result.clearedIncompleteTurns, [turn])
  assert.deepEqual(h.chat.messages, before.messages)
  assert.deepEqual(h.chat.timeline, before.timeline)
})

for (const absent of [false, true]) {
  for (const action of ['rollback', 'regenerate', 'failed-regenerate']) test(`剧情恢复聊天变量与元数据：${action}，历史缺省=${absent}`, async () => {
    const h = harness({ checkpoint: true, journal: true })
    const fields = ['variables', 'tavernPluginMetadata', 'tavernHelperScriptVariables']
    const before = { variables: { gold: 10 }, tavernPluginMetadata: { quest: 'start' }, tavernHelperScriptVariables: { script: { count: 1 } } }
    const future = { variables: { gold: 0 }, tavernPluginMetadata: { quest: 'finished' }, tavernHelperScriptVariables: { script: { count: 2 } } }
    if (!absent) Object.assign(h.revisions.get(1), structuredClone(before))
    Object.assign(h.chat, structuredClone(future), { backgroundModel: 'current-model' })
    // Browser notifications cannot repair authoritative state while offline.
    delete h.options.scripts.dispatchEvent
    const assertRestored = () => {
      for (const field of fields) {
        assert.deepEqual(h.chat[field], absent ? undefined : before[field], field)
        assert.equal(Object.hasOwn(h.chat, field), !absent, field + ' presence')
      }
      assert.equal(h.chat.backgroundModel, 'current-model')
    }
    const history = h.create()
    if (action === 'rollback') {
      await history.rollback('session', 'chat')
      assertRestored()
      await history.undoRollback('session', 'chat')
      for (const field of fields) assert.deepEqual(h.chat[field], future[field])
    } else {
      const generationBefore = structuredClone(h.chat)
      h.beforeGenerate(() => {
        assert.deepEqual(h.chat.messages, generationBefore.messages)
        assert.deepEqual(h.chat.timeline, generationBefore.timeline)
        for (const field of fields) assert.deepEqual(h.chat[field], future[field], field + ' generation')
      })
      if (action === 'failed-regenerate') {
        h.setGeneration('throw')
        await assert.rejects(history.regenerate('chat', '', 'session'), /fixture generation failed/)
        assert.deepEqual(h.chat.messages, generationBefore.messages)
        assert.deepEqual(h.chat.timeline, generationBefore.timeline)
        for (const field of fields) assert.deepEqual(h.chat[field], future[field])
      } else {
        await history.regenerate('chat', '', 'session')
        assertRestored()
      }
    }
  })
}

test('误回退后撤销恢复正文、变量和 checkpoint，并保留原生日志', async () => {
  const h = harness({ checkpoint: true, journal: true })
  h.chat._storageRevision = 9
  h.revisions.set(9, structuredClone(h.chat))
  const before = structuredClone(h.chat), originalEvents = structuredClone(h.session.events)
  const history = h.create()
  await history.rollback('session', 'chat')
  assert.equal(h.chat.messages.length, 1)
  await history.undoRollback('session', 'chat')
  assert.deepEqual(h.chat.messages, before.messages)
  assert.equal(h.chat.posture, before.posture)
  assert.equal(h.chat.timeline.checkpoints.length, before.timeline.checkpoints.length)
  assert.ok(h.chat.timeline.revision > before.timeline.revision)
  assert.deepEqual(h.session.events.slice(0, originalEvents.length), originalEvents)
  assert.deepEqual(h.session.surface.nodes.map(seq => h.session.events[seq].data.message?.content || h.session.events[seq].data.content),
    originalEvents.map(event => event.data.message?.content || event.data.content))
  await assert.rejects(history.undoRollback('session', 'chat'), /没有|失效/)
})

for (const mutation of ['empty-generation', 'edit']) test(`新操作使撤销恢复点失效：${mutation}`, async () => {
  const h = harness({ checkpoint: true, journal: true })
  const history = h.create()
  await history.rollback('session', 'chat')
  if (mutation === 'empty-generation') h.session.append('turn/start', { turn: 3 })
  else h.chat._storageRevision++
  const before = structuredClone(h.chat), nodes = [...h.session.surface.nodes]
  await assert.rejects(history.undoRollback('session', 'chat'), /失效/)
  assert.deepEqual(h.chat, before)
  assert.deepEqual(h.session.surface.nodes, nodes)
})

test('撤销保存失败时恢复回退后的模型上下文，不覆盖正文', async () => {
  const h = harness({ checkpoint: true, journal: true })
  await h.create().rollback('session', 'chat')
  const before = structuredClone(h.chat)
  const update = h.options.chats.update
  h.options.chats.update = (...args) => {
    if (args[2].source === 'rollback.undo') throw new Error('撤销保存失败')
    return update(...args)
  }
  await assert.rejects(h.create().undoRollback('session', 'chat'), /撤销保存失败/)
  assert.deepEqual(h.chat, before)
  assert.equal(h.session.surface.nodes.length, 1)
  assert.deepEqual(h.session.events[h.session.surface.nodes[0]].data.message.content, [])
})

for (const reason of ['error', 'aborted']) test(`连续未清理的${reason}尾部仅清理失败轮，存储失败后可以重试`, async () => {
  const h = harness({ checkpoint: true })
  for (const turn of [3, 4]) {
    h.session.append('turn/start', { turn })
    h.session.append('user/message', { role: 'user', content: [{ type: 'text', text: '失败输入' }] }, { surfaceOp: 'append' })
    h.session.append('assistant/message', { turn, step: 1, message: { role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'text', text: '半截正文' }] } }, { surfaceOp: 'append' })
    h.session.append('turn/end', { turn, reason: { kind: reason } })
  }
  const before = structuredClone(h.chat)
  const update = h.options.chats.update
  h.options.chats.update = async () => { throw new Error('保存失败') }
  await assert.rejects(h.create().rollback('session', 'chat'), /保存失败/)
  assert.deepEqual(h.chat, before)
  h.options.chats.update = update
  const result = await h.create().rollback('session', 'chat')
  assert.deepEqual(result.clearedIncompleteTurns, [3, 4])
  assert.deepEqual(h.chat.messages, before.messages)
  assert.deepEqual(h.chat.timeline, before.timeline)
  await h.create().rollback('session', 'chat')
  assert.equal(h.chat.messages.length, 1)
})

for (const mutation of ['resume', 'turn/start', 'surface']) test(`撤销回退校验后台恢复后的真实变化：${mutation}`, async () => {
  const h = harness({ checkpoint: true, journal: true })
  const bg = harness().session
  const participant = { role: 'background', lifetime: 'chat', sessionId: 'bg', boundary: 0, status: 'current', branchId: h.chat.timeline.branchId }
  h.chat.timeline.checkpoints[0].participants = { background: participant }
  h.chat.timeline.participants.background = participant
  const worker = { session: bg, phase: { kind: 'idle' }, async whenIdle() {} }
  h.options.sessions = {
    get: id => id === 'bg' ? undefined : h.agent,
    resume: async () => {
      bg.append('session/end-seed', {})
      return { agent: worker, dispose: async () => {} }
    },
    flush: async () => {}
  }
  const before = structuredClone(h.chat.messages)
  const history = h.create()
  await history.rollback('session', 'chat')
  if (mutation === 'turn/start') bg.append('turn/start', { turn: 3 })
  if (mutation === 'surface') bg.append('session/end-seed', {}, { surfaceOp: 'append' })
  if (mutation === 'resume') {
    await history.undoRollback('session', 'chat')
    assert.deepEqual(h.chat.messages, before)
    assert.ok(bg.surface.nodes.some(seq => bg.events[seq].data.message?.content?.[0]?.text === '旧正文'))
  } else {
    const rolledBack = structuredClone(h.chat.messages)
    await assert.rejects(history.undoRollback('session', 'chat'), /后台上下文已有变化/)
    assert.deepEqual(h.chat.messages, rolledBack)
  }
})

for (const legacy of [false, true]) test('中断重生成后重建模块恢复原正文与状态：legacy=' + legacy, async () => {
  const h = harness({ checkpoint: true, journal: true })
  const before = structuredClone(h.chat)
  let entered
  const started = new Promise(resolve => { entered = resolve })
  h.beforeGenerate(async () => { entered(); await new Promise(() => {}) })
  void h.create().regenerate('chat', '', 'session')
  await started
  assert.equal(h.chat.regenInProgress, true)
  assert.deepEqual(h.chat.messages, before.messages, '中断前旧正文与输入从未离开存档')
  assert.deepEqual(h.chat.timeline, before.timeline, '中断前没有预回滚 checkpoint')
  assert.equal(h.chat.posture, before.posture)
  if (legacy) delete h.chat.regenRecovery
  h.session.append('user/message', { turn: 3, content: [{ type: 'text', text: '推门' }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }, { surfaceOp: 'append' })
  h.session.append('assistant/message', { turn: 3, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '未完成正文' }] } }, { surfaceOp: 'append' })
  h.session.append('turn/end', { turn: 3, reason: { kind: 'interrupted' } })
  const restarted = h.create()
  await restarted.recover('chat')
  assert.deepEqual(h.chat.messages, before.messages)
  assert.equal(h.chat.posture, before.posture)
  assert.ok(!h.chat.regenInProgress)
  assert.equal(h.chat.regenRecovery, undefined)
  assert.deepEqual(h.chat.suppressedDshTurns, [3])
  assert.ok(h.session.surface.nodes.includes(1))
  assert.ok(!h.session.surface.nodes.includes(2))
  const recovered = structuredClone(h.chat)
  await restarted.recover('chat')
  assert.deepEqual(h.chat, recovered)
  h.beforeGenerate(() => {})
  const result = await restarted.regenerate('chat', '', 'session')
  assert.match(result.messages.at(-1).text, /新正文/)
})

test('取消旧结算抛错也恢复原正文并解除重生成锁', async () => {
  const h = harness({ checkpoint: true, journal: true })
  const body = Object.values(h.chat.timeline.operations).find(operation => operation.kind === 'body')
  body.status = 'completed'
  body.background = { phase: 'pending', role: 'settlement' }
  const original = structuredClone(h.chat.messages)
  h.options.cancelSettlement = async () => { throw new Error('cancel failed') }
  await assert.rejects(h.create().regenerate('chat', '', 'session'), /cancel failed/)
  assert.deepEqual(h.chat.messages, original)
  assert.ok(!h.chat.regenInProgress)
  assert.equal(h.chat.regenRecovery, undefined)
})

test('新正文提交失败恢复原状态且不留下重生成锁', async () => {
  const h = harness({ checkpoint: true, journal: true })
  const original = structuredClone(h.chat.messages), update = h.options.chats.update
  h.options.chats.update = async (id, mutate, metadata) => {
    if (metadata.source === 'foreground.regen-commit') throw new Error('commit failed')
    return update(id, mutate, metadata)
  }
  await assert.rejects(h.create().regenerate('chat', '', 'session'), /commit failed/)
  assert.deepEqual(h.chat.messages, original)
  assert.ok(!h.chat.regenInProgress)
  assert.equal(h.chat.regenRecovery, undefined)
  assert.deepEqual(h.chat.suppressedDshTurns, [3])
})

async function interruptedRegeneration() {
  const h = harness({ checkpoint: true, journal: true })
  let entered
  const started = new Promise(resolve => { entered = resolve })
  h.beforeGenerate(async () => { entered(); await new Promise(() => {}) })
  const live = h.create()
  void live.regenerate('chat', '', 'session')
  await started
  return { h, live }
}

test('恢复不打断当前进程中的重生成或宿主仍在运行的回合', async () => {
  const { h, live } = await interruptedRegeneration()
  const before = structuredClone(h.chat)
  await live.recover('chat')
  await assert.rejects(live.regenerate('chat', '', 'session'), /正在重新生成/)
  assert.deepEqual(h.chat, before)
  h.agent.phase.kind = 'running'
  await h.create().recover('chat')
  assert.deepEqual(h.chat, before)
})

// The save is the truth: no native failure may leave the marker that locks the save.
test('恢复时消息面保存失败也按存档恢复原正文，模型上下文标记待修复', async () => {
  const { h } = await interruptedRegeneration()
  const original = structuredClone(h.revisions.get(h.chat.regenRecovery.beforeRevision).messages)
  let disposed = 0
  h.options.sessions = {
    get: () => undefined,
    resume: async () => ({ agent: h.agent, dispose: async () => { disposed++ } }),
    flush: async () => { throw new Error('flush failed') }
  }
  await h.create().recover('chat')
  assert.deepEqual(h.chat.messages, original)
  assert.ok(!h.chat.regenInProgress && !h.chat.regenRecovery)
  assert.equal(h.chat.nativeSync.status, 'stale')
  assert.equal(disposed, 1)
})

test('候选恢复不需要历史回滚点，只清原生尝试与标记', async () => {
  const { h } = await interruptedRegeneration()
  const before = structuredClone(h.chat)
  h.options.chats.readRevision = async () => undefined
  await h.create().recover('chat')
  assert.deepEqual(h.chat.messages, before.messages)
  assert.deepEqual(h.chat.timeline, before.timeline)
  assert.ok(!h.chat.regenInProgress && !h.chat.regenRecovery)
  assert.equal(h.chat.nativeSync, undefined)
})

test('另一进程留下的重新生成标志不会挡住回退', async () => {
  const { h } = await interruptedRegeneration()
  const original = structuredClone(h.revisions.get(h.chat.regenRecovery.beforeRevision).messages)
  const view = await h.create().rollback('session', 'chat')
  assert.ok(view.rolledBack)
  assert.ok(!h.chat.regenInProgress)
  assert.equal(h.chat.messages.length, original.length - 2)
})

test('尾部待回复输入由重新生成补出它的正文，不重放上一轮', async () => {
  const h = harness()
  h.chat.messages.push({ role: 'user', text: '最新输入', sourceText: '最新输入', native: true })
  h.chat.foregroundError = null
  h.session.append('turn/start', { turn: 3 })
  h.session.append('user/message', { role: 'user', content: [{ type: 'text', text: '倒数第二个输入' }],
    source: { kind: 'user', rpcId: 'rpc-previous' } }, { surfaceOp: 'append' })
  h.session.append('turn/end', { turn: 3, reason: { kind: 'error', message: 'HTTP 500' } })
  h.agent.phase.lastTurn = 3

  await h.create().regenerate('chat', '', 'session')

  // The request is the unanswered input itself: the round before it is finished
  // story and stays byte-identical, never replayed in its place.
  assert.equal(h.agent.input.content[0].text, '最新输入')
  assert.equal(h.agent.input.source.kind, 'plugin:dsh-tavern-regen')
  assert.deepEqual(h.chat.messages.map(message => [message.role, message.text]), [
    ['assistant', '开场'], ['user', '推门'], ['assistant', '旧正文'],
    ['user', '最新输入'], ['assistant', '新正文4']
  ])
  assert.equal(h.chat.messages[2].text, '旧正文')
  assert.equal(h.chat.messages.at(-1).turn, 3)
  // The reply already lives in the native log: the round only records its anchors.
  assert.ok(h.chat.messages.at(-1).nativeAnchor)
  assert.equal(h.chat.messages.at(-1).nativeAnchor.turn, 4)
  assert.deepEqual(h.chat.regeneratedDshTurns, { '3': 4 })
  assert.ok(!h.calls.includes('rollback.regen'))
})

test('末尾玩家行没有 native 标记时同样是待回复的尾，按它生成正文', async () => {
  const h = harness({ checkpoint: true })
  // A turn that failed before landing its body may never be stamped native.
  h.chat.messages.push({ role: 'user', text: '最新输入', sourceText: '最新输入' })
  h.agent.phase.lastTurn = 3

  await h.create().regenerate('chat', '', 'session')

  assert.equal(h.agent.input.content[0].text, '最新输入')
  assert.equal(h.chat.messages.at(-1).role, 'assistant')
  assert.equal(h.chat.messages.at(-2).text, '最新输入')
  assert.equal(h.chat.messages[2].text, '旧正文')
})

test('尾部待回复输入生成失败时保持原样，不吞掉输入也不改指上一轮', async () => {
  const h = harness({ checkpoint: true, journal: true })
  h.chat.messages.push({ role: 'user', text: '最新输入', sourceText: '最新输入', native: true })
  h.agent.phase.lastTurn = 3
  h.setGeneration('throw')
  const before = structuredClone(h.chat)
  await assert.rejects(h.create().regenerate('chat', '', 'session'), /fixture generation failed/)
  assert.deepEqual(h.chat.messages, before.messages)
  assert.equal(h.chat.messages.at(-1).text, '最新输入')
  assert.ok(!h.chat.regenInProgress && !h.chat.regenRecovery)
})

test('重新生成使用当前状态和当前预设材料，不复用旧正文的冻结帧', async () => {
  const h = harness()
  h.chat.posture = '当前修改后的状态'
  h.chat.foregroundFrames = {
    'old-body': { kind: 'foreground', operationId: 'old-body', turn: 2,
      contributions: [{ slot: 'writingRules', text: '冻结材料', source: { stage: 'old-frame' } }], source: {} }
  }

  await h.create().regenerate('chat', '', 'session')

  const body = Object.values(h.chat.timeline.operations).filter(operation => operation.kind === 'body').at(-1)
  const frame = h.chat.foregroundFrames[body.id]
  assert.match(JSON.stringify(frame), /当前状态:当前修改后的状态/)
  assert.doesNotMatch(JSON.stringify(frame), /冻结材料/)
})

test('session 重生成入口读取完整故事，不需要页面传正文 ID', async () => {
  const h = harness()
  h.chat.messages.push({ role: 'user', text: '最新输入', sourceText: '最新输入', native: true,
    source: { kind: 'user', rpcId: 'rpc-latest' } })
  h.chat.foregroundError = null
  let headerReads = 0, fullReads = 0
  h.options.chats.stateForSession = async () => {
    headerReads++
    return { id: 'chat', sessionId: 'session', messages: [] }
  }
  const full = h.options.chats.forSession
  h.options.chats.forSession = async (...args) => { fullReads++; return full(...args) }

  await h.create().regenerate(undefined, '', 'session')

  assert.equal(headerReads, 0)
  assert.ok(fullReads > 0)
  assert.equal(h.calls.filter(call => call === 'followup').length, 1)
  assert.equal(h.agent.input.content[0].text, '最新输入')
  assert.equal(h.chat.messages.at(-1).role, 'assistant')
  assert.equal(h.chat.messages.at(-1).text, '新正文3')
})

test('重新生成始终选最新已提交正文，调用方附带的旧正文 ID 不改变目标', async () => {
  const h = harness()
  h.session.events[1].data.message.id = 'body-first'
  h.chat.messages.push({ role: 'user', text: '第二次输入' },
    { role: 'assistant', turn: 3, text: '第二旧正文', sourceText: '第二旧正文' })
  h.session.append('user/message', { turn: 3, role: 'user', content: [{ type: 'text', text: '第二次输入' }] }, { surfaceOp: 'append' })
  h.session.append('assistant/message', { turn: 3, step: 1, message: { id: 'body-second', role: 'assistant', source: h.session.events[1].data.message.source,
    content: [{ type: 'text', text: '第二旧正文' }] } }, { surfaceOp: 'append' })
  h.agent.phase.lastTurn = 3

  await h.create().regenerate('chat', '', 'session', 'body-first')

  assert.equal(h.agent.input.content[0].text, '第二次输入')
  assert.equal(h.chat.messages[2].text, '旧正文')
  assert.equal(h.chat.messages.at(-2).text, '第二次输入')
  assert.equal(h.chat.messages.at(-1).role, 'assistant')
  assert.notEqual(h.chat.messages.at(-1).text, '第二旧正文')
})

test('native replacement failure after Chat commit keeps the new body and never rewrites the tail',async()=>{
 const h=harness({checkpoint:true,journal:true});const append=h.session.append
 h.session.append=function(type,data,intent){if(type==='assistant/message' && intent?.surfaceOp?.op==='replace')throw Error('disk/projection failure');return append.call(this,type,data,intent)}
 const view=await h.create().regenerate('chat','','session')
 h.session.append=append
 assert.ok(view.adopted)
 assert.equal(h.chat.messages.at(-1).text,view.adopted.text)
 assert.ok(!h.chat.regenInProgress && !h.chat.regenRecovery)
 assert.equal(h.chat.nativeSync.status,'stale')
})

test('failed regeneration must preserve a Guide saved while model is running',async()=>{
 const h=harness({checkpoint:true,journal:true});h.setGeneration('throw')
 h.beforeGenerate(async()=>{await h.options.chats.update('chat',c=>({...c,guides:[{id:'guide-new',text:'newly saved guide',createdAt:1}]}),{source:'guide.add'})})
 await assert.rejects(h.create().regenerate('chat','','session'),/fixture generation failed/)
 assert.deepEqual(h.chat.guides,[{id:'guide-new',text:'newly saved guide',createdAt:1}])
})

test('ordinary active generation must reject regeneration before rolling back Chat',async()=>{
 const h=harness({checkpoint:true,journal:true});h.agent.phase.kind='running'
 await assert.rejects(h.create().regenerate('chat','','session'),/正在|生成|busy|running/)
 assert.ok(!h.calls.includes('rollback.regen'))
})

test('rollback cannot cancel and consume an active regeneration',async()=>{
 const {h,live}=await interruptedRegeneration()
 const before=structuredClone(h.chat)
 await assert.rejects(live.rollback('session','chat'),/重新生成/)
 assert.deepEqual(h.chat,before)
})

test('rescued history blocks regeneration and rollback without modifying old text', async()=>{
 const h=harness()
 h.chat.importHistory={operationId:'rescue-1234',rescue:{sourceChatId:'broken'}}
 h.chat.messages.at(-1).importSource={operationId:'rescue-1234'}
 const before=structuredClone(h.chat)
 await assert.rejects(h.create().regenerate('chat','','session'),/救援/)
 await assert.rejects(h.create().rollback('session','chat'),/救援/)
 assert.deepEqual(h.chat,before)
})

// the stage's 停止 while the reply is written stops the run and withdraws the pick, exactly
// the failed-tail clearing of 撤回这条输入; a body that already committed is a Round and stays.
test('舞台打断：停止生成并撤回未提交的输入，剧情、checkpoint 与上一轮候选不变', async () => {
  const h = harness({ checkpoint: true })
  h.chat.candidates = { messageId: 'm2', choices: [{ type: 'action', text: '走进雨里' }] }
  const before = structuredClone(h.chat)
  h.session.append('turn/start', { turn: 3 })
  h.session.append('user/message', { role: 'user', content: [{ type: 'text', text: '走进雨里' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  h.session.append('assistant/message', { turn: 3, step: 1, message: { role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: '雨下得' }] } }, { surfaceOp: 'append' })
  const stops = []
  h.agent.phase = { kind: 'running', lastTurn: 2 }
  h.agent.cancel = reason => { stops.push(reason.kind); h.session.append('turn/end', { turn: 3, reason: { kind: 'aborted' } }); h.agent.phase = { lastTurn: 2 } }
  h.agent.whenIdle = async () => {}
  const result = await h.create().interrupt('session', 'chat')
  assert.deepEqual(stops, ['user'])
  assert.equal(result.withdrawn, true)
  assert.equal(result.clearedInput, '走进雨里')
  assert.deepEqual(h.chat.messages, before.messages)
  assert.deepEqual(h.chat.timeline, before.timeline)
  assert.deepEqual(h.chat.candidates, before.candidates)
  assert.deepEqual(h.chat.suppressedDshTurns, [3])
  const visible = h.session.surface.nodes.map(seq => h.session.events[seq]).filter(event => event.type === 'assistant/message').map(event => event.data.message.content[0]?.text)
  assert.deepEqual(visible, ['旧正文'], 'the partial body leaves the model-visible surface')
})

test('舞台打断：正文已提交时不回退该轮', async () => {
  const h = harness({ checkpoint: true })
  const before = structuredClone(h.chat)
  const result = await h.create().interrupt('session', 'chat')
  assert.equal(result.withdrawn, false)
  assert.deepEqual(h.chat.messages, before.messages)
  assert.deepEqual(h.chat.timeline, before.timeline)
  assert.equal(h.chat.rollbackUndo, undefined)
})

// the 重新生成 dialog's 停止 is the same interrupt; during a
// regeneration it only stops the run, and the regeneration restores the original round.
test('重新生成中打断：只停前台运行，正文保持原样、不撤回输入', async () => {
  const h = harness({ checkpoint: true, journal: true })
  const before = structuredClone(h.chat)
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  h.beforeGenerate(async () => { h.agent.phase.kind = 'running'; entered(); await new Promise(resolve => { release = resolve }) })
  const stops = []
  h.agent.cancel = reason => { stops.push(reason.kind); h.setGeneration('missing'); delete h.agent.phase.kind; release() }
  const generate = h.agent.whenIdle
  let run
  h.agent.whenIdle = () => run ??= generate()
  const live = h.create()
  const regeneration = live.regenerate('chat', '写得更短', 'session')
  await started
  const result = await live.interrupt('session', 'chat')
  assert.deepEqual(stops, ['user'])
  assert.equal(result.withdrawn, false)
  await assert.rejects(regeneration, /已停止.*正文保持原样/)
  assert.deepEqual(h.chat.messages, before.messages)
  assert.ok(!h.chat.regenInProgress)
  assert.equal(h.chat.regenRecovery, undefined)
  assert.equal(h.chat.rollbackUndo, undefined)
})
