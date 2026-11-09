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

test('cold bounded view preserves plugin output without replaying output regexes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-output-view-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const f = projectionFixture({ readCardExtensions: async () => ({ helperScripts: [], regexScripts: [{
    id: 'non-idempotent', findRegex: '/正文/g', replaceString: '再次处理正文',
    placement: [2], markdownOnly: true, promptOnly: false
  }] }) })
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  await persistence.write({ ...f.chat, _storageRevision: undefined, messages: [f.chat.messages[0],
    { role: 'assistant', turn: 2, sourceText: '已处理正文', projectionText: '已处理正文', text: '已处理正文',
      bodyRegenerationProcessed: true }
  ] })
  // Construct a fresh storage reader, as on a reopen: no complete in-memory
  // message can supply fields omitted from the bounded read contract.
  const cold = createChatJournalStore({ dataRoot: root })
  const window = await cold.readWindow(f.chat.id, { limit: 1, requirePartial: true, messageFields: sessionViewMessageFields })
  assert.equal(window.chat.messages[0].bodyRegenerationProcessed, true)
  const view = await f.projection.project.opening(window)
  assert.equal(view.replyProjections[0].text, '已处理正文')
  // The rule is active for ordinary replies; only already processed output
  // bypasses it, including after opening the persisted bounded history page.
  const ordinary = await f.projection.project.full({ ...f.chat, id: 'ordinary',
    messages: [{ role: 'assistant', turn: 2, sourceText: '已处理正文', projectionText: '已处理正文', text: '已处理正文' }] })
  assert.equal(ordinary.replyProjections[0].text, '已处理再次处理正文')
})

test('story projection never reads native evidence, surface, events or running agents', async () => {
  const forbidden = () => { throw new Error('故事投影不应访问 native session') }
  const f = projectionFixture({
    sessionDebugEvidence: forbidden,
    sessionStore: { get: forbidden },
    agentRegistry: { get: forbidden }
  })
  const transcript = { source: 'story', revision: 4, from: 0, to: 1, messageCount: 2, floorCount: 1, floorOffset: 0, messages: [] }
  const view = await f.projection.project.story({
    chat: { ...f.chat, messages: [{ role: 'user', text: '输入' }, { role: 'assistant', text: '无原生编号正文' }] },
    revision: 4, from: 0, to: 1, messageCount: 2, storyTranscript: transcript
  })
  assert.equal(view.storyTranscript, transcript)
  assert.deepEqual(view.forkTurnsByMessageId, {})
  assert.deepEqual(view.editableUserInputTurns, [])
  assert.deepEqual(view.failedUserInputTurns, [])
  assert.equal(view.transcriptTurns, undefined)
  assert.equal(view.replacingDshTurns, undefined)
})

test('故事投影去除正文副本但保留混合 HTML 帧', async () => {
  const f = projectionFixture()
  const transcript = { source: 'story', revision: 4, from: 0, to: 1, messageCount: 2, floorCount: 2, floorOffset: 0, messages: [] }
  const window = {
    chat: { ...f.chat, messages: [
      { role: 'assistant', turn: 1, text: '正文', displayText: '正文', displayMode: 'markdown' },
      { role: 'assistant', turn: 2, text: '<div>人物卡界面</div>', displayText: '<div>人物卡界面</div>', displayMode: 'html' }
    ] },
    revision: 4, from: 0, to: 1, messageCount: 2, storyTranscript: transcript
  }
  const story = await f.projection.project.story(window)
  const plain = story.replyProjections.find(row => row.turn === 1)
  const rich = story.replyProjections.find(row => row.turn === 2)
  assert.equal(plain.text, '正文')
  assert.equal(plain.body, undefined)
  assert.equal(plain.parts, undefined, '纯 Markdown parts 可由 text 无损重建')
  assert.equal(rich.body, undefined)
  assert.equal(rich.text, undefined, '混合 parts 已完整携带正文时不再重复 text')
  assert.ok(rich.parts.some(part => part.kind === 'html'), '人物卡 HTML 帧不得随去重删除')
  assert.equal(rich.parts.map(part => part.kind === 'html' ? part.content : part.text).join(''), '<div>人物卡界面</div>')

  const opening = await f.projection.project.opening(window)
  assert.ok(opening.replyProjections[0].body, '普通会话编辑器仍需要结构化 body')
})

test('window projection uses real resource revisions and absolute helper ids without poisoning full caches', async () => {
  const f = projectionFixture()
  const chat = { ...f.chat, cardDefinitionSnapshot: { name: '卡' }, openingWorldbookSnapshot: { version: 1, document: null } }
  const full = await f.projection.project.full(chat, { deferResources: true })
  const window = await f.projection.project.opening({ chat: { ...chat, messages: [{ role: 'assistant', turn: 5, text: '窗口正文' }] },
    revision: 9, from: 8, to: 8, messageCount: 9 }, { deferResources: true })
  assert.deepEqual(window.historyWindow, { onDemand: true, from: 8, to: 8, messageCount: 9, revision: 9 })
  assert.equal(window.cardResourceAccess.revision, 9)
  assert.equal(window.tavernHelper.messages[0].message_id, 8)
  assert.equal(window.tavernHelper.turnMessageIds['5'], 8)
  assert.equal(window.tavernHelper.historyAccess.revision, 9)
  assert.equal(full.tavernHelper.messages[0].message_id, 0)
  const again = await f.projection.project.full(chat)
  assert.equal(again.tavernHelper.messages[0].message, '开场白')
  assert.deepEqual(f.calls, ['sync', 'warm', 'sync'])
})

test('card save stays readable as turn/path after full, cached and dirty projections', async () => {
  const f = projectionFixture()
  const chat = { ...f.chat, mode: 'card', lastCardSave: { turn: 4, path: 'cards/新卡.json', createsCard: true, changed: true } }
  const full = await f.projection.project.full(chat)
  assert.deepEqual(full.cardSave, { turn: 4, path: 'cards/新卡.json', createsCard: true, changed: true })
  const cached = await f.projection.project.cached(chat, full, { busy: true, phase: 'running' })
  assert.deepEqual(cached.cardSave, full.cardSave)
  const storyFull = await f.projection.project.full(f.chat)
  const dirty = await f.projection.project.dirty({ ...f.chat, _storageRevision: 2, lastCardSave: { turn: 4, path: 'cards/新卡.json', createsCard: false, changed: true } },
    storyFull, new Set(), { busy: false }, { layoutChanged: false })
  assert.deepEqual(dirty.cardSave, { turn: 4, path: 'cards/新卡.json', createsCard: false, changed: true })
  const play = await f.projection.project.full({ ...f.chat, lastCardSave: undefined })
  assert.equal(play.cardSave, null)
})

test('a body regeneration publishes the target story row UID, never on a settled chat', async () => {
  const f = projectionFixture()
  const regenerating = await f.projection.project.full({ ...f.chat, regenInProgress: true,
    regenRecovery: { targetMessageUid: 'uid-2' } })
  assert.equal(regenerating.streamingMessageUid, 'uid-2', '生成中的视图必须带目标故事行 UID')
  const settled = await f.projection.project.full({ ...f.chat, regenInProgress: false,
    regenRecovery: { targetMessageUid: 'uid-2' } })
  assert.equal(settled.streamingMessageUid, null, '生成结束后不得残留流标记')
  const idle = await f.projection.project.full(f.chat)
  assert.equal(idle.streamingMessageUid, null)
  const blank = await f.projection.project.full({ ...f.chat, regenInProgress: true,
    regenRecovery: { targetMessageUid: '' } })
  assert.equal(blank.streamingMessageUid, null, '空 UID 不是流目标')
  const story = await f.projection.project.story({
    chat: { ...f.chat, regenInProgress: true, regenRecovery: { targetMessageUid: 'uid-2' } },
    revision: 4, from: 0, to: 0, messageCount: 0,
    storyTranscript: { source: 'story', revision: 4, from: 0, to: 0, messageCount: 0, floorCount: 0, floorOffset: 0, messages: [] }
  })
  assert.equal(story.streamingMessageUid, 'uid-2', '故事转录视图也必须带目标 UID')
  assert.equal(story.streamingStoryTurn, null, '替换已有正文按 UID 落位，不追加故事行')
  const failedTail = await f.projection.project.story({
    chat: { ...f.chat, regenInProgress: true, regenRecovery: { unansweredTail: true, storyTurn: 8, targetMessageUid: '' } },
    revision: 5, from: 0, to: 0, messageCount: 0,
    storyTranscript: { source: 'story', revision: 5, from: 0, to: 0, messageCount: 0, floorCount: 0, floorOffset: 0, messages: [] }
  })
  assert.equal(failedTail.streamingStoryTurn, 8, '失败尾没有旧行 UID，视图必须给出本轮预留的故事轮次')
  const failedTailSettled = await f.projection.project.full({ ...f.chat, regenInProgress: false,
    regenRecovery: { unansweredTail: true, storyTurn: 8 } })
  assert.equal(failedTailSettled.streamingStoryTurn, null, '生成结束后不得残留虚拟故事行')
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
