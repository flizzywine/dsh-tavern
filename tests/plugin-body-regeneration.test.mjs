import { projectPluginBody } from '../tavern-plugin/lib/domain/st-contract-service.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { computeSceneTarget } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { applyRegenerationProjection } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { acquireHostSession, withHostAgent } from '../tavern-plugin/lib/host/sessions.js'

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
  const phases = [], notifications = [], commits = [], settlementInputs = []
  const deps = {
    chats, timeline, sessions: { get: () => agent, flush: async () => options.flush?.() }, scripts: {},
    readRegenerationMaterials: async ({ chat, beforeChat, turn }) => ({ target: { turn },
      history: [], currentInput: { text: chat.messages[0].text }, stateBefore: { posture: beforeChat.posture } }),
    prepareRegenerationReply: options.prepareRegenerationReply || (async ({ chat, text }) => {
      assert.equal(chat.macroState.local.inputCount, 1)
      assert.equal(chat.macroState.local.oldOutput, undefined)
      assert.deepEqual(chat.tavernScriptPrompts, [])
      chat.macroState.local.newOutput = (chat.macroState.local.newOutput || 0) + 1
      return { projectionText: text, sessionText: text, displayText: text, displayMode: 'html', warnings: [] }
    }),
    cancelSettlement: async () => options.cancelSettlement?.(),
    notifyRegeneration: async (gameId, target) => { notifications.push(target.turn) },
    replyCommitted: (sessionId, revision) => { commits.push({ sessionId, revision }) },
    queueSettlement: async () => {
      settlementInputs.push(await chats.read())
      if (options.settlementError) throw new Error('结算失败')
      await chats.update('chat', chat => { chat.settleStatus = 'done'; chat.posture = '新状态'; return chat })
    }, present: async chat => chat
  }
  const history = createRoundHistory(deps)
  const run = (generate, extra = {}) => history.regenerateWithProvider({ gameId: 'session', turn: 2,
    textVersion: computeSceneTarget(original, 2).key, generate, onPhase: value => phases.push(value), ...extra })
  return { chats, timeline, session, agent, original, start, history, deps, run, phases, notifications, commits, settlementInputs }
}

for (const closeFails of [false, true]) test(`plugin regeneration retains the writer through projection, closeFails=${closeFails}`, async t => {
  const h = await fixture()
  const borrowed = Promise.withResolvers(), finishBorrow = Promise.withResolvers()
  const generating = Promise.withResolvers(), finishGeneration = Promise.withResolvers()
  const closeError = new Error('writer closed with an error')
  const warnings = t.mock.method(console, 'warn', () => {})
  let live = false, resumes = 0, disposals = 0, flushes = 0
  const host = { sessions: { get: () => live ? h.session : undefined }, agents: {
    get: () => live ? h.agent : undefined,
    async resume() {
      assert.equal(live, false)
      live = true
      resumes++
      return { agent: h.agent, async dispose() {
        live = false
        disposals++
        if (closeFails) throw closeError
      } }
    }
  } }
  Object.assign(h.deps.sessions, {
    get: host.agents.get,
    acquire: (id, options) => acquireHostSession(host, id, options),
    async flush() { assert.equal(live, true); flushes++ }
  })
  const otherWork = withHostAgent(host, 'session', () => { borrowed.resolve(); return finishBorrow.promise })
  await borrowed.promise
  const regeneration = h.run(async () => {
    generating.resolve()
    await finishGeneration.promise
    return { text: '新正文' }
  })
  try {
    await Promise.race([generating.promise, regeneration])
    finishBorrow.resolve()
    await otherWork
    assert.equal(disposals, 0)
  } finally {
    finishBorrow.resolve()
    finishGeneration.resolve()
    await Promise.all([otherWork, regeneration])
  }
  assert.equal((await regeneration).text, '新正文')
  assert.equal((await h.chats.read()).nativeSync, undefined)
  assert.equal(flushes, 1)
  assert.equal(resumes, 1)
  assert.equal(disposals, 1)
  assert.equal(warnings.mock.calls.some(({ arguments: args }) => args.includes(closeError.message)), closeFails)
})

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

async function unfinishedSettlement(h, running) {
  let chat = await h.chats.read()
  const body = Object.values(chat.timeline.operations).find(operation => operation.kind === 'body')
  body.background.phase = 'pending'
  chat.settleStatus = 'pending'
  if (running) chat = h.timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } }).chat
  await h.chats.write(chat)
  return chat
}

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

test('crash recovery retains plugin rules with the paid candidate', async () => {
  let candidateState
  const prepareRegenerationReply = ({ text, ...options }) => projectPluginBody(text, options)
  const h = await fixture({ prepareRegenerationReply, afterWrite(meta, saved) {
    if (meta?.source === 'foreground.plugin-regen-candidate') candidateState = copy(saved)
  } })
  await h.run(async () => ({ text: 'X', regexScripts: [{ findRegex: 'X', replaceString: 'display', placement: [2], markdownOnly: true }] }), { providerId: 'test:body' })
  const fresh = await fixture({ prepareRegenerationReply })
  await fresh.chats.write(candidateState)
  await fresh.history.recover('chat')
  await fresh.run(() => assert.fail('must reuse paid candidate'), { providerId: 'test:body' })
  const row = (await fresh.chats.read()).messages.at(-1)
  assert.equal(row.text, 'X')
  assert.equal(row.displayText, 'display')
  assert.equal(row.bodyPluginProjection, true)
})
