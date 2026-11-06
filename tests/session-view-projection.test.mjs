import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectionFixture } from './fixtures/session-view-projection.mjs'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { sessionViewMessageFields } from '../tavern-plugin/lib/domain/session-view-projection.js'

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

test('display round order follows assistant floors without rewriting sparse stable turns', async () => {
  const f = projectionFixture()
  const messages = [
    { role: 'assistant', greeting: true, turn: 1, text: '开场' },
    ...[2, 3, 12, 48, 72, 75, 84].flatMap(turn => [{ role: 'user', turn }, { role: 'assistant', turn, text: '正文 ' + turn }])
  ]
  const view = await f.projection.project.full({ ...f.chat, messages })
  assert.deepEqual(view.displayRoundOrder, [1, 2, 3, 12, 48, 72, 75, 84])
  assert.deepEqual(messages.filter(message => message.role === 'assistant').map(message => message.turn), view.displayRoundOrder)
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

test('header-only player name changes refresh the view and helper across repeated writes and cached reads', async () => {
  const f = projectionFixture()
  let chat = { ...f.chat, macroState: { userName: '你' } }
  let previous = await f.projection.project.full(chat)
  for (const name of ['dd1', 'aa1', 'aa2', 'aa2', '', 'aa5', '  ']) {
    chat = { ...chat, _storageRevision: chat._storageRevision + 1, macroState: { userName: name } }
    const expected = name.trim() || '你'
    const dirty = await f.projection.project.dirty(chat, previous, new Set(), { busy: false },
      { changedHeaderFields: ['macroState'], layoutChanged: false })
    assert.equal(dirty.playerName, expected)
    assert.equal(dirty.tavernHelper.playerName, expected)
    const cached = await f.projection.project.cached(chat, dirty, { busy: false })
    assert.equal(cached.playerName, expected)
    assert.equal(cached.tavernHelper.playerName, expected)
    assert.equal(previous.playerName, previous.tavernHelper.playerName)
    previous = cached
  }
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

test('cache hits refresh activity and script progress without reading card/history resources', async () => {
  let progress = 1, reads = 0
  const f = projectionFixture({ readScript: async () => ({ chunks: [] }), scriptContinuity: { inspect: () => ({ progress }) },
    readChatCard: async () => { reads++; return { name: '卡' } } })
  const chat = { ...f.chat, mode: 'script' }
  const full = await f.projection.project.full(chat)
  progress = 2
  const cached = await f.projection.project.cached(chat, full, { busy: true, phase: 'running', role: 'settlement' })
  assert.equal(reads, 1)
  assert.equal(cached.activity.busy, true)
  assert.equal(cached.scriptProgress.progress, 2)
  assert.equal(full.scriptProgress.progress, 1)
  assert.equal(cached.tavernHelper, full.tavernHelper)
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

test('the session view publishes the host-decided stage switches of the card, none without a stage runtime or card', async () => {
  const asked = []
  const f = projectionFixture({ readCardStageMode: async path => { asked.push(path); return { dialogue: true, stage: false } } })
  const story = await f.projection.project.full(f.chat)
  assert.deepEqual(story.stage, { dialogue: true, stage: false })
  assert.deepEqual(asked, ['cards/a.json'])
  const workbench = await f.projection.project.full({ ...f.chat, mode: 'card' })
  assert.deepEqual(workbench.stage, { dialogue: false, stage: false }, 'the card workbench is not a stage session')
  assert.deepEqual(asked, ['cards/a.json'])
  const plain = await projectionFixture().projection.project.full(f.chat)
  assert.deepEqual(plain.stage, { dialogue: false, stage: false }, 'without a stage runtime no card has the stage')
})