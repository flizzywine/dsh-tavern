import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectionFixture } from './fixtures/session-view-projection.mjs'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { sessionViewMessageFields } from '../tavern-plugin/lib/domain/session-view-projection.js'
import { planShowsRow } from '../tavern-plugin/lib/domain/transcript-row-plan.js'

for (const projected of [false, true]) test('cold bounded view preserves plugin output; dual projection=' + projected, async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-output-view-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const f = projectionFixture({ readCardExtensions: async () => ({ helperScripts: [], regexScripts: [{
    id: 'non-idempotent', findRegex: '/正文/g', replaceString: '再次处理正文',
    placement: [2], markdownOnly: true, promptOnly: false
  }] }) })
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  await persistence.write({ ...f.chat, _storageRevision: undefined, messages: [f.chat.messages[0],
    { role: 'assistant', turn: 2, sourceText: '已处理正文', projectionText: '已处理正文', text: '已处理正文',
      bodyRegenerationProcessed: true, ...(projected ? { bodyPluginProjection: true, displayText: '显示正文' } : {}) }
  ] })
  // Construct a fresh storage reader, as on a reopen: no complete in-memory
  // message can supply fields omitted from the bounded read contract.
  const cold = createChatJournalStore({ dataRoot: root })
  const window = await cold.readWindow(f.chat.id, { limit: 1, requirePartial: true, messageFields: sessionViewMessageFields })
  assert.equal(window.chat.messages[0].bodyRegenerationProcessed, true)
  const view = await f.projection.project.opening(window)
  assert.equal(view.replyProjections[0].text, projected ? '显示正文' : '已处理正文')
  // The rule is active for ordinary replies; only already processed output
  // bypasses it, including after opening the persisted bounded history page.
  const ordinary = await f.projection.project.full({ ...f.chat, id: 'ordinary',
    messages: [{ role: 'assistant', turn: 2, sourceText: '已处理正文', projectionText: '已处理正文', text: '已处理正文' }] })
  assert.equal(ordinary.replyProjections[0].text, '已处理再次处理正文')
})

test('全量、缓存、脏读写与状态投影视图一致暴露 storageRevision 与生成中的最新阻尼裁定', async () => {
  const { projectChatSessionState } = await import('../tavern-plugin/lib/domain/chat-session-state.js')
  const f = projectionFixture()
  const outcomeFloor = { mode: 'balanced', judgeMode: 'roleplay', rulingTier: 'resist_pushback', leverageScore: 0.7, clampedCount: 1, clampedKeys: [], evaluatedAt: 1001 }
  const outcomeTail = { mode: 'balanced', judgeMode: 'author', rulingTier: 'full_accept', leverageScore: 1.5, clampedCount: 0, clampedKeys: [], evaluatedAt: 1002 }

  const regeneratingFloorChat = {
    ...f.chat,
    _storageRevision: 17,
    regenInProgress: true,
    regenRecovery: {
      targetMessageUid: 'uid-floor-2',
      candidateFrame: { source: { narrativeDamperOutcome: outcomeFloor } }
    }
  }
  const projectedFloor = projectChatSessionState(regeneratingFloorChat)
  const fullView = await f.projection.project.full(projectedFloor)
  assert.equal(fullView.storageRevision, 17)
  assert.equal(fullView.streamingMessageUid, 'uid-floor-2')
  assert.equal(fullView.streamingStoryTurn, null)
  assert.deepEqual(fullView.streamingDamperOutcome, outcomeFloor)

  const cachedView = await f.projection.project.cached(projectedFloor, fullView, { busy: true, phase: 'running' })
  assert.equal(cachedView.storageRevision, 17)
  assert.deepEqual(cachedView.streamingDamperOutcome, outcomeFloor)

  const dirtyView = await f.projection.project.dirty({
    ...regeneratingFloorChat,
    _storageRevision: 18,
    regenRecovery: { unansweredTail: true, storyTurn: 5, damperOutcome: outcomeTail }
  }, fullView, new Set(), { busy: true, phase: 'running' }, { layoutChanged: false })
  assert.equal(dirtyView.storageRevision, 18)
  assert.equal(dirtyView.streamingMessageUid, null)
  assert.equal(dirtyView.streamingStoryTurn, 5)
  assert.deepEqual(dirtyView.streamingDamperOutcome, outcomeTail)

  const storyView = await f.projection.project.story({
    chat: regeneratingFloorChat,
    revision: 17, from: 0, to: 0, messageCount: 0,
    storyTranscript: { source: 'story', revision: 17, from: 0, to: 0, messageCount: 0, floorCount: 0, floorOffset: 0, messages: [] }
  })
  assert.equal(storyView.storageRevision, 17)
  assert.deepEqual(storyView.streamingDamperOutcome, outcomeFloor)

  const settledProjected = projectChatSessionState({
    ...regeneratingFloorChat,
    regenInProgress: false,
    _storageRevision: 19
  })
  assert.equal(settledProjected.regenRecovery, undefined)
  const settledView = await f.projection.project.full(settledProjected)
  assert.equal(settledView.storageRevision, 19)
  assert.equal(settledView.streamingDamperOutcome, null)
  assert.equal(settledView.streamingMessageUid, null)
  assert.equal(settledView.streamingStoryTurn, null)
})

test('重新生成期间视图点名被替换的原生行，行计划只撤掉旧正文、留下玩家输入', async () => {
  const model = { kind: 'model', provider: 'p', model: 'm' }
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', surfaceOp: 'append', data: { turn: 1, role: 'user', content: [{ type: 'text', text: '推门' }], source: { kind: 'user' } } },
    { seq: 2, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '旧正文' }], source: model } } },
    { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { seq: 4, type: 'turn/start', data: { turn: 2 } },
    { seq: 5, type: 'user/message', surfaceOp: 'append', data: { turn: 2, role: 'user', content: [{ type: 'text', text: '重新生成' }], source: { kind: 'plugin', plugin: 'dsh-tavern' } } }
  ]
  const f = projectionFixture({ sessionDebugEvidence: () => ({ loaded: true, events, nodes: [0, 1, 2, 3, 4, 5] }) })
  const chat = { ...f.chat, regenInProgress: true, regenRecovery: { id: 'op', phase: 'prepared', temporaryReplacingTurn: 1 },
    messages: [{ role: 'assistant', turn: 1, greeting: true, text: '开场白' }, { role: 'user', text: '推门' },
      { role: 'assistant', turn: 1, text: '旧正文' }] }
  const view = await f.projection.project.full(chat)
  assert.deepEqual(view.replacingDshTurns, [1], '生成中的恢复标记必须出现在视图里')
  assert.equal(planShowsRow(view.transcriptTurns, { turn: 1, kind: 'assistant-step' }, view.transcriptFrom), false, '旧正文先离开页面')
  assert.equal(planShowsRow(view.transcriptTurns, { turn: 1, kind: 'user' }, view.transcriptFrom), true, '玩家输入保留')
  // 生成结束后恢复默认显示：旧正文（此时已是新正文的那一行）照常画。
  const settled = await f.projection.project.full({ ...chat, regenInProgress: false })
  assert.deepEqual(settled.replacingDshTurns ?? [], [], '成功提交后不再藏任何正文')
  const failed = await f.projection.project.full({ ...chat, regenInProgress: false,
    failedRegenerationTarget: { dshTurn: 1, assistant: { messageUid: 'uid-old' } } })
  assert.deepEqual(failed.replacingDshTurns, [1], '失败后原生旧正文仍保持撤下')
  assert.equal(planShowsRow(failed.transcriptTurns, { turn: 1, kind: 'assistant-step' }, failed.transcriptFrom), false)
  assert.equal(planShowsRow(failed.transcriptTurns, { turn: 1, kind: 'user' }, failed.transcriptFrom), true, '失败也不误藏玩家输入')
})
