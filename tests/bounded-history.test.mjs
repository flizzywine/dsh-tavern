import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createBoundedHistory } from '../tavern-plugin/lib/domain/bounded-history.js'
import { lastTavernHelperVariables } from '../tavern-plugin/lib/domain/tavern-helper-context.js'

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
