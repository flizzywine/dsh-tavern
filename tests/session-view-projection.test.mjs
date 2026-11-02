import test from 'node:test'
import assert from 'node:assert/strict'
import { projectionFixture } from './fixtures/session-view-projection.mjs'

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