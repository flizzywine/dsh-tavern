import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createBoundedHistory, readRowsAt } from '../tavern-plugin/lib/domain/bounded-history.js'
import { isScopedMessages } from '../tavern-plugin/lib/domain/scoped-messages.js'
import { createConversationPageStore } from '../tavern-plugin/lib/domain/conversation-page-store.js'
import { createConversationState } from '../tavern-plugin/lib/domain/conversation-state.js'

const model = { kind: 'model', provider: 'fixture', model: 'fixture' }

// A long native save whose latest round was committed and settled through the real
// timeline: settlement also edited an older floor and the chat variables, which a
// rollback must restore exactly as the checkpoint revision held them.
async function fixture(t, bounded, { earlyInput = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rollback-bounded-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  let counter = 0
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + (++counter), now: () => 1000 })
  const messages = [{ role: 'assistant', greeting: true, text: '开场', turn: 1 }]
  for (let turn = 2; turn <= 80; turn++) messages.push({ role: 'user', text: '行动' + turn }, { role: 'assistant', turn, text: '正文' + turn, sourceText: '正文' + turn, swipes: ['正文' + turn], swipeId: 0, variables: [{ hp: turn }] })
  let chat = timeline.apply({ chat: { id: 'chat', sessionId: 'session', mode: 'story', backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
    posture: '门外', settleStatus: 'done', variables: { day: 1 }, nativeCommits: {}, messages }, intent: { kind: 'ensure' } }).chat
  chat = await p.write(chat, { source: 'create' })
  const source = { kind: 'user', rpcId: 'input-81' }
  if (earlyInput) {
    chat = await p.update('chat', current => {
      current.messages.push({ role: 'user', text: '推门 ZZ3', placeholder: true, source })
      return current
    }, { source: 'player.input' })
  }
  const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 81, userText: '推门' } })
  chat = await p.write(begun.chat, { source: 'foreground.prepare' })
  chat = await p.write(timeline.complete({ chat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success' }, apply(draft) {
    if (earlyInput) draft.messages[draft.messages.length - 1] = { role: 'user', text: '推门 〔3〕', source }
    else draft.messages.push({ role: 'user', text: '推门' })
    draft.messages.push({ role: 'assistant', turn: 81, text: '新正文', sourceText: '新正文', swipes: ['新正文'], swipeId: 0, variables: [{ hp: 81 }] })
    draft.posture = '门内'
    draft.nativeCommits['81'] = { turn: 81, userText: '推门' }
  } }).chat, { source: 'foreground.commit' })
  const settlement = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
  chat = await p.write(settlement.chat, { source: 'background.settlement.begin' })
  chat = await p.write(timeline.complete({ chat, operationId: settlement.value.operationId, basedOn: settlement.value.basedOn, outcome: { status: 'success' }, apply(draft) {
    draft.messages.at(-1).variables[0].hp = 82
    draft.messages[120].tavernPluginData = { template_display: { html: '改写' } }
    draft.variables.day = 2
  } }).chat, { source: 'background.settlement.commit' })

  const events = [
    { seq: 0, type: 'user/message', data: { turn: 81, role: 'user', content: [{ type: 'text', text: '推门' }] } },
    { seq: 1, type: 'assistant/message', data: { turn: 81, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text: '新正文' }] } } }
  ]
  const session = { id: 'session', events, surface: { nodes: [0, 1] }, append(type, data, options = {}) {
    const seq = events.length
    events.push({ seq, type, data, ...options })
    if (options.surfaceOp?.op === 'replace') {
      const nodes = session.surface.nodes, start = nodes.indexOf(options.surfaceOp.start), end = nodes.indexOf(options.surfaceOp.end)
      nodes.splice(start, end - start + 1, seq)
    } else if (options.surfaceOp === 'append') session.surface.nodes.push(seq)
    return seq
  } }
  // A foreground turn as the real orchestrator stores it: begin, append the round, commit.
  const agent = { session, phase: { kind: 'idle', lastTurn: 81 }, followup(message) { agent.input = message }, async whenIdle() {
    if (!agent.input) return
    if (hooks.failGeneration) { agent.input = null; throw new Error('fixture generation failed') }
    // A turn the provider failed mid-reply: the text streamed, but the host only
    // kept the raw attempt (no assistant/message) and never committed the round.
    if (hooks.partialGeneration !== undefined) {
      const turn = ++agent.phase.lastTurn, userText = agent.input.content[0].text
      agent.input = null
      session.append('user/message', { turn, role: 'user', content: [{ type: 'text', text: userText }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }, { surfaceOp: 'append' })
      session.append('assistant/attempt', { turn, step: 1, stream: [
        { type: 'chunk', chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { type: 'text-chunks', index: 0, dt: [120, 90], texts: [hooks.partialGeneration.slice(0, 2), hooks.partialGeneration.slice(2)] },
        { type: 'chunk', chunk: { type: 'block-end', index: 0, block: { type: 'text', text: hooks.partialGeneration } } },
        { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'Provider finish_reason: error', code: 'PI_AI_ERROR' } } } }
      ] })
      session.append('turn/end', { turn, reason: { kind: 'error', error: { message: 'Provider finish_reason: error', code: 'PI_AI_ERROR' } } })
      throw new Error('fixture generation failed')
    }
    const turn = ++agent.phase.lastTurn, userText = agent.input.content[0].text, text = '重写正文' + turn
    agent.input = null
    let current = await p.read('chat')
    const begun = timeline.apply({ chat: current, intent: { kind: 'body.begin', turn, userText } })
    current = await p.write(begun.chat, { source: 'foreground.prepare' })
    await p.write(timeline.complete({ chat: current, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success' }, apply(draft) {
      draft.messages.push({ role: 'user', text: userText }, { role: 'assistant', turn, text, sourceText: text, swipes: [text], swipeId: 0, variables: [{ hp: 90 }] })
      draft.nativeCommits[String(turn)] = { turn, userText }
    } }).chat, { source: 'foreground.commit' })
    session.append('user/message', { turn, role: 'user', content: [{ type: 'text', text: userText }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }, { surfaceOp: 'append' })
    session.append('assistant/message', { turn, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text }] } }, { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  } }
  const calls = [], hooks = {}
  const history = createBoundedHistory({ links: async () => ({ session: 'chat' }), readWindow: p.readWindow, pageSize: 8 })
  const dispatched = []
  const presented = [], directed = []
  const rounds = createRoundHistory({
    chats: { read: async id => { calls.push('read'); return p.read(id) }, forSession: async () => { calls.push('read'); return p.read('chat') },
      readState: async id => (await p.readSlice(id, [], ['id', 'sessionId', 'regenInProgress'])).chat,
      readCard: async () => ({ name: '角色' }), readRevision: async (id, revision) => { calls.push('readRevision'); return p.readRevision(id, revision) },
      write: p.write, update: async (...args) => { calls.push('update:' + args[2]?.source); return p.update(...args) },
      ...(bounded ? {
        patch: async (...args) => {
          const source = String(args[3]?.source || '')
          calls.push('patch:' + source)
          const hook = hooks.beforePatch
          hooks.beforePatch = null
          await hook?.()
          // A write another operation makes between the read and this patch.
          const keyed = hooks.beforePatchOf?.[source]
          if (keyed) { delete hooks.beforePatchOf[source]; await keyed() }
          return p.patch(...args)
        },
        readRecent: async id => (await history.read(id, undefined, { storyRows: 2, lastAssistant: true }))?.chat,
        changedSince: (id, revision) => p.readChangedIndices(id, revision),
        rowsAt: (id, revision, indices) => readRowsAt(p.readWindow, id, revision, indices)
      } : {}) },
    sessions: { get: () => agent, flush: async () => {} },
    prepareRegenerationFrame: async input => {
      const current = await p.read('chat')
      return { userText: input.userText, frame: {
        kind: 'foreground', frameId: 'preview', operationId: 'preview', chatId: 'chat',
        branchId: current.timeline?.branchId || null, basedOnRevision: current.timeline?.revision || 0, turn: input.turn,
        userInput: { sourceText: input.userText, projectedText: input.userText, source: { stage: 'player-input' } },
        contributions: [{ slot: 'writingRules', text: 'fixture 当前材料', source: { stage: 'fixture' } }],
        source: {}, diagnostics: [], ignored: []
      } }
    }, timeline,
    scripts: { read: async () => ({ chunks: [] }), continuity: { transition: () => ({ state: {} }) }, dispatchEvent: async event => { dispatched.push({ name: event.name, args: event.args, chat: Boolean(event.chat), recent: event.recent === true }) } },
    replyCommitted: sessionId => directed.push('director:' + sessionId),
    queueSettlement: async () => { directed.push('settlement') }, cancelSettlement: async () => {},
    present: async value => { presented.push(isScopedMessages(value.messages) ? 'window' : 'full'); return { rolled: true } }
  })
  return { p, rounds, calls, session, dispatched, presented, hooks, directed, agent, root }
}

function comparable(chat) {
  const value = structuredClone({ ...chat, updatedAt: 0 })
  if (value.rollbackUndo) value.rollbackUndo.id = 'UNDO'
  return value
}

test('bounded rollback stores the same Chat as the complete rollback without reading the whole history', async t => {
  const results = []
  for (const bounded of [true, false]) {
    const h = await fixture(t, bounded)
    const before = await h.p.read('chat')
    const view = await h.rounds.rollback('session', 'chat', 81)
    const after = await h.p.read('chat')
    results.push({ h, before, after, view })
  }
  const [b, f] = results
  assert.deepEqual(b.h.calls, ['patch:rollback', 'patch:rollback.undo-point'])
  assert.ok(f.h.calls.includes('read') && f.h.calls.includes('readRevision'))
  assert.deepEqual(comparable(b.after), comparable(f.after))
  // The checkpoint state: round dropped, the settled older floor and variables restored.
  assert.equal(b.after.messages.length, 159)
  assert.equal(b.after.messages[120].tavernPluginData, undefined)
  assert.equal(b.after.variables.day, 1)
  assert.equal(b.after.posture, '门外')
  assert.equal(b.after.rollbackUndo.ready, true)
  assert.deepEqual(b.h.dispatched, [{ name: 'MESSAGE_DELETED', args: [159], chat: false, recent: true }])
  assert.deepEqual(f.h.dispatched, [{ name: 'MESSAGE_DELETED', args: [159], chat: true, recent: false }])
  assert.deepEqual(b.h.session.surface.nodes, f.h.session.surface.nodes)
  assert.deepEqual(b.view.rolledBack, f.view.rolledBack)
  assert.deepEqual(b.h.presented, ['window'])

  // Undo restores the pre-rollback Chat on both, the bounded one by patch.
  const undone = []
  for (const { h, before } of results) {
    h.calls.length = 0
    await h.rounds.undoRollback('session', 'chat')
    const restored = await h.p.read('chat')
    assert.deepEqual(restored.messages, before.messages)
    assert.deepEqual(restored.variables, before.variables)
    assert.equal(restored.posture, before.posture)
    undone.push({ calls: [...h.calls], restored })
  }
  assert.deepEqual(undone[0].calls.filter(call => call !== 'read'), ['patch:rollback.undo'])
  assert.deepEqual(comparable(undone[0].restored), comparable(undone[1].restored))
})

test('撤销回退的补丁落空一次时按新版本重试，正文只写一次', async t => {
  const h = await fixture(t, true)
  const before = await h.p.read('chat')
  await h.rounds.rollback('session', 'chat', 81)
  h.calls.length = 0
  // 结算/显示捕获这类后台写入只推进存储计数，不影响这次撤销。
  h.hooks.beforePatchOf = { 'rollback.undo': async () => { await h.p.update('chat', chat => { chat.settleStatus = 'running'; return chat }, { source: 'fixture.concurrent' }) } }
  await h.rounds.undoRollback('session', 'chat')
  const restored = await h.p.read('chat')
  assert.deepEqual(restored.messages, before.messages)
  assert.equal(restored.rollbackUndo, undefined)
  assert.equal(h.calls.filter(call => call === 'patch:rollback.undo').length, 2, '按新 revision 重放同一份补丁')
})

test('撤销补丁落空且正文已被别人写时不再重写，直接报冲突', async t => {
  const h = await fixture(t, true)
  await h.rounds.rollback('session', 'chat', 81)
  const afterRollback = await h.p.read('chat')
  h.hooks.beforePatchOf = { 'rollback.undo': async () => { await h.p.update('chat', chat => { chat.messages.push({ role: 'assistant', turn: 999, text: '别人写的一行' }); return chat }, { source: 'fixture.concurrent' }) } }
  await assert.rejects(h.rounds.undoRollback('session', 'chat'), /其他操作修改/)
  const stored = await h.p.read('chat')
  assert.equal(stored.messages.length, afterRollback.messages.length + 1, '不再把正文写一遍')
  assert.equal(stored.rollbackUndo.ready, true, '撤销点保留，刷新后可重试')
})

test('撤销补丁落空且撤销点已被花掉时不再写正文', async t => {
  const h = await fixture(t, true)
  await h.rounds.rollback('session', 'chat', 81)
  const afterRollback = await h.p.read('chat')
  h.hooks.beforePatchOf = { 'rollback.undo': async () => { await h.p.update('chat', chat => { delete chat.rollbackUndo; return chat }, { source: 'fixture.concurrent' }) } }
  await assert.rejects(h.rounds.undoRollback('session', 'chat'), /其他操作修改/)
  assert.equal((await h.p.read('chat')).messages.length, afterRollback.messages.length)
})

test('rolling back a completed round drops its pre-saved input from the checkpoint', async t => {
  for (const bounded of [true, false]) {
    const h = await fixture(t, bounded, { earlyInput: true })
    const before = await h.p.read('chat')
    await h.rounds.rollback('session', 'chat', 81)
    const after = await h.p.read('chat')
    assert.equal(after.messages.length, before.messages.length - 2)
    assert.equal(after.messages.at(-1).turn, 80)
    assert.equal(after.variables.day, 1)
    assert.equal(h.dispatched[0].args[0], after.messages.length)
    if (bounded) assert.deepEqual(h.calls, ['patch:rollback', 'patch:rollback.undo-point'])
    await h.rounds.undoRollback('session', 'chat')
    assert.deepEqual((await h.p.read('chat')).messages, before.messages)
  }
})

test('rollback to a turn removes every later round and one undo restores them all', async t => {
  for (const bounded of [true, false]) {
    const h = await fixture(t, bounded)
    for (const text of ['上楼', '开窗']) { h.agent.followup({ content: [{ type: 'text', text }] }); await h.agent.whenIdle() }
    const before = await h.p.read('chat'), nodes = [...h.session.surface.nodes]
    assert.equal(before.messages.at(-1).turn, 83)
    const result = await h.rounds.rollbackTo('session', 'chat', 81)
    assert.deepEqual(result.rolledBackTo, { target: 81, latest: 81, removed: 2 })
    assert.equal(result.rollbackWarning, undefined)
    const after = await h.p.read('chat')
    assert.equal(after.messages.at(-1).turn, 81)
    assert.equal(after.messages.length, before.messages.length - 4)
    assert.equal(after.rollbackUndo.turn, 83)
    const rolledHead = await h.p.readWindow('chat', { limit: 1 })
    assert.equal(rolledHead.worldMessage, after.messages.length - 1)
    assert.equal(rolledHead.worldMessageUid, after.messages.at(-1).messageUid)
    await assert.rejects(h.rounds.rollbackTo('session', 'chat', 81), /已经是最新一轮/)
    await h.rounds.undoRollback('session', 'chat')
    const restored = await h.p.read('chat')
    assert.deepEqual(restored.messages, before.messages)
    assert.deepEqual(restored.variables, before.variables)
    const restoredHead = await h.p.readWindow('chat', { limit: 1 })
    assert.equal(restoredHead.worldMessage, restored.messages.length - 1)
    assert.equal(restoredHead.worldMessageUid, restored.messages.at(-1).messageUid)
    const texts = list => list.map(seq => h.session.events[seq].data).map(data => (data.message || data).content?.map(part => part.text).join(''))
    assert.deepEqual(texts(h.session.surface.nodes), texts(nodes))
  }
})

test('rollback to a turn stops where the model context ends and keeps the rounds it removed', async t => {
  const h = await fixture(t, true)
  h.agent.followup({ content: [{ type: 'text', text: '上楼' }] }); await h.agent.whenIdle()
  const partial = await h.rounds.rollbackTo('session', 'chat', 70)
  assert.deepEqual(partial.rolledBackTo, { target: 70, latest: 80, removed: 2 })
  assert.match(partial.rollbackWarning, /已回退 2 轮，停在第 80 轮.*从这一轮分叉/)
  assert.equal((await h.p.read('chat')).messages.at(-1).turn, 80)
})

test('bounded regeneration stores the same Chat and surface as the complete regeneration', async t => {
  const results = []
  for (const bounded of [true, false]) {
    const h = await fixture(t, bounded)
    const before = await h.p.read('chat')
    const view = await h.rounds.regenerate('chat', '更紧张一些', 'session')
    assert.deepEqual(h.directed, ['director:session', 'settlement'], 'only the adopted regenerated body starts direction, before settlement')
    const after = await h.p.read('chat')
    assert.equal(after.messages.at(-1).messageUid, before.messages.at(-1).messageUid, '重新生成沿用同一消息身份')
    const head = await h.p.readWindow('chat', { limit: 1 })
    assert.equal(head.worldMessage, after.messages.length - 1)
    assert.equal(head.worldMessageUid, after.messages.at(-1).messageUid)
    results.push({ h, before, after, view })
  }
  const [b, f] = results
  for (const h of [b.h, f.h]) assert.ok(!h.calls.includes('patch:rollback.regen') && !h.calls.includes('update:rollback.regen'), JSON.stringify(h.calls))
  assert.ok(b.h.calls.includes('update:foreground.regen-commit') && f.h.calls.includes('update:foreground.regen-commit'))
  const strip = chat => {
    const value = comparable(chat)
    if (value.messages?.length) value.messages.at(-1).ts = 0
    for (const op of Object.values(value.timeline.operations)) if (op.regenerationId) op.regenerationId = 'R'
    return JSON.parse(JSON.stringify(value).replace(/tavern-regen:[0-9a-f-]+/g, 'tavern-regen:R'))
  }
  assert.deepEqual(strip(b.after), strip(f.after))
  // The original floors around the new round, including the floor settlement edited after the checkpoint.
  assert.equal(b.after.messages.length, b.before.messages.length)
  assert.deepEqual(b.after.messages.slice(0, -1), b.before.messages.slice(0, -1))
  assert.equal(b.after.messages.at(-1).text, '重写正文82')
  assert.equal(b.after.messages.at(-1).turn, 81)
  assert.equal(b.after.regenInProgress, undefined)
  assert.equal(b.after.regeneratedDshTurns['81'], 82)
  const texts = h => h.session.surface.nodes.map(seq => h.session.events[seq]).filter(e => e.type === 'assistant/message').map(e => e.data.message.content.map(c => c.text).join(''))
  assert.deepEqual(texts(b.h), texts(f.h))
  assert.deepEqual(b.view.adopted, f.view.adopted)
})

test('regeneration after its world source is detached keeps the retained world', async t => {
  for (const bounded of [true, false]) {
    const h = await fixture(t, bounded), before = await h.p.read('chat'), source = before.messages.at(-1)
    await h.p.update('chat', current => {
      delete current.messages.at(-1).variables
      return current
    }, { source: 'test.detach-world', worldSelection: { preserveWorld: true,
      selected: { position: null, swipe: 0, messageUid: source.messageUid } } })
    let head = await h.p.readWindow('chat', { limit: 1 })
    assert.equal(head.worldMessage, null)
    assert.equal(head.worldMessageUid, source.messageUid)
    await h.rounds.regenerate('chat', '', 'session')
    head = await h.p.readWindow('chat', { limit: 1 })
    assert.equal(head.worldMessage, null)
    assert.equal(head.worldMessageUid, source.messageUid)
    const domain = createConversationState({ store: createConversationPageStore({ root: join(h.root, 'chats') }) })
    assert.equal((await domain.readWorld('chat')).variables.hp, 82)
  }
})

test('a failed bounded regeneration keeps the old body discarded like the complete abort', async t => {
  const results = []
  for (const bounded of [true, false]) {
    const h = await fixture(t, bounded)
    h.hooks.failGeneration = true
    const before = await h.p.read('chat')
    await assert.rejects(h.rounds.regenerate('chat', '', 'session'), /fixture generation failed/)
    results.push({ before, after: await h.p.read('chat') })
  }
  for (const { before, after } of results) {
    assert.deepEqual(after.messages, before.messages.slice(0, -1))
    assert.equal(after.failedRegenerationTarget.assistant.text, before.messages.at(-1).text)
    assert.equal(after.regenInProgress, undefined)
    assert.deepEqual(after.variables, before.variables)
  }
  assert.deepEqual(comparable(results[0].after), comparable(results[1].after))
})

test('被截断的重新生成保留已生成的部分正文，两种路径结果一致', async t => {
  const results = []
  for (const bounded of [true, false]) {
    const h = await fixture(t, bounded)
    const before = await h.p.read('chat')
    h.hooks.partialGeneration = '半截正文'
    const view = await h.rounds.regenerate('chat', '', 'session')
    const after = await h.p.read('chat')
    assert.equal(view.adopted.text, '半截正文')
    assert.match(view.regenerationWarning, /已保留生成到的部分正文/)
    // The round keeps its original number and the player's input; only the body is new.
    assert.equal(after.messages.length, before.messages.length)
    assert.deepEqual(after.messages.slice(0, -2), before.messages.slice(0, -2))
    assert.equal(after.messages.at(-2).text, before.messages.at(-2).text)
    assert.equal(after.messages.at(-1).turn, 81)
    assert.equal(after.messages.at(-1).text, '半截正文')
    assert.equal(after.messages.at(-1).incomplete, true)
    assert.equal(after.regenInProgress, undefined)
    assert.equal(after.regenRecovery, undefined)
    results.push(after)
  }
  const strip = chat => {
    const value = comparable(chat)
    if (value.messages?.length) value.messages.at(-1).ts = 0
    if (value.nativeSync) value.nativeSync.at = 0
    for (const op of Object.values(value.timeline.operations)) if (op.regenerationId) op.regenerationId = 'R'
    return JSON.parse(JSON.stringify(value).replace(/tavern-regen:[0-9a-f-]+/g, 'tavern-regen:R'))
  }
  assert.deepEqual(strip(results[0]), strip(results[1]))
})

test('max-tokens 已落原生正文的重生成也保留截断标记', async t => {
  const h = await fixture(t, true)
  h.agent.whenIdle = async function () {
    const turn = ++h.agent.phase.lastTurn, userText = h.agent.input.content[0].text
    h.agent.input = null
    h.session.append('user/message', { turn, role: 'user', content: [{ type: 'text', text: userText }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }, { surfaceOp: 'append' })
    h.session.append('assistant/message', { turn, step: 1, message: { role: 'assistant', source: model, content: [{ type: 'text', text: '达到上限的正文' }] } }, { surfaceOp: 'append' })
    h.session.append('turn/end', { turn, reason: { kind: 'max-tokens' } })
  }
  const view = await h.rounds.regenerate('chat', '', 'session')
  const row = (await h.p.read('chat')).messages.at(-1)
  assert.equal(view.adopted.text, '达到上限的正文')
  assert.match(view.regenerationWarning, /已保留生成到的部分正文/)
  assert.equal(row.incomplete, true)
})

// A failed turn's own cleanup (foreground.discard restoring the staged template
// input) writes the save right after the attempt; the regeneration commit then
// read a revision that had already moved. It used to abort the whole round.

// A host that refuses an assistant replacement refuses every round of that
// session, and one that accepts accepts the next: the probe clones the whole
// event log and folds its surface again, so a session pays for it once.
function previewLike(events) {
  const stub = { id: 'session', header: { version: 3 }, events, surface: { nodes: events.map(event => event.seq) },
    append(type, data, options = {}) {
      const seq = events.length
      events.push({ seq, type, data, ...options })
      const nodes = stub.surface.nodes
      if (options.surfaceOp?.op === 'replace') {
        const start = nodes.indexOf(options.surfaceOp.startSeq)
        const end = nodes.indexOf(options.surfaceOp.endSeq)
        if (start >= 0 && end >= start) nodes.splice(start, end - start + 1, seq)
        else nodes.push(seq)
      } else nodes.push(seq)
      return seq
    } }
  return stub
}

test('正文替换预检每场会话只做一次', async t => {
  const h = await fixture(t, true)
  let probes = 0
  h.session.header = { version: 3 }
  h.session.constructor = { fromRestore(id, seed) { probes++; return previewLike(seed) } }
  await h.rounds.regenerate('chat', '', 'session')
  assert.equal(probes, 1)
  await h.rounds.regenerate('chat', '', 'session')
  assert.equal(probes, 1)
})
