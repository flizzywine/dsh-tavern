import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { computeSceneTarget } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { findBodyRegenerationFrame } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'
import { applyRegenerationProjection } from '../tavern-plugin/lib/domain/rollback-surface.js'

const copy = value => structuredClone(value)

async function fixture(options = {}) {
  const revisions = new Map()
  let state, revision = 0
  const chats = {
    async write(chat) { state = { ...copy(chat), _storageRevision: ++revision }; revisions.set(revision, copy(state)); return copy(state) },
    async read() { return copy(state) },
    async readState() { return copy(state) },
    async forSession() { return copy(state) },
    async readRevision(id, revision) { return revisions.has(revision) ? copy(revisions.get(revision)) : undefined },
    async readCard() { return { name: '角色' } },
    async update(id, fn, metadata) {
      const result = await fn(copy(state))
      if (result === undefined) return copy(state)
      const saved = await this.write(result)
      await options.afterWrite?.(metadata, saved)
      return saved
    }
  }
  const timeline = createStoryTimeline()
  await chats.write(timeline.apply({ chat: { id: 'chat', sessionId: 'session', mode: 'story', messages: [],
    posture: '起点 HP 10', macroState: { local: { inputCount: 0 } }, mvu: { enabled: true, owner: 'official' } }, intent: { kind: 'ensure' } }).chat)
  const start = await chats.read()
  const begun = timeline.apply({ chat: start, intent: { kind: 'body.begin', turn: 2, userText: '继续' } })
  const operation = begun.chat.timeline.operations[begun.value.operationId]
  const preparedState = { version: 1, macroState: { local: { inputCount: 1 } },
    tavernScriptPrompts: [{ id: 'once', once: true, content: '本轮提示' }],
    preparedWorldBookContext: '本轮世界书', variables: { inputCount: 1 } }
  begun.chat.foregroundFrames = { [operation.id]: {
    kind: 'foreground', chatId: 'chat', operationId: operation.id, turn: 2,
    branchId: operation.basedOn.branchId, basedOnRevision: operation.basedOn.revision,
    userInput: { sourceText: '继续', projectedText: '继续' }, source: { regenerationState: preparedState }
  } }
  const completed = timeline.complete({ chat: begun.chat, operationId: operation.id, basedOn: operation.basedOn,
    outcome: { status: 'success' }, apply(chat) {
      chat.messages = [{ role: 'user', text: '继续', variables: [{ hp: 10 }] },
        { role: 'assistant', turn: 2, text: '旧正文', sourceText: '旧正文', variables: [{ hp: 9 }] }]
      chat.macroState = { local: { inputCount: 1, oldOutput: 1 } }
      chat.posture = '旧正文后 HP 9'
      chat.settleStatus = 'done'
    } })
  completed.chat.timeline.operations[operation.id].background.phase = 'completed'
  await chats.write(completed.chat)
  const original = await chats.read()
  const session = Session.create('session')
  appendSessionEvent(session, 'user/message', { id: 'input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] }, { surfaceOp: 'append' })
  // withoutBody：这一轮的正文从来没落到消息面上（截断后没投影就丢了）。
  if (!options.withoutBody) appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'reply', role: 'assistant',
    source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: '旧正文' }] } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const agent = { session, phase: { kind: 'idle', lastTurn: 2 }, followup() { throw new Error('must never use foreground agent') } }
  const phases = [], notifications = [], settlementInputs = []
  const deps = {
    chats, timeline, sessions: { get: () => agent, flush: async () => options.flush?.() }, scripts: {},
    readRegenerationMaterials: async ({ chat, beforeChat, turn }) => ({ target: { turn },
      history: [], currentInput: { text: chat.messages[0].text }, stateBefore: { posture: beforeChat.posture } }),
    prepareRegenerationReply: async ({ chat, text }) => {
      assert.equal(chat.macroState.local.inputCount, 1)
      assert.equal(chat.macroState.local.oldOutput, undefined)
      assert.deepEqual(chat.tavernScriptPrompts, [])
      chat.macroState.local.newOutput = (chat.macroState.local.newOutput || 0) + 1
      return { projectionText: text, sessionText: text, displayText: text, displayMode: 'html', warnings: [] }
    },
    cancelSettlement: async () => options.cancelSettlement?.(),
    notifyRegeneration: async (gameId, target) => { notifications.push(target.turn) },
    queueSettlement: async () => {
      settlementInputs.push(await chats.read())
      if (options.settlementError) throw new Error('结算失败')
      await chats.update('chat', chat => { chat.settleStatus = 'done'; chat.posture = '新状态'; return chat })
    }, present: async chat => chat
  }
  const history = createRoundHistory(deps)
  const run = (generate, extra = {}) => history.regenerateWithProvider({ gameId: 'session', turn: 2,
    textVersion: computeSceneTarget(original, 2).key, generate, onPhase: value => phases.push(value), ...extra })
  return { chats, timeline, session, agent, original, start, history, deps, run, phases, notifications, settlementInputs }
}

test('prepared configuration is durable before generation and guidance is part of the bound material', async () => {
  const h = await fixture()
  let prepared = 0
  await h.run(async ({ materials, snapshot }) => {
    const saved = await h.chats.read()
    assert.equal(saved.regenRecovery.generation.snapshot.config.preset, 'frozen')
    assert.equal(snapshot.config.preset, 'frozen')
    assert.equal(materials.guidance, '更简洁')
    assert.equal(saved.regenRecovery.generation.materialsDigest, materials.digest)
    // 生成期间页面撤掉旧正文：原生行与故事行 UID 都记在这次操作的恢复点里。
    assert.equal(saved.regenRecovery.temporaryReplacingTurn, 2)
    assert.match(saved.regenRecovery.targetMessageUid, /^legacy-/)
    return { text: '新正文' }
  }, { guidance: '更简洁', providerId: 'test:body', prepare: ({ reason }) => {
    prepared++; assert.equal(reason, 'regenerate'); return { config: { preset: 'frozen' } }
  } })
  assert.equal(prepared, 1)
})

test('restart retains a durable candidate and explicit retry adopts it without another model call', async () => {
  let candidateState
  const h = await fixture({ afterWrite(meta, saved) {
    if (meta?.source === 'foreground.plugin-regen-candidate') candidateState = copy(saved)
  } })
  await h.run(async () => ({ text: '已付费的候选正文' }), { providerId: 'test:body' })
  // Restore the exact durable state at the crash boundary, with its original native surface.
  const fresh = await fixture()
  await fresh.chats.write(candidateState)
  await fresh.history.recover('chat')
  assert.equal((await fresh.chats.read()).bodyGenerationCandidate.text, '已付费的候选正文')
  const result = await fresh.run(() => assert.fail('must reuse the durable candidate'), { providerId: 'test:body' })
  assert.equal(result.text, '已付费的候选正文')
  assert.equal((await fresh.chats.read()).bodyGenerationCandidate, undefined)
})

test('provider replaces one round and native context, then settles from the original start exactly once', async () => {
  const h = await fixture()
  const result = await h.run(async ({ materials }) => {
    assert.equal(materials.stateBefore.posture, '起点 HP 10')
    const during = await h.chats.read()
    assert.equal(during.messages.at(-1).text, '')
    assert.equal(during.messages.at(-1).regenerationDiscarded, true)
    assert.equal(during.regenRecovery.phase, 'prepared')
    assert.equal(during.posture, '旧正文后 HP 9')
    return { text: '<p>预设正则处理后的正文</p>' }
  })
  const current = await h.chats.read()
  assert.deepEqual(current.messages.map(row => row.text), ['继续', '<p>预设正则处理后的正文</p>'])
  assert.equal(current.regenInProgress, undefined)
  assert.equal(current.macroState.local.newOutput, 1)
  assert.equal(result.settlement, 'done')
  assert.notEqual(result.textVersion, computeSceneTarget(h.original, 2).key)
  assert.deepEqual(h.notifications, [2])
  assert.deepEqual(h.phases, ['generating', 'validating', 'committed', 'settling'])
  assert.equal(h.settlementInputs.length, 1)
  assert.equal(h.settlementInputs[0].posture, '起点 HP 10')
  assert.deepEqual(h.settlementInputs[0].messages.at(-1).variables, [{ hp: 10 }])
  assert.equal(h.settlementInputs[0].messages.at(-1).mvu.pending, true)
  const visible = JSON.stringify(h.session.deriveMessages())
  assert.match(visible, /预设正则处理后的正文/)
  assert.doesNotMatch(visible, /旧正文/)
  const checkpoint = current.timeline.checkpoints.at(-1)
  assert.equal(checkpoint.beforeRevision, h.start._storageRevision)
  const rolled = h.timeline.apply({ chat: current, intent: { kind: 'turn.rollback', beforeChat: await h.chats.readRevision('chat', checkpoint.beforeRevision) } }).chat
  assert.equal(rolled.posture, '起点 HP 10')
  assert.deepEqual(rolled.messages, [])
  assert.ok(findBodyRegenerationFrame(current, 2), 'the replacement retains its input snapshot for another retry')
})

test('generation failure and cancellation keep the old body deleted and never start settlement', async () => {
  for (const mode of ['failure', 'cancel', 'empty']) {
    const h = await fixture(), controller = new AbortController()
    await assert.rejects(h.run(async () => {
      if (mode === 'failure') throw new Error('模型拒绝')
      if (mode === 'cancel') { controller.abort(new Error('停止')); return new Promise(() => {}) }
      return { text: ' ' }
    }, { signal: controller.signal }))
    const current = await h.chats.read()
    assert.deepEqual(current.messages, h.original.messages.slice(0, -1))
    assert.equal(current.failedRegenerationTarget.assistant.text, '旧正文')
    assert.equal(current.posture, h.original.posture)
    assert.deepEqual(current.timeline, h.original.timeline)
    assert.equal(current.regenInProgress, undefined)
    assert.equal(h.settlementInputs.length, 0)
  }
})

async function unfinishedSettlement(h, running) {
  let chat = await h.chats.read()
  const body = Object.values(chat.timeline.operations).find(operation => operation.kind === 'body')
  body.background.phase = 'pending'
  chat.settleStatus = 'pending'
  if (running) chat = h.timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } }).chat
  await h.chats.write(chat)
  return chat
}

test('a failed or cancelled replacement does not resume the discarded body settlement', async () => {
  for (const running of [false, true]) for (const cancelled of [false, true]) {
    const h = await fixture(), controller = new AbortController()
    const interrupted = await unfinishedSettlement(h, running)
    await assert.rejects(h.run(async () => {
      if (cancelled) { controller.abort(new Error('停止')); return new Promise(() => {}) }
      throw new Error('模型拒绝')
    }, { signal: controller.signal }), cancelled ? /停止/ : /模型拒绝/)
    assert.equal(h.settlementInputs.length, 0)
    const current = await h.chats.read()
    assert.deepEqual(current.messages, interrupted.messages.slice(0, -1))
    assert.equal(current.posture, interrupted.posture)
    assert.equal(current.regenInProgress, undefined)
    assert.equal(current.timeline.branchId, interrupted.timeline.branchId)
    assert.equal(current.timeline.revision, interrupted.timeline.revision)
  }
})

test('cancellation while stopping old settlement resumes it even before the regeneration marker exists', async () => {
  const controller = new AbortController()
  const h = await fixture({ cancelSettlement: async () => controller.abort(new Error('停止')) })
  await unfinishedSettlement(h, true)
  await assert.rejects(h.run(async () => { throw new Error('must not generate') }, { signal: controller.signal }), /停止/)
  assert.equal(h.settlementInputs.length, 1)
  assert.equal(h.settlementInputs[0].messages.at(-1).text, '旧正文')
})

test('failure does not resume old settlement after a concurrent branch change or explicit background stop', async () => {
  for (const change of ['branch', 'stop']) {
    const h = await fixture()
    await unfinishedSettlement(h, true)
    await assert.rejects(h.run(async () => {
      await h.chats.update('chat', current => {
        if (change === 'branch') current.timeline.branchId = 'another-branch'
        else current = h.timeline.apply({ chat: current, intent: { kind: 'background.recover', cancelDelivery: true } }).chat
        return current
      })
      throw new Error('模型拒绝')
    }), /模型拒绝/)
    assert.equal(h.settlementInputs.length, 0)
  }
})

test('a concurrent version change rejects the candidate without restoring stale story data', async () => {
  const h = await fixture()
  await assert.rejects(h.run(async () => {
    await h.chats.update('chat', current => {
      current.messages.at(-1).sourceText = current.messages.at(-1).text = '另一项操作改过的正文'
      current.timeline.revision++
      return current
    })
    return { text: '过期候选' }
  }), /变化|修改/)
  const current = await h.chats.read()
  assert.deepEqual(current.messages.map(row => row.text), ['继续'])
  assert.equal(current.regenInProgress, undefined)
  assert.equal(h.settlementInputs.length, 0)
})

test('settlement failure keeps the new body and exposes a retryable settlement error', async () => {
  const h = await fixture({ settlementError: true })
  const result = await h.run(async () => ({ text: '新正文' }))
  assert.equal(result.settlement, 'failed')
  assert.equal(result.settlementError, '结算失败')
  assert.equal((await h.chats.read()).messages.at(-1).text, '新正文')
  assert.match(JSON.stringify(h.session.deriveMessages()), /新正文/)
})

test('recovery of an abandoned independent request clears only its marker', async () => {
  const h = await fixture()
  await h.chats.update('chat', current => {
    current.regenInProgress = true
    current.regenRecovery = { detached: true, phase: 'prepared', id: 'crashed', beforeRevision: 1, sessionId: 'session' }
    current.someSetting = 'saved while generating'
    return current
  })
  const events = sessionEvents(h.session).length
  await createRoundHistory(h.deps).recover('chat')
  const current = await h.chats.read()
  assert.deepEqual(current.messages, h.original.messages)
  assert.deepEqual(current.timeline, h.original.timeline)
  assert.equal(current.someSetting, 'saved while generating')
  assert.equal(current.regenRecovery, undefined)
  assert.equal(sessionEvents(h.session).length, events)
})

test('native flush failure after commit retains authoritative new body for recovery', async () => {
  const h = await fixture({ flush: async () => { throw new Error('磁盘繁忙') } })
  const result = await h.run(async () => ({ text: '已提交的新正文' }))
  assert.equal(result.text, '已提交的新正文')
  const current = await h.chats.read()
  assert.equal(current.messages.at(-1).text, '已提交的新正文')
  assert.equal(current.nativeSync.status, 'stale')
  assert.equal(current.regenRecovery, undefined)
})

test('a failed latest input appends its own round and never replaces the previous successful reply', async () => {
  const h = await fixture()
  const beforeFailure = await h.chats.read()
  const begun = h.timeline.apply({ chat: beforeFailure, intent: { kind: 'body.begin', turn: 3, userText: '新的失败输入' } })
  const operation = begun.chat.timeline.operations[begun.value.operationId]
  begun.chat.foregroundFrames[operation.id] = { kind: 'foreground', chatId: 'chat', operationId: operation.id,
    turn: 3, branchId: begun.chat.timeline.branchId, basedOnRevision: operation.basedOn.revision,
    userInput: { sourceText: '新的失败输入', projectedText: '新的失败输入' },
    source: { regenerationState: { version: 1, macroState: { local: { inputCount: 2, oldOutput: 1 } }, tavernScriptPrompts: [] } } }
  await h.chats.write(begun.chat)
  appendSessionEvent(h.session, 'turn/start', { turn: 3 })
  appendSessionEvent(h.session, 'step/start', { turn: 3, step: 1 })
  appendSessionEvent(h.session, 'user/message', { id: 'failed-input', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '新的失败输入' }] }, { surfaceOp: 'append' })
  appendSessionEvent(h.session, 'step/end', { turn: 3, step: 1 })
  appendSessionEvent(h.session, 'turn/end', { turn: 3, reason: { kind: 'error', message: '模型拒绝' } })
  h.agent.phase.lastTurn = 3
  const history = createRoundHistory({ ...h.deps,
    prepareRegenerationReply: async ({ chat, text }) => {
      assert.equal(chat.macroState.local.inputCount, 2)
      assert.equal(chat.macroState.local.oldOutput, 1)
      return { projectionText: text, sessionText: text, displayText: text, displayMode: 'markdown' }
    },
    readRegenerationMaterials: async ({ kind, targetInput, beforeChat, chat, turn }) => {
      assert.equal(kind, 'failed')
      assert.equal(turn, 3)
      assert.equal(targetInput.raw, '新的失败输入')
      assert.equal(beforeChat._storageRevision, beforeFailure._storageRevision)
      assert.equal(chat.messages.at(-1).text, '旧正文')
      return { target: { kind }, currentInput: targetInput }
    }
  })
  const result = await history.regenerateWithProvider({ gameId: 'session', turn: 3,
    generate: async ({ materials }) => {
      assert.equal(materials.target.kind, 'failed')
      assert.equal((await h.chats.read()).messages.length, 2)
      return { text: '失败输入现在生成的新正文' }
    } })
  const saved = await h.chats.read()
  assert.equal(result.turn, 4)
  assert.deepEqual(saved.messages.map(row => row.text), ['继续', '旧正文', '新的失败输入', '失败输入现在生成的新正文'])
  assert.deepEqual(saved.suppressedDshTurns, [3])
  assert.equal(saved.messages.at(-1).nativeAnchor.turn, 4)
  assert.equal(saved.messages.at(-1).bodyRegenerationProcessed, true)
  assert.equal(saved.timeline.checkpoints.length, h.original.timeline.checkpoints.length + 1)
  assert.equal(saved.timeline.checkpoints.at(-1).beforeRevision, beforeFailure._storageRevision)
  assert.ok(findBodyRegenerationFrame(saved, 4))
  const visible = JSON.stringify(h.session.deriveMessages())
  assert.match(visible, /旧正文/)
  assert.match(visible, /失败输入现在生成的新正文/)
  assert.equal((visible.match(/新的失败输入/g) || []).length, 1)
})

for (const alreadyAppended of [false, true]) test('failed-input committed recovery appends one pair only, already appended=' + alreadyAppended, async () => {
  const h = await fixture({ afterWrite: async metadata => {
    if (metadata?.source === 'foreground.plugin-regen-commit') throw new Error('模拟正文已提交后进程中断')
  } })
  const before = await h.chats.read()
  const begun = h.timeline.apply({ chat: before, intent: { kind: 'body.begin', turn: 3, userText: '失败输入' } })
  const operation = begun.chat.timeline.operations[begun.value.operationId]
  begun.chat.foregroundFrames[operation.id] = { ...copy(Object.values(begun.chat.foregroundFrames)[0]),
    operationId: operation.id, turn: 3, userInput: { sourceText: '失败输入', projectedText: '失败输入' } }
  await h.chats.write(begun.chat)
  appendSessionEvent(h.session, 'turn/start', { turn: 3 })
  appendSessionEvent(h.session, 'step/start', { turn: 3, step: 1 })
  appendSessionEvent(h.session, 'user/message', { id: 'failed-input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '失败输入' }] }, { surfaceOp: 'append' })
  appendSessionEvent(h.session, 'step/end', { turn: 3, step: 1 })
  appendSessionEvent(h.session, 'turn/end', { turn: 3, reason: { kind: 'error' } })
  await assert.rejects(h.history.regenerateWithProvider({ gameId: 'session', generate: async () => ({ text: '恢复的新正文' }) }), /进程中断/)
  const pending = await h.chats.read()
  assert.equal(pending.regenRecovery.phase, 'committed')
  if (alreadyAppended) applyRegenerationProjection(h.session, pending.regenRecovery.projection)
  await createRoundHistory(h.deps).recover('chat')
  const current = await h.chats.read()
  assert.equal(current.regenRecovery, undefined)
  assert.equal(current.messages.at(-1).text, '恢复的新正文')
  assert.equal(current.messages.at(-1).nativeAnchor.turn, 4)
  const count = sessionEvents(h.session).length
  await createRoundHistory(h.deps).recover('chat')
  assert.equal(sessionEvents(h.session).length, count)
  const reopened = Session.create(h.session.id, copy(sessionEvents(h.session)), copy(h.session.header))
  const visible = JSON.stringify(reopened.deriveMessages())
  assert.equal((visible.match(/恢复的新正文/g) || []).length, 1)
  assert.equal((visible.match(/失败输入/g) || []).length, 1)
})

test('面上没有这一轮正文时补写一条，旧正文不在了也能重新生成', async () => {
  // 上一次重新生成截断后没有落位：这一轮的正文在存档里，消息流上却没有。
  const h = await fixture({ withoutBody: true })
  const result = await h.run(async () => ({ text: '补写的正文' }), { providerId: 'test:body' })
  assert.equal(result.text, '补写的正文')
  const saved = await h.chats.read()
  assert.equal(saved.messages.at(-1).text, '补写的正文')
  // 新正文作为第 2 轮落在消息面上，并记下了锚点，下一次重新生成不用再猜。
  const current = (await import('../tavern-plugin/lib/domain/session-events.js')).sessionEvents(h.session)
  const appended = h.session.surface.nodes.map(seq => current.find(event => event.seq === seq))
    .filter(event => event?.type === 'assistant/message' && event.data?.message?.source?.tavernStoryTurn === 2)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].data.message.content[0].text, '补写的正文')
  assert.equal(saved.messages.at(-1).nativeAnchor.turn, Number(appended[0].data.turn))
  assert.equal(saved.messages.at(-1).nativeAnchor.input, undefined)
  assert.equal(saved.messages.at(-1).nativeAnchor.reply, Number(appended[0].seq))
})

test('补写缺少玩家行时使用空输入，不在生成后抛内部异常', async () => {
  const h = await fixture({ withoutBody: true })
  const chat = await h.chats.read()
  chat.messages = [{ role: 'assistant', turn: 2, text: '旧正文', sourceText: '旧正文' }]
  await h.chats.write(chat)
  let calls = 0
  await h.history.regenerateWithProvider({ gameId: 'session', turn: 2, providerId: 'missing-input',
    generate: async () => { calls += 1; return { text: '空输入生成的新正文' } } })
  const saved = await h.chats.read()
  assert.equal(calls, 1)
  assert.equal(saved.messages.length, 1)
  assert.equal(saved.messages[0].role, 'assistant')
  assert.equal(saved.messages[0].text, '空输入生成的新正文')
  const operation = Object.values(saved.timeline.operations).filter(item => item.kind === 'body' && Number(item.turn) === 2).at(-1)
  assert.equal(operation.userText, '')
})

test('连续 assistant 时仍使用选择器找到的玩家输入', async () => {
  const h = await fixture({ withoutBody: true })
  const chat = await h.chats.read()
  chat.messages = [chat.messages[0],
    { role: 'assistant', turn: 90, text: '上一条独立正文', sourceText: '上一条独立正文' },
    chat.messages[1]]
  await h.chats.write(chat)
  await h.history.regenerateWithProvider({ gameId: 'session', turn: 2, providerId: 'recovered-input',
    generate: async () => ({ text: '这一轮的新正文' }) })
  const saved = await h.chats.read()
  assert.deepEqual(saved.messages.map(row => [row.role, row.text]), [
    ['user', '继续'], ['assistant', '上一条独立正文'], ['assistant', '这一轮的新正文']
  ])
  const operation = Object.values(saved.timeline.operations).filter(item => item.kind === 'body' && Number(item.turn) === 2).at(-1)
  assert.equal(operation.userText, '继续')
})

test('插件补写保留原正文的持久 messageUid', async () => {
  const h = await fixture({ withoutBody: true })
  const chat = await h.chats.read()
  chat.messages[1].messageUid = 'persistent-body-uid'
  await h.chats.write(chat)
  await h.history.regenerateWithProvider({ gameId: 'session', turn: 2, providerId: 'persistent-uid',
    generate: async () => ({ text: '保留身份的新正文' }) })
  const saved = await h.chats.read()
  assert.equal(saved.messages.at(-1).messageUid, 'persistent-body-uid')
})
