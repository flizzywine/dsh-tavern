import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createBoundedHistory } from '../tavern-plugin/lib/domain/bounded-history.js'
import { lastTavernHelperVariables } from '../tavern-plugin/lib/domain/tavern-helper-context.js'
import { activateWorldBook, historyScanDepth } from '../tavern-plugin/lib/domain/worldbook-activation.js'

function history(turns, variablesAt = () => true) {
  const messages = [{ role: 'assistant', greeting: true, text: '开场', turn: 1 }]
  for (let turn = 1; turn <= turns; turn++) {
    messages.push({ role: 'user', text: '行动 ' + turn })
    messages.push({ role: 'assistant', text: '正文 ' + turn + (turn === 3 ? ' 古钟' : ''), turn: turn + 1, swipeId: 0, swipes: ['正文'],
      ...(variablesAt(turn) ? { variables: [{ stat_data: { hp: turn }, schema: {} }] } : {}) })
  }
  return messages
}

async function store(t, chat) {
  const root = await mkdtemp(join(tmpdir(), 'bounded-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  await p.write({ id: 'c', sessionId: 's', mode: 'story', backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
    timeline: { schemaVersion: 1, branchId: 'b', revision: 1, checkpoints: [{ id: 'kept' }], operations: {}, participants: {} }, ...chat }, { source: 'create' })
  const windows = []
  const bounded = createBoundedHistory({ links: async () => ({ s: 'c' }), readWindow: (id, options) => { windows.push(options); return p.readWindow(id, options) }, pageSize: 10 })
  return { p, bounded, windows }
}

test('窗口覆盖扫描深度、最近回复和最近变量楼层，其余楼层为空洞', async t => {
  const h = await store(t, { messages: history(300, turn => turn === 7) })
  const selected = await h.bounded.forSession('s', { storyRows: 25, lastAssistant: true, lastVariables: true })
  const full = await h.p.read('c')
  assert.equal(selected.chat.messages.length, full.messages.length)
  assert.ok(selected.from <= full.messages.length - 25 && selected.from > 0)
  for (let i = selected.from; i < full.messages.length; i++) assert.deepEqual(selected.chat.messages[i], full.messages[i])
  assert.equal(selected.chat.messages[selected.from - 1], undefined)
  // The latest variable floor (turn 7) is outside the window and loaded through the world index.
  assert.deepEqual(lastTavernHelperVariables(selected.chat.messages), lastTavernHelperVariables(full.messages))
  assert.deepEqual(selected.chat.timeline.checkpoints, [{ id: 'kept' }])
  assert.ok(h.windows.every(options => options.limit <= 500))
})

test('世界书扫描在窗口与完整历史上结果相同', async t => {
  const h = await store(t, { messages: history(200) })
  const worldBook = { view: { raw: { scan_depth: 2 }, entries: [
    { ref: 'bell', enabled: true, primaryKeys: ['古钟'], content: '钟声', scanDepth: 30 },
    { ref: 'near', enabled: true, primaryKeys: ['正文 186'], content: '近处', scanDepth: 30 },
    { ref: 'edge', enabled: true, primaryKeys: ['正文 185'], content: '边缘', scanDepth: 30 },
    { ref: 'last', enabled: true, primaryKeys: ['正文 200'], content: '最近' }] } }
  const depth = historyScanDepth(worldBook)
  assert.equal(depth, 30)
  const selected = await h.bounded.forSession('s', { storyRows: depth + 1, lastAssistant: true })
  assert.ok(selected.from > 300)
  const full = await h.p.read('c')
  const pick = chat => activateWorldBook({ worldBook, entries: worldBook.view.entries, chat, userText: '继续', isCoolingDown: () => false, random: () => 0 }).entries.map(entry => entry.ref).sort()
  assert.deepEqual(pick(selected.chat), pick(full))
  assert.deepEqual(pick(full), ['last', 'near'])
})

test('无变量、短历史与旧存档的边界', async t => {
  const none = await store(t, { messages: history(100, () => false) })
  const selected = await none.bounded.forSession('s', { storyRows: 3, lastVariables: true })
  assert.ok(selected.from > 0)
  assert.equal(lastTavernHelperVariables(selected.chat.messages), undefined)
  const short = await store(t, { messages: history(3) })
  assert.equal((await short.bounded.forSession('s', { storyRows: 50 })).from, 0)
  const legacy = await store(t, { messages: history(3), timeline: { schemaVersion: 1, operations: { old: { kind: 'body', status: 'foreground-completed' } } } })
  assert.equal(await legacy.bounded.forSession('s', {}), undefined)
  assert.equal(await none.bounded.forSession('s', { storyRows: Infinity }), undefined)
  const capped = createBoundedHistory({ links: async () => ({ s: 'c' }), readWindow: none.p.readWindow, pageSize: 10, maxRows: 40 })
  assert.equal(await capped.forSession('s', { storyRows: 150 }), undefined)
})
